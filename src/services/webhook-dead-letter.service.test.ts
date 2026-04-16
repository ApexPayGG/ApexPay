import { describe, it, expect, vi } from "vitest";
import { AuditAction, AuditActorType, WebhookStatus } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import {
  archiveWebhookOutboxToDeadLetter,
  WebhookDeadLetterAlreadyRequeuedError,
  WebhookDeadLetterNotFoundError,
  WebhookDeadLetterService,
} from "./webhook-dead-letter.service.js";

describe("archiveWebhookOutboxToDeadLetter", () => {
  it("tworzy dead letter i usuwa wpis z WebhookOutbox (transakcja)", async () => {
    const deletedIds: string[] = [];
    const createdPayloads: unknown[] = [];

    const tx = {
      webhookDeadLetter: {
        create: vi.fn().mockImplementation(async ({ data }: { data: unknown }) => {
          createdPayloads.push(data);
          return { id: "dl-1", ...data };
        }),
      },
      webhookOutbox: {
        delete: vi.fn().mockImplementation(async ({ where: { id } }: { where: { id: string } }) => {
          deletedIds.push(id);
        }),
      },
    };

    const prisma = {
      $transaction: vi.fn().mockImplementation(async (fn: typeof tx) => fn(tx)),
    } as unknown as PrismaClient;

    const { deadLetterId } = await archiveWebhookOutboxToDeadLetter(
      prisma,
      {
        id: "out-orig",
        integratorUserId: "int-1",
        eventType: "payout.created",
        payload: { x: 1 },
      },
      5,
      "HTTP_500",
      new Date("2026-04-02T10:00:00.000Z"),
    );

    expect(deadLetterId).toBe("dl-1");
    expect(deletedIds).toEqual(["out-orig"]);
    expect(createdPayloads).toHaveLength(1);
    expect(createdPayloads[0]).toMatchObject({
      integratorUserId: "int-1",
      eventType: "payout.created",
      attempts: 5,
      lastError: "HTTP_500",
      originalOutboxId: "out-orig",
    });
  });
});

describe("WebhookDeadLetterService.requeueById", () => {
  it("tworzy WebhookOutbox i ustawia requeued na dead letter", async () => {
    const dlRow = {
      id: "dl-99",
      integratorUserId: "u-integrator",
      eventType: "charge.succeeded",
      payload: { k: "v" },
      attempts: 5,
      lastError: "HTTP_502",
      lastAttemptAt: new Date(),
      originalOutboxId: "old-out",
      requeued: false,
      requeuedAt: null,
      requeuedBy: null,
      createdAt: new Date(),
    };

    const createdOutbox: { id: string; data: unknown }[] = [];
    const dlUpdates: unknown[] = [];

    const tx = {
      webhookDeadLetter: {
        findUnique: vi.fn().mockResolvedValue(dlRow),
        update: vi.fn().mockImplementation(async ({ data }: { data: unknown }) => {
          dlUpdates.push(data);
        }),
      },
      webhookOutbox: {
        create: vi.fn().mockImplementation(async ({ data }: { data: unknown }) => {
          const id = "new-outbox-cuid";
          createdOutbox.push({ id, data });
          return { id, ...data };
        }),
      },
    };

    const prisma = {
      $transaction: vi.fn().mockImplementation(async (fn: typeof tx) => fn(tx)),
    } as unknown as PrismaClient;

    const auditLogService = {
      log: vi.fn().mockResolvedValue({ id: "log-1" }),
    };

    const publish = vi.fn().mockResolvedValue(undefined);
    const service = new WebhookDeadLetterService(prisma, auditLogService as never, publish);

    const { outboxId } = await service.requeueById("dl-99", "admin-1");

    expect(outboxId).toBe("new-outbox-cuid");
    expect(createdOutbox).toHaveLength(1);
    expect(createdOutbox[0]?.data).toMatchObject({
      integratorUserId: "u-integrator",
      eventType: "charge.succeeded",
      payload: { k: "v" },
      status: WebhookStatus.PENDING,
      attempts: 0,
    });
    expect(dlUpdates[0]).toMatchObject({
      requeued: true,
      requeuedBy: "admin-1",
    });
    expect(auditLogService.log).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        actorId: "admin-1",
        actorType: AuditActorType.ADMIN,
        action: AuditAction.WEBHOOK_REQUEUED,
        entityType: "WebhookDeadLetter",
        entityId: "dl-99",
      }),
      undefined,
    );
    expect(publish).toHaveBeenCalledWith("new-outbox-cuid");
  });

  it("rzuca WebhookDeadLetterNotFoundError gdy brak rekordu", async () => {
    const tx = {
      webhookDeadLetter: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
    };
    const prisma = {
      $transaction: vi.fn().mockImplementation(async (fn: typeof tx) => fn(tx)),
    } as unknown as PrismaClient;
    const service = new WebhookDeadLetterService(prisma, { log: vi.fn() } as never);
    await expect(service.requeueById("missing", "admin")).rejects.toBeInstanceOf(
      WebhookDeadLetterNotFoundError,
    );
  });

  it("rzuca WebhookDeadLetterAlreadyRequeuedError gdy requeued już true", async () => {
    const tx = {
      webhookDeadLetter: {
        findUnique: vi.fn().mockResolvedValue({
          id: "dl",
          requeued: true,
          integratorUserId: "u",
          eventType: "e",
          payload: {},
 }),
      },
    };
    const prisma = {
      $transaction: vi.fn().mockImplementation(async (fn: typeof tx) => fn(tx)),
    } as unknown as PrismaClient;
    const service = new WebhookDeadLetterService(prisma, { log: vi.fn() } as never);
    await expect(service.requeueById("dl", "admin")).rejects.toBeInstanceOf(
      WebhookDeadLetterAlreadyRequeuedError,
    );
  });
});
