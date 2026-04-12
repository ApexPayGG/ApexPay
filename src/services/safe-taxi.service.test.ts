import { describe, it, expect } from "vitest";
import { SafeTaxiConfigError, splitSafeTaxiFare } from "./safe-taxi.service.js";

describe("splitSafeTaxiFare", () => {
  it("15% z 10000 gr → 1500 + 8500", () => {
    const out = splitSafeTaxiFare(10000n, 1500n);
    expect(out.platformCents).toBe(1500n);
    expect(out.driverCents).toBe(8500n);
  });

  it("0% → całość dla kierowcy", () => {
    const out = splitSafeTaxiFare(5000n, 0n);
    expect(out.platformCents).toBe(0n);
    expect(out.driverCents).toBe(5000n);
  });

  it("odrzuca bps > 10000", () => {
    expect(() => splitSafeTaxiFare(100n, 10001n)).toThrow(SafeTaxiConfigError);
  });
});
