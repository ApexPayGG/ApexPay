import { describe, it, expect, vi, beforeEach } from "vitest";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { Prisma, UserRole } from "@prisma/client";
import {
  AuthService,
  EmailAlreadyRegisteredError,
  InvalidCredentialsError,
} from "./auth.service.js";

vi.mock("bcrypt", () => ({
  default: {
    hash: vi.fn().mockResolvedValue("hashed-password-stub"),
    compare: vi.fn(),
  },
}));

vi.mock("jsonwebtoken", () => ({
  default: {
    sign: vi.fn().mockReturnValue("jwt-token-stub"),
  },
}));

type TxMock = {
  user: { create: ReturnType<typeof vi.fn> };
  wallet: { create: ReturnType<typeof vi.fn> };
};

function createServiceWithPrisma(prisma: { $transaction: ReturnType<typeof vi.fn> }) {
  return new AuthService(prisma as never);
}

describe("AuthService.registerUser", () => {
  let prisma: { $transaction: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    prisma = { $transaction: vi.fn() };
    vi.mocked(bcrypt.hash).mockClear();
    vi.mocked(bcrypt.hash).mockResolvedValue("hashed-password-stub" as never);
    vi.mocked(bcrypt.compare).mockReset();
    vi.mocked(jwt.sign).mockClear();
    vi.mocked(jwt.sign).mockReturnValue("jwt-token-stub" as never);
  });

  it("hashes password with at least 12 bcrypt rounds", async () => {
    const mockUser = {
      id: "u1",
      email: "a@b.co",
      role: UserRole.PLAYER,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    prisma.$transaction.mockImplementation(async (fn: (tx: TxMock) => Promise<unknown>) => {
      const tx: TxMock = {
        user: { create: vi.fn().mockResolvedValue(mockUser) },
        wallet: { create: vi.fn().mockResolvedValue({}) },
      };
      return fn(tx);
    });

    const service = createServiceWithPrisma(prisma);
    await service.registerUser("a@b.co", "validpassword12");

    expect(bcrypt.hash).toHaveBeenCalledWith("validpassword12", 12);
  });

  it("creates user and wallet in one transaction with zero balance", async () => {
    const mockUser = {
      id: "u1",
      email: "a@b.co",
      role: UserRole.PLAYER,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const userCreate = vi.fn().mockResolvedValue(mockUser);
    const walletCreate = vi.fn().mockResolvedValue({});
    prisma.$transaction.mockImplementation(async (fn: (tx: TxMock) => Promise<unknown>) => {
      return fn({
        user: { create: userCreate },
        wallet: { create: walletCreate },
      });
    });

    const service = createServiceWithPrisma(prisma);
    const result = await service.registerUser("a@b.co", "validpassword12");

    expect(userCreate).toHaveBeenCalledTimes(1);
    expect(walletCreate).toHaveBeenCalledTimes(1);
    expect(walletCreate.mock.calls[0]?.[0]).toMatchObject({
      data: { userId: "u1", balance: 0n },
    });
    expect(userCreate.mock.calls[0]?.[0]).toMatchObject({
      data: expect.objectContaining({
        email: "a@b.co",
        role: UserRole.PLAYER,
      }),
    });
    expect(result).toEqual(mockUser);
  });

  it("normalizes email to lowercase before persisting", async () => {
    const mockUser = {
      id: "u1",
      email: "user@example.com",
      role: UserRole.PLAYER,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const userCreate = vi.fn().mockResolvedValue(mockUser);
    const walletCreate = vi.fn().mockResolvedValue({});
    prisma.$transaction.mockImplementation(async (fn: (tx: TxMock) => Promise<unknown>) => {
      return fn({
        user: { create: userCreate },
        wallet: { create: walletCreate },
      });
    });

    const service = createServiceWithPrisma(prisma);
    await service.registerUser("  User@EXAMPLE.com  ", "validpassword12");

    expect(userCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ email: "user@example.com" }),
      }),
    );
  });

  it("fails the operation when wallet creation fails (callback rejects)", async () => {
    const mockUser = {
      id: "u1",
      email: "a@b.co",
      role: UserRole.PLAYER,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    prisma.$transaction.mockImplementation(async (fn: (tx: TxMock) => Promise<unknown>) => {
      return fn({
        user: { create: vi.fn().mockResolvedValue(mockUser) },
        wallet: { create: vi.fn().mockRejectedValue(new Error("wallet insert failed")) },
      });
    });

    const service = createServiceWithPrisma(prisma);
    await expect(service.registerUser("a@b.co", "validpassword12")).rejects.toThrow(
      "wallet insert failed",
    );
  });

  it("maps unique constraint violation to EmailAlreadyRegisteredError", async () => {
    const err = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "test",
    });
    prisma.$transaction.mockRejectedValue(err);

    const service = createServiceWithPrisma(prisma);
    await expect(service.registerUser("dup@b.co", "validpassword12")).rejects.toBeInstanceOf(
      EmailAlreadyRegisteredError,
    );
  });

  it("rejects invalid email", async () => {
    const service = createServiceWithPrisma(prisma);
    await expect(service.registerUser("not-an-email", "validpassword12")).rejects.toThrow();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects password shorter than minimum length", async () => {
    const service = createServiceWithPrisma(prisma);
    await expect(service.registerUser("a@b.co", "short")).rejects.toThrow();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects invalid role value", async () => {
    const service = createServiceWithPrisma(prisma);
    await expect(
      service.registerUser("a@b.co", "validpassword12", "NOT_A_ROLE"),
    ).rejects.toThrow();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects ADMIN role on public registration", async () => {
    const service = createServiceWithPrisma(prisma);
    await expect(
      service.registerUser("a@b.co", "validpassword12", UserRole.ADMIN),
    ).rejects.toThrow(/ADMIN/);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe("AuthService.loginUser", () => {
  const DUMMY_HASH = "$2b$12$ThisIsADummyHashForTimingAttack12345";

  let prisma: {
    user: { findUnique: ReturnType<typeof vi.fn> };
  };

  beforeEach(() => {
    prisma = {
      user: { findUnique: vi.fn() },
    };
    vi.mocked(bcrypt.compare).mockReset();
    vi.mocked(jwt.sign).mockClear();
    vi.mocked(jwt.sign).mockReturnValue("signed-access-token" as never);
  });

  it("throws InvalidCredentialsError when user does not exist", async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    vi.mocked(bcrypt.compare).mockResolvedValue(false as never);

    const service = createServiceWithPrisma(prisma as never);
    await expect(service.loginUser("player@example.com", "validpassword12")).rejects.toBeInstanceOf(
      InvalidCredentialsError,
    );

    expect(bcrypt.compare).toHaveBeenCalledWith("validpassword12", DUMMY_HASH);
    expect(jwt.sign).not.toHaveBeenCalled();
  });

  it("throws InvalidCredentialsError when bcrypt.compare returns false", async () => {
    const createdAt = new Date("2026-01-01T00:00:00.000Z");
    const updatedAt = new Date("2026-01-01T00:00:00.000Z");
    prisma.user.findUnique.mockResolvedValue({
      id: "usr_db_1",
      email: "player@example.com",
      role: UserRole.PLAYER,
      passwordHash: "stored-hash",
      createdAt,
      updatedAt,
    });
    vi.mocked(bcrypt.compare).mockResolvedValue(false as never);

    const service = createServiceWithPrisma(prisma as never);
    await expect(service.loginUser("player@example.com", "wrongpassword")).rejects.toBeInstanceOf(
      InvalidCredentialsError,
    );

    expect(bcrypt.compare).toHaveBeenCalledWith("wrongpassword", "stored-hash");
    expect(jwt.sign).not.toHaveBeenCalled();
  });

  it("calls jwt.sign and returns token plus user without password when credentials match", async () => {
    const createdAt = new Date("2026-03-01T08:00:00.000Z");
    const updatedAt = new Date("2026-03-01T08:00:00.000Z");
    prisma.user.findUnique.mockResolvedValue({
      id: "usr_db_2",
      email: "winner@example.com",
      role: UserRole.PLAYER,
      passwordHash: "stored-hash-2",
      createdAt,
      updatedAt,
    });
    vi.mocked(bcrypt.compare).mockResolvedValue(true as never);
    vi.mocked(jwt.sign).mockReturnValue("jwt-signed-value" as never);

    const service = createServiceWithPrisma(prisma as never);
    const result = await service.loginUser("winner@example.com", "validpassword12");

    expect(jwt.sign).toHaveBeenCalled();
    const signPayload = vi.mocked(jwt.sign).mock.calls[0]?.[0] as Record<string, unknown>;
    expect(signPayload).toMatchObject({
      userId: "usr_db_2",
      email: "winner@example.com",
      role: UserRole.PLAYER,
    });

    expect(result).toEqual({
      token: "jwt-signed-value",
      user: {
        id: "usr_db_2",
        email: "winner@example.com",
        role: UserRole.PLAYER,
        createdAt,
        updatedAt,
      },
    });
    expect(result.user).not.toHaveProperty("passwordHash");
    expect(result.user).not.toHaveProperty("password");
  });
});
