import { describe, it, expect, vi, beforeEach } from "vitest";
import { FraudCheckStatus, RefundStatus } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { AdminAnalyticsController } from "./admin-analytics.controller.js";

function createRes() {
  const res = {
    status: vi.fn(),
    json: vi.fn(),
  };
  res.status.mockImplementation(() => res);
  return res as { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> };
}

describe("AdminAnalyticsController", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("overview zwraca poprawne agregacje KPI", async () => {
    const prisma = {
      marketplaceCharge: {
        aggregate: vi.fn().mockResolvedValue({
          _count: { _all: 2 },
          _sum: { amountCents: 12345n },
        }),
      },
      payout: {
        aggregate: vi.fn().mockResolvedValue({
          _count: { _all: 1 },
          _sum: { amount: 5000n },
        }),
      },
      refund: {
        aggregate: vi.fn().mockResolvedValue({
          _count: { _all: 1 },
          _sum: { amount: 1000n },
        }),
      },
      fraudCheck: {
        count: vi
          .fn()
          .mockResolvedValueOnce(3)
          .mockResolvedValueOnce(4),
      },
      connectedAccount: {
        count: vi.fn().mockResolvedValue(9),
      },
      dispute: {
        count: vi.fn().mockResolvedValue(2),
      },
    } as unknown as PrismaClient;

    const controller = new AdminAnalyticsController(prisma);
    const res = createRes();
    await controller.overview(
      {
        query: {
          from: "2026-04-01T00:00:00.000Z",
          to: "2026-04-30T23:59:59.000Z",
        },
      } as never,
      res as never,
    );

    expect(prisma.refund.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: RefundStatus.SUCCEEDED }),
      }),
    );
    expect(prisma.fraudCheck.count).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ where: expect.objectContaining({ status: FraudCheckStatus.BLOCKED }) }),
    );
    expect(prisma.fraudCheck.count).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ where: expect.objectContaining({ status: FraudCheckStatus.FLAGGED }) }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "success",
        data: expect.objectContaining({
          totalCharges: { count: 2, amountPln: 123.45 },
          totalPayouts: { count: 1, amountPln: 50 },
          totalRefunds: { count: 1, amountPln: 10 },
          fraudBlocked: 3,
          fraudFlagged: 4,
          activeConnectedAccounts: 9,
          pendingDisputes: 2,
        }),
      }),
    );
  });

  it("revenueChart zwraca serie po bucketach", async () => {
    const prisma = {
      $queryRaw: vi
        .fn()
        .mockResolvedValueOnce([
          { bucket: new Date("2026-04-01T00:00:00.000Z"), amount: 1000n },
          { bucket: new Date("2026-04-02T00:00:00.000Z"), amount: 2000n },
        ])
        .mockResolvedValueOnce([
          { bucket: new Date("2026-04-01T00:00:00.000Z"), amount: 300n },
        ])
        .mockResolvedValueOnce([
          { bucket: new Date("2026-04-02T00:00:00.000Z"), amount: 150n },
        ]),
    } as unknown as PrismaClient;

    const controller = new AdminAnalyticsController(prisma);
    const res = createRes();
    await controller.revenueChart(
      {
        query: {
          from: "2026-04-01T00:00:00.000Z",
          to: "2026-04-02T23:59:59.000Z",
          granularity: "day",
        },
      } as never,
      res as never,
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "success",
        data: [
          { date: "2026-04-01", chargesAmount: 10, payoutsAmount: 3, refundsAmount: 0 },
          { date: "2026-04-02", chargesAmount: 20, payoutsAmount: 0, refundsAmount: 1.5 },
        ],
      }),
    );
  });

  it("fraudChart agreguje statusy dziennie", async () => {
    const prisma = {
      $queryRaw: vi.fn().mockResolvedValue([
        { bucket: new Date("2026-04-10T00:00:00.000Z"), status: FraudCheckStatus.BLOCKED, count: 2n },
        { bucket: new Date("2026-04-10T00:00:00.000Z"), status: FraudCheckStatus.PASSED, count: 5n },
        { bucket: new Date("2026-04-11T00:00:00.000Z"), status: FraudCheckStatus.FLAGGED, count: 1n },
      ]),
    } as unknown as PrismaClient;

    const controller = new AdminAnalyticsController(prisma);
    const res = createRes();
    await controller.fraudChart(
      {
        query: {
          from: "2026-04-10T00:00:00.000Z",
          to: "2026-04-11T23:59:59.000Z",
        },
      } as never,
      res as never,
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "success",
        data: [
          { date: "2026-04-10", blocked: 2, flagged: 0, passed: 5 },
          { date: "2026-04-11", blocked: 0, flagged: 1, passed: 0 },
        ],
      }),
    );
  });
});
