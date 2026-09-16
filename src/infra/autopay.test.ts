import { describe, expect, it } from "vitest";
import {
  AUTOPAY_ORDER_ID_PATTERN,
  createAutopayOrderId,
  generateHash,
  verifyHash,
} from "./autopay.js";

describe("Autopay hash helpers", () => {
  it("generateHash zwraca poprawny SHA-256 hex dla przykładu", () => {
    process.env.AUTOPAY_SHARED_KEY = "testkey123";
    const fields = ["123456", "ORDER123", "35.50", "Test", "test@test.pl"];
    const out = generateHash(fields);
    expect(out).toBe("9868eb9dfcd5e5d79a638812ae9afbaad13b1e3ab44eb5f8805ad79540b05d67");
    expect(out).toMatch(/^[0-9a-f]{64}$/);
  });

  it("verifyHash accepts the official Autopay ITN example string", () => {
    process.env.AUTOPAY_SHARED_KEY = "1test1";
    expect(
      verifyHash(
        ["1", "11", "91", "11.11", "PLN", "1", "20010101111111", "SUCCESS", "AUTHORIZED"],
        "a103bfe581a938e9ad78238cfc674ffafdd6ec70cb6825e7ed5c41787671efe4",
      ),
    ).toBe(true);
  });

  it("verifyHash odrzuca niepasujący skrót", () => {
    process.env.AUTOPAY_SHARED_KEY = "testkey123";
    const fields = ["123456", "ORDER123", "35.50", "Test", "test@test.pl"];
    const valid = "9868eb9dfcd5e5d79a638812ae9afbaad13b1e3ab44eb5f8805ad79540b05d67";
    expect(verifyHash(fields, valid)).toBe(true);
    expect(verifyHash(fields, `x${valid.slice(1)}`)).toBe(false);
  });

  it("createAutopayOrderId spełnia limit 32 znaków Autopay [A-Za-z0-9_-]", () => {
    const id = createAutopayOrderId();
    expect(id).toMatch(AUTOPAY_ORDER_ID_PATTERN);
    expect(id.length).toBe(32);
  });
});
