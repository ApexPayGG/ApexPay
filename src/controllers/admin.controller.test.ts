import { describe, it, expect, vi, beforeEach } from "vitest";
import type { WalletService } from "../services/wallet.service.js";
import { AdminController } from "./admin.controller.js";

const mockListTransactionsAdmin = vi.fn();

function createController() {
  const walletService = {
    listTransactionsAdmin: mockListTransactionsAdmin,
  } as unknown as WalletService;
  return new AdminController(walletService);
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
    expect(mockListTransactionsAdmin).toHaveBeenCalledWith(0, 10);
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
});
