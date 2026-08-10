import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response } from "express";
import { TradeStatus } from "@prisma/client";
import { TradeController } from "./trade.controller.js";
import type { TradeService } from "../services/trade.service.js";

function mockRes(): Response & {
  statusCode: number;
  body: unknown;
} {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(payload: unknown) {
      res.body = payload;
      return res;
    },
  };
  return res as unknown as Response & { statusCode: number; body: unknown };
}

describe("TradeController.cancel", () => {
  let getTrade: ReturnType<typeof vi.fn>;
  let cancelBySeller: ReturnType<typeof vi.fn>;
  let cancelByBuyer: ReturnType<typeof vi.fn>;
  let controller: TradeController;

  beforeEach(() => {
    getTrade = vi.fn();
    cancelBySeller = vi.fn().mockResolvedValue(undefined);
    cancelByBuyer = vi.fn().mockResolvedValue(undefined);
    controller = new TradeController({
      getTrade,
      cancelBySeller,
      cancelByBuyer,
    } as unknown as TradeService);
  });

  it("routes seller cancel to cancelBySeller", async () => {
    getTrade.mockResolvedValue({
      tradeId: "t1",
      sellerId: "seller_1",
      buyerId: "buyer_1",
      status: TradeStatus.PAID_AWAITING_ITEM,
    });
    const req = {
      user: { id: "seller_1" },
      params: { tradeId: "t1" },
    } as unknown as Request;
    const res = mockRes();

    await controller.cancel(req, res);

    expect(cancelBySeller).toHaveBeenCalledWith("t1", "seller_1");
    expect(cancelByBuyer).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
  });

  it("routes buyer reclaim to cancelByBuyer", async () => {
    getTrade.mockResolvedValue({
      tradeId: "t1",
      sellerId: "seller_1",
      buyerId: "buyer_1",
      status: TradeStatus.PAID_AWAITING_ITEM,
    });
    const req = {
      user: { id: "buyer_1" },
      params: { tradeId: "t1" },
    } as unknown as Request;
    const res = mockRes();

    await controller.cancel(req, res);

    expect(cancelByBuyer).toHaveBeenCalledWith("t1", "buyer_1");
    expect(cancelBySeller).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
  });

  it("rejects strangers with 403", async () => {
    getTrade.mockResolvedValue({
      tradeId: "t1",
      sellerId: "seller_1",
      buyerId: "buyer_1",
      status: TradeStatus.PAID_AWAITING_ITEM,
    });
    const req = {
      user: { id: "stranger" },
      params: { tradeId: "t1" },
    } as unknown as Request;
    const res = mockRes();

    await controller.cancel(req, res);

    expect(cancelBySeller).not.toHaveBeenCalled();
    expect(cancelByBuyer).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });
});
