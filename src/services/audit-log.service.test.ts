import { describe, expect, it, vi } from "vitest";
import type { Request } from "express";
import { AuditAction, AuditActorType, type PrismaClient } from "@prisma/client";
import { AuditLogService } from "./audit-log.service.js";

describe("AuditLogService.log", () => {
  it("wywołuje tx.auditLog.create z scalonymi polami i nagłówkami z Request", async () => {
    const create = vi.fn().mockResolvedValue({
      id: "log_cuid",
      actorId: "user-1",
      actorType: AuditActorType.USER,
      action: AuditAction.API_KEY_CREATED,
      entityType: "ApiKey",
      entityId: "key1",
      metadata: {},
      ipAddress: "203.0.113.1",
      userAgent: "vitest",
      createdAt: new Date(),
    });

    const tx = { auditLog: { create } };

    const service = new AuditLogService({} as PrismaClient);

    const req = {
      headers: {
        "x-forwarded-for": "203.0.113.1, 10.0.0.1",
        "user-agent": "vitest",
      },
      socket: { remoteAddress: "::1" },
    } as unknown as Request;

    await service.log(
      tx as never,
      {
        actorId: "user-1",
        actorType: AuditActorType.USER,
        action: AuditAction.API_KEY_CREATED,
        entityType: "ApiKey",
        entityId: "key1",
        metadata: { name: "test" },
      },
      req,
    );

    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorId: "user-1",
        actorType: AuditActorType.USER,
        action: AuditAction.API_KEY_CREATED,
        entityType: "ApiKey",
        entityId: "key1",
        metadata: { name: "test" },
        ipAddress: "203.0.113.1",
        userAgent: "vitest",
      }),
    });
  });

  it("nie nadpisuje jawnie podanego ipAddress gdy jest req", async () => {
    const create = vi.fn().mockResolvedValue({ id: "x" });
    const tx = { auditLog: { create } };
    const service = new AuditLogService({} as PrismaClient);
    const req = {
      headers: { "x-forwarded-for": "10.0.0.1" },
    } as unknown as Request;

    await service.log(
      tx as never,
      {
        actorId: null,
        actorType: AuditActorType.SYSTEM,
        action: AuditAction.WALLET_CREDITED,
        entityType: "Wallet",
        entityId: "w1",
        metadata: {},
        ipAddress: "192.168.1.1",
      },
      req,
    );

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({ ipAddress: "192.168.1.1" }),
    });
  });
});
