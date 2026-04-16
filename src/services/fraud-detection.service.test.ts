import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { FraudCheckStatus } from "@prisma/client";
import { FraudDetectionService } from "./fraud-detection.service.js";

vi.mock("../lib/fraud-rules.js", () => ({
  ALL_FRAUD_RULES: [async () => ({ rule: "TEST", score: 75, detail: "mock" })],
}));

describe("FraudDetectionService.evaluate", () => {
  it("zapisuje FraudCheck i zwraca BLOCKED przy score >= progu", async () => {
    const prisma = {
      $transaction: vi.fn(async (fn: (tx: { fraudCheck: { create: ReturnType<typeof vi.fn> } }) => Promise<{ id: string }>) => {
        const trx = {
          fraudCheck: {
            create: vi.fn().mockResolvedValue({ id: "fc_test_1" }),
          },
        };
        return fn(trx);
      }),
    } as unknown as PrismaClient;

    const svc = new FraudDetectionService(prisma);
    const r = await svc.evaluate({
      userId: "u1",
      amount: 100n,
      currency: "PLN",
      entityType: "MarketplaceCharge",
      prisma,
    });

    expect(r.status).toBe(FraudCheckStatus.BLOCKED);
    expect(r.score).toBe(75);
    expect(r.fraudCheckId).toBe("fc_test_1");
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});
