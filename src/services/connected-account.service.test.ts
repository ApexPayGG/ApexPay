import { describe, expect, it, vi } from "vitest";
import { Prisma, ConnectedAccountSubjectType } from "@prisma/client";
import {
  ConnectedAccountDuplicateError,
  ConnectedAccountService,
} from "./connected-account.service.js";

describe("ConnectedAccountService.createForIntegration", () => {
  it("tworzy rekord z normalizowanym emailem i krajem", async () => {
    const created = {
      id: "ca_1",
      integratorUserId: "int1",
      userId: null,
      email: "a@b.co",
      subjectType: ConnectedAccountSubjectType.INDIVIDUAL,
      country: "PL",
      status: "PENDING",
      kycReferenceId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const create = vi.fn().mockResolvedValue(created);
    const prisma = {
      $transaction: vi.fn(async (fn: (tx: { connectedAccount: { create: typeof create } }) => Promise<unknown>) =>
        fn({ connectedAccount: { create } }),
      ),
    } as never;
    const service = new ConnectedAccountService(prisma);

    const out = await service.createForIntegration("int1", {
      email: "  A@B.CO ",
      subjectType: ConnectedAccountSubjectType.INDIVIDUAL,
      country: "pl",
    });

    expect(out).toEqual(created);
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        integratorUserId: "int1",
        email: "a@b.co",
        subjectType: ConnectedAccountSubjectType.INDIVIDUAL,
        country: "PL",
      }),
    });
  });

  it("rzuca RangeError gdy country nie ma 2 znaków", async () => {
    const service = new ConnectedAccountService({} as never);
    await expect(
      service.createForIntegration("int1", {
        email: "a@b.co",
        subjectType: ConnectedAccountSubjectType.COMPANY,
        country: "POL",
      }),
    ).rejects.toBeInstanceOf(RangeError);
  });

  it("mapuje P2002 na ConnectedAccountDuplicateError", async () => {
    const err = new Prisma.PrismaClientKnownRequestError("duplicate", {
      code: "P2002",
      clientVersion: "test",
    });
    const create = vi.fn().mockRejectedValue(err);
    const prisma = {
      $transaction: vi.fn(async (fn: (tx: { connectedAccount: { create: typeof create } }) => Promise<unknown>) =>
        fn({ connectedAccount: { create } }),
      ),
    } as never;
    const service = new ConnectedAccountService(prisma);

    await expect(
      service.createForIntegration("int1", {
        email: "a@b.co",
        subjectType: ConnectedAccountSubjectType.INDIVIDUAL,
        country: "DE",
      }),
    ).rejects.toBeInstanceOf(ConnectedAccountDuplicateError);
  });
});
