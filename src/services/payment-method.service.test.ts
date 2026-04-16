import { describe, expect, it, vi } from "vitest";
import { Prisma, PaymentMethodProvider, type PrismaClient } from "@prisma/client";
import {
  PaymentMethodDuplicateError,
  PaymentMethodService,
  createPaymentMethodBodySchema,
} from "./payment-method.service.js";

describe("createPaymentMethodBodySchema", () => {
  it("parsuje minimalny poprawny body", () => {
    const out = createPaymentMethodBodySchema.parse({
      provider: "MOCK_PSP",
      token: "pm_123",
      type: "CARD",
    });
    expect(out).toMatchObject({
      provider: "MOCK_PSP",
      token: "pm_123",
      type: "CARD",
    });
  });

  it("odrzuca dodatkowe klucze (strict)", () => {
    expect(() =>
      createPaymentMethodBodySchema.parse({
        provider: "MOCK_PSP",
        token: "pm_1",
        type: "CARD",
        extra: 1,
      }),
    ).toThrow();
  });
});

describe("PaymentMethodService.createForUser", () => {
  it("rzuca PaymentMethodDuplicateError przy P2002 na provider+token", async () => {
    const err = new Prisma.PrismaClientKnownRequestError("unique", {
      code: "P2002",
      clientVersion: "test",
      meta: { target: ["provider", "token"] },
    });
    const tx = {
      paymentMethod: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        create: vi.fn().mockRejectedValue(err),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    } as unknown as PrismaClient;
    const service = new PaymentMethodService(prisma);

    await expect(
      service.createForUser("u1", {
        provider: PaymentMethodProvider.MOCK_PSP,
        token: "dup",
        type: "CARD",
      }),
    ).rejects.toBeInstanceOf(PaymentMethodDuplicateError);
  });

  it("przy isDefault wywołuje updateMany przed create", async () => {
    const created = {
      id: "pm1",
      userId: "u1",
      provider: PaymentMethodProvider.STRIPE,
      token: "pm_x",
      type: "CARD",
      last4: "4242",
      expMonth: 12,
      expYear: 2030,
      isDefault: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const updateMany = vi.fn().mockResolvedValue({ count: 2 });
    const create = vi.fn().mockResolvedValue(created);
    const tx = {
      paymentMethod: { updateMany, create },
    };
    const prisma = {
      $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    } as unknown as PrismaClient;
    const service = new PaymentMethodService(prisma);

    const out = await service.createForUser("u1", {
      provider: PaymentMethodProvider.STRIPE,
      token: "pm_x",
      type: "CARD",
      last4: "4242",
      expMonth: 12,
      expYear: 2030,
      isDefault: true,
    });

    expect(updateMany).toHaveBeenCalledWith({
      where: { userId: "u1" },
      data: { isDefault: false },
    });
    expect(create).toHaveBeenCalled();
    expect(out).toEqual(created);
  });
});
