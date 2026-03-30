import CircuitBreaker from "opossum";
import { Prisma, type PrismaClient } from "@prisma/client";
import {
  messageBrokerPublishErrorsTotal,
  outboxPendingEventsTotal,
} from "../monitoring/metrics.js";
import type { MessageBroker } from "./message-broker.js";

const DEFAULT_INTERVAL_MS = 2000;
const DEFAULT_MAX_RETRIES = 5;

const PUBLISH_BREAKER_OPTIONS = {
  errorThresholdPercentage: 50,
  volumeThreshold: 10,
  resetTimeout: 30_000,
  rollingCountTimeout: 10_000,
} as const;

type OutboxRow = {
  id: string;
  eventType: string;
  payload: Prisma.JsonValue;
  status: string;
  retryCount: number;
  created_at: Date;
};

const SELECT_PENDING_FOR_UPDATE = Prisma.sql`
  SELECT * FROM "OutboxEvent"
  WHERE status = 'PENDING'
  ORDER BY created_at ASC
  LIMIT 100
  FOR UPDATE SKIP LOCKED
`;

export type OutboxPollerOptions = {
  intervalMs?: number;
  maxRetries?: number;
  /** Testy / zaawansowane — wstrzyknięty breaker zamiast domyślnego. */
  circuitBreaker?: CircuitBreaker<[string, unknown], void>;
};

export class OutboxPollerService {
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly publishBreaker: CircuitBreaker<[string, unknown], void>;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly broker: MessageBroker,
    private readonly options: OutboxPollerOptions = {},
  ) {
    this.publishBreaker =
      options.circuitBreaker ??
      new CircuitBreaker<[string, unknown], void>(
        (routingKey: string, payload: unknown) =>
          this.broker.publish(routingKey, payload),
        PUBLISH_BREAKER_OPTIONS,
      );
    this.attachPublishBreakerListeners();
  }

  private attachPublishBreakerListeners(): void {
    this.publishBreaker.on("open", () => {
      console.warn(
        "[OutboxPoller] Circuit breaker: OPEN — pomijanie odczytu outboxa (FOR UPDATE SKIP LOCKED) do czasu resetu.",
      );
    });
    this.publishBreaker.on("halfOpen", () => {
      console.warn(
        "[OutboxPoller] Circuit breaker: HALF_OPEN — pojedyncza próba odzyskania.",
      );
    });
    this.publishBreaker.on("close", () => {
      console.warn("[OutboxPoller] Circuit breaker: CLOSED — normalna praca.");
    });
  }

  start(): void {
    if (this.timer !== null) {
      return;
    }
    const ms = this.options.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.timer = setInterval(() => {
      void this.pollOnce();
    }, ms);
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (!this.publishBreaker.isShutdown) {
      this.publishBreaker.shutdown();
    }
  }

  /**
   * Jedna iteracja pętli (testy + jawne wywołanie).
   */
  async pollOnce(): Promise<void> {
    if (this.publishBreaker.opened) {
      return;
    }
    try {
      const rows = await this.prisma.$transaction(async (tx) => {
        const locked = await tx.$queryRaw<OutboxRow[]>(SELECT_PENDING_FOR_UPDATE);
        outboxPendingEventsTotal.set(locked.length);
        if (locked.length === 0) {
          return [] as OutboxRow[];
        }
        const ids = locked.map((r) => r.id);
        await tx.outboxEvent.updateMany({
          where: { id: { in: ids } },
          data: { status: "PROCESSING" },
        });
        return locked;
      });

      for (const row of rows) {
        await this.processRow(row);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[OutboxPoller] tick failed:", msg);
    }
  }

  private async processRow(row: OutboxRow): Promise<void> {
    try {
      await this.publishBreaker.fire(row.eventType, row.payload);
      await this.prisma.outboxEvent.update({
        where: { id: row.id },
        data: { status: "PROCESSED" },
      });
    } catch (err: unknown) {
      messageBrokerPublishErrorsTotal.inc();
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[OutboxPoller] publish failed:", row.id, msg);
      const maxRetries = this.options.maxRetries ?? DEFAULT_MAX_RETRIES;
      const nextRetry = row.retryCount + 1;
      if (nextRetry >= maxRetries) {
        await this.prisma.outboxEvent.update({
          where: { id: row.id },
          data: { status: "FAILED", retryCount: nextRetry },
        });
      } else {
        await this.prisma.outboxEvent.update({
          where: { id: row.id },
          data: { status: "PENDING", retryCount: nextRetry },
        });
      }
    }
  }
}
