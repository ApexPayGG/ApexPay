import { describe, it, expect, vi, beforeEach } from "vitest";
import type { WalletService } from "../services/wallet.service.js";
import {
  InsufficientFundsError,
  TransferSelfError,
  WalletNotFoundError,
} from "../services/wallet.service.js";
import { WalletController } from "./wallet.controller.js";

const mockProcessEntryFee = vi.fn();
const mockDepositFunds = vi.fn();
const mockGetWalletForUser = vi.fn();
const mockFundWalletAtomic = vi.fn();
const mockTransferP2P = vi.fn();

function createController() {
  const walletService = {
    processEntryFee: mockProcessEntryFee,
    depositFunds: mockDepositFunds,
    getWalletForUser: mockGetWalletForUser,
    fundWalletAtomic: mockFundWalletAtomic,
    transferP2P: mockTransferP2P,
  } as unknown as WalletService;
  return new WalletController(walletService);
}

type ChargeBody = {
  amount?: unknown;
  referenceId?: unknown;
};

type MockRequest = {
  user?: { id: string };
  body: ChargeBody | FundBody;
};

type FundBody = { targetUserId?: unknown; amount?: unknown };

function createMockResponse() {
  const res = {
    status: vi.fn(),
    json: vi.fn(),
  };
  res.status.mockImplementation(() => res);
  return res as {
    status: ReturnType<typeof vi.fn>;
    json: ReturnType<typeof vi.fn>;
  };
}

describe("WalletController.chargeEntryFee", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProcessEntryFee.mockReset();
    mockDepositFunds.mockReset();
    mockGetWalletForUser.mockReset();
    mockFundWalletAtomic.mockReset();
    mockTransferP2P.mockReset();
  });

  it("returns 200 and serializes BigInt fields in the transaction payload to strings", async () => {
    const createdAt = new Date("2026-03-28T12:00:00.000Z");
    mockProcessEntryFee.mockResolvedValue({
      id: "txn_fee_1",
      walletId: "wal_1",
      amount: -2500n,
      referenceId: "match-lobby-42",
      createdAt,
    });

    const req: MockRequest = {
      user: { id: "usr_1" },
      body: {
        amount: "2500",
        referenceId: "match-lobby-42",
      },
    };
    const res = createMockResponse();

    const controller = createController();
    await controller.chargeEntryFee(req as never, res as never);

    expect(mockProcessEntryFee).toHaveBeenCalledWith("usr_1", 2500n, "match-lobby-42");
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledTimes(1);
    const payload = res.json.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload).toMatchObject({
      id: "txn_fee_1",
      walletId: "wal_1",
      amount: "-2500",
      referenceId: "match-lobby-42",
    });
    expect(typeof payload?.amount).toBe("string");
  });

  it("returns 401 when req.user is missing or has empty id", async () => {
    const controller = createController();

    const cases: MockRequest[] = [
      { body: { amount: "10", referenceId: "r1" } },
      { user: { id: "" }, body: { amount: "10", referenceId: "r1" } },
      { user: { id: "   " }, body: { amount: "10", referenceId: "r1" } },
    ];

    for (const req of cases) {
      mockProcessEntryFee.mockClear();
      const res = createMockResponse();
      await controller.chargeEntryFee(req as never, res as never);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(mockProcessEntryFee).not.toHaveBeenCalled();
    }
  });

  it("returns 400 and does not call WalletService when payload is invalid", async () => {
    const controller = createController();

    const cases: MockRequest[] = [
      { user: { id: "u1" }, body: { amount: "10" } },
      { user: { id: "u1" }, body: { referenceId: "r1" } },
      { user: { id: "u1" }, body: { amount: "x", referenceId: "r1" } },
      { user: { id: "u1" }, body: { amount: "1.5", referenceId: "r1" } },
      { user: { id: "u1" }, body: { amount: "", referenceId: "r1" } },
      { user: { id: "u1" }, body: { amount: "10", referenceId: "" } },
    ];

    for (const req of cases) {
      mockProcessEntryFee.mockClear();
      const res = createMockResponse();
      await controller.chargeEntryFee(req as never, res as never);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(mockProcessEntryFee).not.toHaveBeenCalled();
    }
  });

  it("returns 402 when WalletService throws InsufficientFundsError", async () => {
    mockProcessEntryFee.mockRejectedValue(new InsufficientFundsError());

    const req: MockRequest = {
      user: { id: "usr_2" },
      body: {
        amount: "999999",
        referenceId: "match-lobby-99",
      },
    };
    const res = createMockResponse();

    const controller = createController();
    await controller.chargeEntryFee(req as never, res as never);

    expect(res.status).toHaveBeenCalledWith(402);
    expect(res.json).toHaveBeenCalled();
  });
});

type DepositBody = {
  amount?: unknown;
  referenceId?: unknown;
};

describe("WalletController.deposit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProcessEntryFee.mockReset();
    mockDepositFunds.mockReset();
    mockGetWalletForUser.mockReset();
    mockFundWalletAtomic.mockReset();
    mockTransferP2P.mockReset();
  });

  it("returns 400 when amount or referenceId is missing or amount is not digits-only", async () => {
    const controller = createController();

    const cases: MockRequest[] = [
      { user: { id: "u1" }, body: { amount: "100", referenceId: undefined } as DepositBody },
      { user: { id: "u1" }, body: { referenceId: "r1" } as DepositBody },
      { user: { id: "u1" }, body: { amount: "x", referenceId: "r1" } as DepositBody },
      { user: { id: "u1" }, body: { amount: "1.5", referenceId: "r1" } as DepositBody },
      { user: { id: "u1" }, body: { amount: "", referenceId: "r1" } as DepositBody },
      { user: { id: "u1" }, body: { amount: "100", referenceId: "" } as DepositBody },
    ];

    for (const req of cases) {
      mockDepositFunds.mockClear();
      const res = createMockResponse();
      await controller.deposit(req as never, res as never);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(mockDepositFunds).not.toHaveBeenCalled();
    }
  });

  it("returns 401 when req.user is missing or has empty id", async () => {
    const controller = createController();

    const cases: MockRequest[] = [
      { body: { amount: "5000", referenceId: "dep-1" } as DepositBody },
      { user: { id: "" }, body: { amount: "5000", referenceId: "dep-1" } as DepositBody },
    ];

    for (const req of cases) {
      mockDepositFunds.mockClear();
      const res = createMockResponse();
      await controller.deposit(req as never, res as never);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(mockDepositFunds).not.toHaveBeenCalled();
    }
  });

  it("returns 200 with transaction JSON BigInt fields as strings, using req.user.id and parsed amount", async () => {
    const createdAt = new Date("2026-06-10T15:30:00.000Z");
    mockDepositFunds.mockResolvedValue({
      transaction: {
        id: "txn_dep_ok",
        walletId: "wal_user_9",
        amount: 7500n,
        referenceId: "stripe-ch_abc",
        type: "DEPOSIT",
        createdAt,
      },
      created: true,
    });

    const req: MockRequest = {
      user: { id: "usr_from_jwt" },
      body: { amount: "7500", referenceId: "stripe-ch_abc" } as DepositBody,
    };
    const res = createMockResponse();

    const controller = createController();
    await controller.deposit(req as never, res as never);

    expect(mockDepositFunds).toHaveBeenCalledWith("usr_from_jwt", 7500n, "stripe-ch_abc");
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "txn_dep_ok",
        walletId: "wal_user_9",
        amount: "7500",
        referenceId: "stripe-ch_abc",
        type: "DEPOSIT",
        createdAt,
      }),
    );
    const payload = res.json.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(typeof payload?.amount).toBe("string");
  });
});

describe("WalletController.getMyWallet", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetWalletForUser.mockReset();
    mockFundWalletAtomic.mockReset();
    mockTransferP2P.mockReset();
    mockProcessEntryFee.mockReset();
    mockDepositFunds.mockReset();
  });

  it("returns 401 when user id is missing", async () => {
    const controller = createController();
    const res = createMockResponse();
    await controller.getMyWallet({ body: {} } as never, res as never);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(mockGetWalletForUser).not.toHaveBeenCalled();
  });

  it("returns 404 when wallet does not exist", async () => {
    mockGetWalletForUser.mockResolvedValue(null);
    const controller = createController();
    const res = createMockResponse();
    await controller.getMyWallet({ user: { id: "u1" } } as never, res as never);
    expect(mockGetWalletForUser).toHaveBeenCalledWith("u1");
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("returns 200 with walletId and balance as string", async () => {
    const updatedAt = new Date("2026-04-01T12:00:00.000Z");
    mockGetWalletForUser.mockResolvedValue({
      id: "wal_1",
      balance: 100n,
      updatedAt,
    });
    const controller = createController();
    const res = createMockResponse();
    await controller.getMyWallet({ user: { id: "u1" } } as never, res as never);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      walletId: "wal_1",
      balance: "100",
      updatedAt,
    });
  });
});

describe("WalletController.fundWallet", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFundWalletAtomic.mockReset();
    mockGetWalletForUser.mockReset();
    mockTransferP2P.mockReset();
    mockProcessEntryFee.mockReset();
    mockDepositFunds.mockReset();
  });

  it("returns 400 when body is invalid", async () => {
    const controller = createController();
    const res = createMockResponse();
    await controller.fundWallet(
      { body: { targetUserId: "", amount: "10" } } as never,
      res as never,
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockFundWalletAtomic).not.toHaveBeenCalled();
  });

  it("returns 404 when target wallet is missing", async () => {
    mockFundWalletAtomic.mockRejectedValue(new WalletNotFoundError());
    const controller = createController();
    const res = createMockResponse();
    await controller.fundWallet(
      {
        body: { targetUserId: "target-1", amount: "500" },
      } as never,
      res as never,
    );
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("returns 200 with new balance string", async () => {
    mockFundWalletAtomic.mockResolvedValue({ balance: 1500n });
    const controller = createController();
    const res = createMockResponse();
    await controller.fundWallet(
      {
        body: { targetUserId: "target-1", amount: "500" },
      } as never,
      res as never,
    );
    expect(mockFundWalletAtomic).toHaveBeenCalledWith("target-1", 500n);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      message: "Konto zasilone pomyślnie.",
      newBalance: "1500",
    });
  });
});

describe("WalletController.transfer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTransferP2P.mockReset();
    mockFundWalletAtomic.mockReset();
    mockGetWalletForUser.mockReset();
    mockProcessEntryFee.mockReset();
    mockDepositFunds.mockReset();
  });

  it("returns 401 without user", async () => {
    const controller = createController();
    const res = createMockResponse();
    await controller.transfer(
      { body: { toUserId: "b", amount: "1", referenceId: "r1" } } as never,
      res as never,
    );
    expect(res.status).toHaveBeenCalledWith(401);
    expect(mockTransferP2P).not.toHaveBeenCalled();
  });

  it("returns 200 when transfer succeeds", async () => {
    mockTransferP2P.mockResolvedValue({ idempotent: false });
    const controller = createController();
    const res = createMockResponse();
    await controller.transfer(
      {
        user: { id: "a" },
        body: { toUserId: "b", amount: "50", referenceId: "pay-1" },
      } as never,
      res as never,
    );
    expect(mockTransferP2P).toHaveBeenCalledWith("a", "b", 50n, "pay-1");
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotent: false,
        message: "Przelew wykonany pomyślnie.",
      }),
    );
  });

  it("returns 400 when body is invalid", async () => {
    const controller = createController();
    const res = createMockResponse();
    await controller.transfer(
      {
        user: { id: "a" },
        body: { toUserId: "", amount: "10", referenceId: "r" },
      } as never,
      res as never,
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockTransferP2P).not.toHaveBeenCalled();
  });

  it("returns 200 with idempotent message when service reports idempotent", async () => {
    mockTransferP2P.mockResolvedValue({ idempotent: true });
    const controller = createController();
    const res = createMockResponse();
    await controller.transfer(
      {
        user: { id: "a" },
        body: { toUserId: "b", amount: "1", referenceId: "idem-x" },
      } as never,
      res as never,
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      message: "Transakcja już wcześniej zaksięgowana (idempotentność).",
      idempotent: true,
    });
  });

  it("returns 400 on TransferSelfError", async () => {
    mockTransferP2P.mockRejectedValue(new TransferSelfError());
    const controller = createController();
    const res = createMockResponse();
    await controller.transfer(
      {
        user: { id: "same" },
        body: { toUserId: "same", amount: "1", referenceId: "r1" },
      } as never,
      res as never,
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: "Nie można przelać na to samo konto.",
      code: "BAD_REQUEST",
    });
  });

  it("returns 404 on WalletNotFoundError", async () => {
    mockTransferP2P.mockRejectedValue(new WalletNotFoundError());
    const controller = createController();
    const res = createMockResponse();
    await controller.transfer(
      {
        user: { id: "a" },
        body: { toUserId: "b", amount: "1", referenceId: "r1" },
      } as never,
      res as never,
    );
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      error: "Portfel nadawcy lub odbiorcy nie istnieje.",
      code: "NOT_FOUND",
    });
  });

  it("returns 402 on InsufficientFundsError", async () => {
    mockTransferP2P.mockRejectedValue(new InsufficientFundsError());
    const controller = createController();
    const res = createMockResponse();
    await controller.transfer(
      {
        user: { id: "a" },
        body: { toUserId: "b", amount: "1", referenceId: "r1" },
      } as never,
      res as never,
    );
    expect(res.status).toHaveBeenCalledWith(402);
    expect(res.json).toHaveBeenCalledWith({
      error: "Niewystarczające środki.",
      code: "PAYMENT_REQUIRED",
    });
  });

  it("returns 400 on RangeError from service", async () => {
    mockTransferP2P.mockRejectedValue(new RangeError("referenceId is required"));
    const controller = createController();
    const res = createMockResponse();
    await controller.transfer(
      {
        user: { id: "a" },
        body: { toUserId: "b", amount: "1", referenceId: "x" },
      } as never,
      res as never,
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: "referenceId is required",
      code: "BAD_REQUEST",
    });
  });

  it("returns 500 on unexpected errors", async () => {
    const logSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockTransferP2P.mockRejectedValue(new Error("db boom"));
    const controller = createController();
    const res = createMockResponse();
    await controller.transfer(
      {
        user: { id: "a" },
        body: { toUserId: "b", amount: "1", referenceId: "r1" },
      } as never,
      res as never,
    );
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      error: "Błąd serwera przy przelewie.",
      code: "INTERNAL_ERROR",
    });
    logSpy.mockRestore();
  });
});
