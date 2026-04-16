import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WebhookStatus } from "@prisma/client";
import {
  MAX_DELIVERY_ATTEMPTS,
  WebhookDispatcherService,
  webhookRetryDelayMs,
} from "./webhook-dispatcher.service.js";

type OutboxRow = {
  id: string;
  integratorUserId: string;
  eventType: string;
  payload: unknown;
  attempts: number;
  status: WebhookStatus;
  nextAttemptAt: Date;
};

function createOutboxMock(initial: OutboxRow) {
  const outbox = new Map<string, OutboxRow>();
  outbox.set(initial.id, { ...initial });

  const prisma = {
    integratorConfig: {
      findUnique: vi.fn().mockResolvedValue({
        webhookUrl: "https://example.com/webhook",
        webhookSecret: "whsec_test",
      }),
    },
    webhookDeadLetter: {
      create: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
        id: "dl-created",
        ...data,
      })),
    },
    webhookOutbox: {
      findUnique: vi.fn().mockImplementation(async ({ where: { id } }: { where: { id: string } }) => {
        const r = outbox.get(id);
        return r === undefined ? null : { ...r };
      }),
      findUniqueOrThrow: vi.fn().mockImplementation(async ({ where: { id } }: { where: { id: string } }) => {
        const r = outbox.get(id);
        if (r === undefined) {
          throw new Error("not found");
        }
        return { ...r };
      }),
      updateMany: vi.fn().mockImplementation(
        async ({
          where: { id },
          data,
        }: {
          where: { id: string };
          data: Partial<OutboxRow>;
        }) => {
          const r = outbox.get(id);
          if (r === undefined) {
            return { count: 0 };
          }
          if (r.status !== WebhookStatus.PENDING && r.status !== WebhookStatus.FAILED) {
            return { count: 0 };
          }
          if (r.nextAttemptAt > new Date()) {
            return { count: 0 };
          }
          Object.assign(r, data);
          return { count: 1 };
        },
      ),
      update: vi.fn().mockImplementation(
        async ({ where: { id }, data }: { where: { id: string }; data: Partial<OutboxRow> }) => {
          const r = outbox.get(id);
          if (r !== undefined) {
            Object.assign(r, data);
          }
        },
      ),
      delete: vi.fn().mockImplementation(async ({ where: { id } }: { where: { id: string } }) => {
        outbox.delete(id);
      }),
    },
    $transaction: vi.fn().mockImplementation(async (fn: (tx: typeof prisma) => Promise<unknown>) => {
      return fn(prisma);
    }),
  };

  return { prisma: prisma as never, outbox, deadLetterCreates: prisma.webhookDeadLetter.create };
}

describe("WebhookDispatcherService → dead letter po MAX_DELIVERY_ATTEMPTS", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-02T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("po 5 nieudanych dostawach usuwa WebhookOutbox i tworzy WebhookDeadLetter", async () => {
    const row: OutboxRow = {
      id: "o1",
      integratorUserId: "u1",
      eventType: "charge.succeeded",
      payload: { id: "c1" },
      attempts: 0,
      status: WebhookStatus.PENDING,
      nextAttemptAt: new Date(0),
    };
    const { prisma, outbox, deadLetterCreates } = createOutboxMock(row);
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 503 });

    const dispatcher = new WebhookDispatcherService(prisma, { fetchImpl });

    for (let i = 0; i < MAX_DELIVERY_ATTEMPTS; i += 1) {
      await dispatcher.processOutboxById("o1");
      if (i < MAX_DELIVERY_ATTEMPTS - 1) {
        const r = outbox.get("o1");
        expect(r).toBeDefined();
        const delay =
          r!.attempts > 0 ? webhookRetryDelayMs(r!.attempts) : webhookRetryDelayMs(1);
        vi.advanceTimersByTime(delay + 1000);
      }
    }

    expect(outbox.has("o1")).toBe(false);
    expect(deadLetterCreates).toHaveBeenCalledTimes(1);
    const dlArg = deadLetterCreates.mock.calls[0]?.[0] as { data: { attempts: number } };
    expect(dlArg.data.attempts).toBe(MAX_DELIVERY_ATTEMPTS);
    expect(fetchImpl).toHaveBeenCalledTimes(MAX_DELIVERY_ATTEMPTS);
  });
});
