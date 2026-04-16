import { describe, expect, it, vi } from "vitest";
import {
  DisputeReason,
  DisputeStatus,
  TransactionType,
  type PrismaClient,
} from "@prisma/client";
import { DisputeService, PSP_DISPUTE_IDEMP_REDIS_PREFIX } from "./dispute.service.js";
import type { AuditLogService } from "./audit-log.service.js";

describe("DisputeService", () => {
  const chargeId = "chg_1";
  const integratorUserId = "int_1";
  const walletId = "wal_int";
  const pspDisputeId = "psp-disp-1";

  const baseCharge = {
    id: chargeId,
    debitUserId: integratorUserId,
    integratorUserId,
    amountCents: 10_000n,
    currency: "PLN",
    idempotencyKey: "idem-1",
    createdAt: new Date(),
  };

  function buildRedis(overrides?: { setReturnsOk?: boolean }) {
    const setReturnsOk = overrides?.setReturnsOk !== false;
    return {
      set: vi.fn().mockResolvedValue(setReturnsOk ? "OK" : null),
      del: vi.fn().mockResolvedValue(1),
    };
  }

  it("createFromWebhook tworzy DISPUTE_HOLD i rekord Dispute", async () => {
    const redis = buildRedis();
    const disputeId = "disp_new_1";
    const outboxId = "wo_1";

    const walletUpdate = vi.fn().mockResolvedValue({ id: walletId, balance: 0n });
    const disputeCreate = vi.fn().mockResolvedValue({
      id: disputeId,
      chargeId,
      pspDisputeId,
      status: DisputeStatus.RECEIVED,
      reason: DisputeReason.FRAUDULENT,
      amount: 5000n,
      currency: "PLN",
      evidenceDueBy: new Date("2026-05-01T12:00:00.000Z"),
      evidence: null,
      resolvedAt: null,
      integratorNotifiedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const txCreate = vi.fn().mockResolvedValue({});
    const woCreate = vi.fn().mockResolvedValue({ id: outboxId });

    const prisma = {
      dispute: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          marketplaceCharge: {
            findUnique: vi.fn().mockResolvedValue(baseCharge),
          },
          wallet: {
            findUnique: vi.fn().mockResolvedValue({ id: walletId }),
            update: walletUpdate,
          },
          dispute: { create: disputeCreate },
          transaction: { create: txCreate },
          webhookOutbox: { create: woCreate },
        };
        return fn(tx);
      }),
    } as unknown as PrismaClient;

    const audit: Pick<AuditLogService, "log"> = { log: vi.fn().mockResolvedValue({}) };
    const service = new DisputeService(prisma, redis as never, audit as AuditLogService);

    const evidenceDue = new Date("2026-05-01T12:00:00.000Z");
    const result = await service.createFromWebhook({
      pspDisputeId,
      chargeId,
      reason: DisputeReason.FRAUDULENT,
      amount: 5000,
      currency: "PLN",
      evidenceDueBy: evidenceDue,
    });

    expect(result.duplicate).toBe(false);
    expect(result.dispute.id).toBe(disputeId);
    expect(txCreate).toHaveBeenCalledWith({
      data: {
        walletId,
        amount: -5000n,
        referenceId: `disp:${disputeId}:hold`,
        type: TransactionType.DISPUTE_HOLD,
      },
    });
    expect(woCreate).toHaveBeenCalled();
    expect(redis.set).toHaveBeenCalledWith(
      `${PSP_DISPUTE_IDEMP_REDIS_PREFIX}${pspDisputeId}`,
      "1",
      "EX",
      86_400,
      "NX",
    );
  });

  it("resolve WON zwalnia hold (DISPUTE_HOLD_RELEASE)", async () => {
    const disputeRow = {
      id: "disp_1",
      chargeId,
      pspDisputeId,
      status: DisputeStatus.RECEIVED,
      reason: DisputeReason.GENERAL,
      amount: 3000n,
      currency: "PLN",
      evidenceDueBy: new Date(),
      evidence: null,
      resolvedAt: null,
      integratorNotifiedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      charge: baseCharge,
    };

    const walletUpdate = vi.fn().mockResolvedValue({});
    const txCreate = vi.fn().mockResolvedValue({});
    const disputeUpdate = vi.fn().mockResolvedValue({
      ...disputeRow,
      status: DisputeStatus.WON,
      resolvedAt: new Date(),
    });
    const woCreate = vi.fn().mockResolvedValue({ id: "wo_won" });

    const prisma = {
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          dispute: {
            findUnique: vi.fn().mockResolvedValue(disputeRow),
            update: disputeUpdate,
          },
          wallet: {
            findUnique: vi.fn().mockResolvedValue({ id: walletId }),
            update: walletUpdate,
          },
          transaction: { create: txCreate },
          webhookOutbox: { create: woCreate },
        };
        return fn(tx);
      }),
    } as unknown as PrismaClient;

    const service = new DisputeService(prisma, buildRedis() as never);
    await service.resolve("disp_1", "WON", "admin_1");

    expect(walletUpdate).toHaveBeenCalledWith({
      where: { userId: integratorUserId },
      data: { balance: { increment: 3000n } },
    });
    expect(txCreate).toHaveBeenCalledWith({
      data: {
        walletId,
        amount: 3000n,
        referenceId: "disp:disp_1:hold_release",
        type: TransactionType.DISPUTE_HOLD_RELEASE,
      },
    });
  });

  it("resolve LOST: saldo jak po holdzie; ledger z RELEASE + DEBIT_FINAL", async () => {
    const disputeRow = {
      id: "disp_2",
      chargeId,
      pspDisputeId: "psp-2",
      status: DisputeStatus.EVIDENCE_SUBMITTED,
      reason: DisputeReason.GENERAL,
      amount: 2000n,
      currency: "PLN",
      evidenceDueBy: new Date(),
      evidence: {},
      resolvedAt: null,
      integratorNotifiedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      charge: baseCharge,
    };

    const walletUpdate = vi.fn().mockResolvedValue({});
    const txCreate = vi.fn().mockResolvedValue({});
    const disputeUpdate = vi.fn().mockResolvedValue({
      ...disputeRow,
      status: DisputeStatus.LOST,
      resolvedAt: new Date(),
    });
    const woCreate = vi.fn().mockResolvedValue({ id: "wo_lost" });

    const prisma = {
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          dispute: {
            findUnique: vi.fn().mockResolvedValue(disputeRow),
            update: disputeUpdate,
          },
          wallet: {
            findUnique: vi.fn().mockResolvedValue({ id: walletId }),
            update: walletUpdate,
          },
          transaction: { create: txCreate },
          webhookOutbox: { create: woCreate },
        };
        return fn(tx);
      }),
    } as unknown as PrismaClient;

    const audit: Pick<AuditLogService, "log"> = { log: vi.fn().mockResolvedValue({}) };
    const service = new DisputeService(prisma, buildRedis() as never, audit as AuditLogService);

    await service.resolve("disp_2", "LOST", "admin_1");

    expect(walletUpdate).toHaveBeenCalledTimes(2);
    expect(txCreate).toHaveBeenCalledTimes(2);
    expect(txCreate).toHaveBeenNthCalledWith(1, {
      data: {
        walletId,
        amount: 2000n,
        referenceId: "disp:disp_2:hold_release",
        type: TransactionType.DISPUTE_HOLD_RELEASE,
      },
    });
    expect(txCreate).toHaveBeenNthCalledWith(2, {
      data: {
        walletId,
        amount: -2000n,
        referenceId: "disp:disp_2:final",
        type: TransactionType.DISPUTE_DEBIT_FINAL,
      },
    });
  });

  it("idempotencja: istniejący spór po pspDisputeId — bez drugiego ledgera", async () => {
    const existing = {
      id: "disp_existing",
      chargeId,
      pspDisputeId,
      status: DisputeStatus.RECEIVED,
      reason: DisputeReason.DUPLICATE,
      amount: 100n,
      currency: "PLN",
      evidenceDueBy: new Date(),
      evidence: null,
      resolvedAt: null,
      integratorNotifiedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const prisma = {
      dispute: {
        findUnique: vi.fn().mockResolvedValue(existing),
      },
      $transaction: vi.fn(),
    } as unknown as PrismaClient;

    const redis = buildRedis();
    const service = new DisputeService(prisma, redis as never);

    const r = await service.createFromWebhook({
      pspDisputeId,
      chargeId,
      reason: DisputeReason.FRAUDULENT,
      amount: 100,
      currency: "PLN",
      evidenceDueBy: new Date(),
    });

    expect(r.duplicate).toBe(true);
    expect(r.dispute.id).toBe("disp_existing");
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(redis.set).not.toHaveBeenCalled();
  });

  it("Redis duplicate (SET NX miss) — zwraca duplikat gdy rekord już w DB", async () => {
    const existing = {
      id: "disp_race",
      chargeId,
      pspDisputeId,
      status: DisputeStatus.RECEIVED,
      reason: DisputeReason.GENERAL,
      amount: 100n,
      currency: "PLN",
      evidenceDueBy: new Date(),
      evidence: null,
      resolvedAt: null,
      integratorNotifiedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const redis = buildRedis({ setReturnsOk: false });
    const prisma = {
      dispute: {
        findUnique: vi.fn().mockResolvedValue(existing),
      },
      $transaction: vi.fn(),
    } as unknown as PrismaClient;

    const service = new DisputeService(prisma, redis as never);
    const r = await service.createFromWebhook({
      pspDisputeId,
      chargeId,
      reason: DisputeReason.GENERAL,
      amount: 100,
      currency: "PLN",
      evidenceDueBy: new Date(),
    });

    expect(r.duplicate).toBe(true);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
