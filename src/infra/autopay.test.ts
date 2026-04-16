import { describe, expect, it } from "vitest";
import { generateHash, verifyHash } from "./autopay.js";

describe("Autopay hash helpers", () => {
  it("generateHash zwraca poprawny SHA-256 hex dla przykładu", () => {
    process.env.AUTOPAY_SHARED_KEY = "testkey123";
    const fields = ["123456", "ORDER123", "35.50", "Test", "test@test.pl"];
    const out = generateHash(fields);
    expect(out).toBe("9868eb9dfcd5e5d79a638812ae9afbaad13b1e3ab44eb5f8805ad79540b05d67");
    expect(out).toMatch(/^[0-9a-f]{64}$/);
  });

  it("verifyHash porównuje hash poprawnie", () => {
    process.env.AUTOPAY_SHARED_KEY = "testkey123";
    const fields = ["123456", "ORDER123", "35.50", "Test", "test@test.pl"];
    const valid = "9868eb9dfcd5e5d79a638812ae9afbaad13b1e3ab44eb5f8805ad79540b05d67";
    expect(verifyHash(fields, valid)).toBe(true);
    expect(verifyHash(fields, `x${valid.slice(1)}`)).toBe(false);
  });
});
