import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { isInsufficientFundsDbError } from "./prisma-wallet-errors.js";

describe("isInsufficientFundsDbError", () => {
  it("zwraca true dla P2025", () => {
    const err = new Prisma.PrismaClientKnownRequestError("x", {
      code: "P2025",
      clientVersion: "test",
    });
    expect(isInsufficientFundsDbError(err)).toBe(true);
  });

  it("zwraca true dla constraint wallet_balance_check", () => {
    const err = new Prisma.PrismaClientKnownRequestError("check", {
      code: "P2002",
      clientVersion: "test",
      meta: { constraint: "wallet_balance_check" },
    });
    expect(isInsufficientFundsDbError(err)).toBe(true);
  });

  it("zwraca false dla zwykłego błędu", () => {
    expect(isInsufficientFundsDbError(new Error("other"))).toBe(false);
  });
});
