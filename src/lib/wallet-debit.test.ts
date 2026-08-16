import { describe, expect, it, vi } from "vitest";
import { debitWalletIfSufficient } from "./wallet-debit.js";

describe("debitWalletIfSufficient", () => {
  it("returns false when no wallet row has balance >= amount", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });

    const ok = await debitWalletIfSufficient(
      { wallet: { updateMany } },
      "u1",
      500n,
    );

    expect(ok).toBe(false);
    expect(updateMany).toHaveBeenCalledWith({
      where: { userId: "u1", balance: { gte: 500n } },
      data: { balance: { decrement: 500n } },
    });
  });

  it("returns true only when exactly one row is decremented", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });

    const ok = await debitWalletIfSufficient(
      { wallet: { updateMany } },
      "u1",
      500n,
    );

    expect(ok).toBe(true);
  });
});
