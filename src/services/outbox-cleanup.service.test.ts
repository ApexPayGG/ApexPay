import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { OutboxCleanupService } from "./outbox-cleanup.service.js";

describe("OutboxCleanupService", () => {
  let executeRaw: ReturnType<typeof vi.fn>;
  let prisma: PrismaClient;
  let infoSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    executeRaw = vi.fn();
    prisma = { $executeRaw: executeRaw } as unknown as PrismaClient;
    infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
  });

  afterEach(() => {
    infoSpy.mockRestore();
  });

  it("deletes in chunks until zero rows, logs chunks and total rows", async () => {
    executeRaw
      .mockResolvedValueOnce(1000)
      .mockResolvedValueOnce(500)
      .mockResolvedValueOnce(0);

    const svc = new OutboxCleanupService(prisma, {
      chunkDelayMs: 0,
      retentionDays: 7,
      chunkSize: 1000,
    });
    await svc.runCleanup();

    expect(executeRaw).toHaveBeenCalledTimes(3);
    expect(infoSpy).toHaveBeenCalled();
    const logLine = infoSpy.mock.calls.find(
      (c) =>
        typeof c[0] === "string" && c[0].includes("outbox_cleanup_completed"),
    )?.[0] as string | undefined;
    expect(logLine).toBeDefined();
    const parsed = JSON.parse(logLine ?? "{}") as {
      event: string;
      chunksProcessed: number;
      rowsDeleted: number;
    };
    expect(parsed.event).toBe("outbox_cleanup_completed");
    expect(parsed.chunksProcessed).toBe(2);
    expect(parsed.rowsDeleted).toBe(1500);
  });

  it("swallows errors and logs without rethrowing", async () => {
    executeRaw.mockRejectedValue(new Error("db error"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const svc = new OutboxCleanupService(prisma, { chunkDelayMs: 0 });
      await expect(svc.runCleanup()).resolves.toBeUndefined();
      expect(errSpy).toHaveBeenCalled();
    } finally {
      errSpy.mockRestore();
    }
  });
});
