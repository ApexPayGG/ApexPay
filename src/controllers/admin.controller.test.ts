import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PayoutService } from "../services/payout.service.js";
import type { WalletService } from "../services/wallet.service.js";
import { AdminController } from "./admin.controller.js";

const mockListTransactionsAdmin = vi.fn();

function createController() {
  const walletService = {
    listTransactionsAdmin: mockListTransactionsAdmin,
  } as unknown as WalletService;
  const payoutService = {
    settlePayout: vi.fn(),
  } as unknown as PayoutService;
  const auditLogService = {
    listForAdmin: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
  };
  return new AdminController(walletService, payoutService, auditLogService as never);
}

function createMockResponse() {
  const res = { status: vi.fn(), json: vi.fn() };
  res.status.mockImplementation(() => res);
  return res as { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> };
}

describe("AdminController.listTransactions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListTransactionsAdmin.mockReset();
  });

  it("returns 200 with pagination fields", async () => {
    mockListTransactionsAdmin.mockResolvedValue({
      items: [
        {
          id: "t1",
          amount: "10",
          referenceId: "r1",
          type: "DEPOSIT",
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          walletUserId: "u1",
        },
      ],
      total: 1,
    });
    const controller = createController();
    const res = createMockResponse();
    await controller.listTransactions(
      { query: { limit: "10", page: "0" } } as never,
      res as never,
    );
    expect(mockListTransactionsAdmin).toHaveBeenCalledWith(0, 10, undefined);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        items: expect.any(Array),
        page: 0,
        limit: 10,
        total: 1,
        totalPages: 1,
      }),
    );
  });

  it("przekazuje referenceIdPrefix do serwisu", async () => {
    mockListTransactionsAdmin.mockResolvedValue({ items: [], total: 0 });
    const controller = createController();
    const res = createMockResponse();
    await controller.listTransactions(
      {
        query: { limit: "10", page: "0", referenceIdPrefix: "stx:" },
      } as never,
      res as never,
    );
    expect(mockListTransactionsAdmin).toHaveBeenCalledWith(0, 10, {
      referenceIdPrefix: "stx:",
    });
  });
});
