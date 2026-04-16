import { describe, expect, it } from "vitest";
import { contextLogger } from "./logger.js";
import { runWithContext } from "./request-context.js";

describe("contextLogger + AsyncLocalStorage", () => {
  it("child logger zawiera traceId z runWithContext", () => {
    runWithContext({ traceId: "trace-unit-test-1" }, () => {
      const log = contextLogger();
      expect(log.bindings().traceId).toBe("trace-unit-test-1");
    });
  });

  it("poza kontekstem bindings bez traceId (root)", () => {
    const log = contextLogger();
    const b = log.bindings();
    expect(b.traceId).toBeUndefined();
  });
});
