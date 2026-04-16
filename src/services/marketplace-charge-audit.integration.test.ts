import { describe, expect, it, vi } from "vitest";
import {
  AuditAction,
  AuditActorType,
  type PrismaClient,
} from "@prisma/client";
import { AuditLogService } from "./audit-log.service.js";
import { MarketplaceChargeService } from "./marketplace-charge.service.js";

/**
 * Integracja: ta sama transakcja DB co charge zapisuje append-only AuditLog (CHARGE_CREATED).
 * Odpowiada ścieżce API POST /api/v1/integrations/charges (serwis + audyt).
 */
describe("MarketplaceChargeService — audyt po createIntegrationCharge", () => {
  it("w transakcji wywołuje zapis audytu CHARGE_CREATED", async () => {
    const redis = { set: vi.fn().mockResolvedValue("OK"), del: vi.fn() };
    const integratorUserId = "int_user_audit";

    const chargeRow = {
      id: "charge_audit_1",
      debitUserId: integratorUserId,
      integratorUserId,
      amountCents: 500n,
      currency: "PLN",
      idempotencyKey: "idem-audit-integration",
      createdAt: new Date(),
    };

    const auditLogCreate = vi.fn().mockResolvedValue({
      id: "audit_row_1",
      createdAt: new Date(),
    });

    const prisma = {
      connectedAccount: { findMany: vi.fn().mockResolvedValue([]) },
      $transaction: vi.fn(
        async (fn: (tx: Record<string, unknown>) => Promise<unknown>) => {
          const tx = {
            paymentMethod: { findFirst: vi.fn() },
            wallet: {
              findUnique: vi.fn().mockResolvedValue({ id: "w_int" }),
              update: vi.fn().mockResolvedValue({}),
            },
            marketplaceCharge: {
              create: vi.fn().mockResolvedValue(chargeRow),
            },
            transaction: { create: vi.fn().mockResolvedValue({}) },
            webhookOutbox: { create: vi.fn().mockResolvedValue({ id: "wo_audit" }) },
            auditLog: { create: auditLogCreate },
          };
          return fn(tx);
        },
      ),
    } as unknown as PrismaClient;

    const auditLogService = new AuditLogService(prisma);
    const service = new MarketplaceChargeService(prisma, undefined, auditLogService);

    await service.createIntegrationCharge({
      redis: redis as never,
      integratorUserId,
      idempotencyKey: "idem-audit-integration",
      amountCents: 500n,
      currency: "PLN",
      splits: [],
    });

    expect(auditLogCreate).toHaveBeenCalledTimes(1);
    expect(auditLogCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: AuditAction.CHARGE_CREATED,
        entityType: "MarketplaceCharge",
        entityId: chargeRow.id,
        actorId: integratorUserId,
        actorType: AuditActorType.USER,
        metadata: expect.objectContaining({
          idempotencyKey: "idem-audit-integration",
          amountCents: "500",
        }),
      }),
    });
  });
});
