import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { contextLogger } from "./logger.js";
import { getContext, runWithContext } from "./request-context.js";

/**
 * Weryfikuje, że `traceId` z AsyncLocalStorage jest dostępny wewnątrz callbacka
 * `await prisma.$transaction(...)` — ten sam wzorzec co w serwisach (łańcuch async).
 *
 * Mock naśladuje kilka przejść przez kolejkę mikrozadań (jak wewnętrzne await Prisma),
 * zanim wywoła callback transakcji.
 */
describe("AsyncLocalStorage + prisma.$transaction (callback)", () => {
  function createPrismaMock(): Pick<PrismaClient, "$transaction"> {
    return {
      $transaction: async (
        fn: (tx: { _: "tx" }) => Promise<unknown>,
      ): Promise<unknown> => {
        await Promise.resolve();
        await new Promise<void>((resolve) => queueMicrotask(resolve));
        return fn({ _: "tx" });
      },
    };
  }

  it("zachowuje traceId w callbacku $transaction (contextLogger + getContext)", async () => {
    const prisma = createPrismaMock();
    const traceId = "trace-als-prisma-txn-1";

    await runWithContext({ traceId }, () =>
      prisma.$transaction(async () => {
        expect(getContext().traceId).toBe(traceId);
        expect(contextLogger().bindings().traceId).toBe(traceId);
      }),
    );
  });
});
