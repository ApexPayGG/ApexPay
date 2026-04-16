import type { Request } from "express";
import type {
  AuditAction,
  AuditActorType,
  AuditLog,
  Prisma,
  PrismaClient,
} from "@prisma/client";

export type AuditLogEntryInput = {
  actorId?: string | null;
  actorType: AuditActorType;
  action: AuditAction;
  entityType: string;
  entityId: string;
  metadata: Prisma.InputJsonValue;
  ipAddress?: string | null;
  userAgent?: string | null;
};

function clientIpFromRequest(req: Request): string | undefined {
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.trim().length > 0) {
    const first = xff.split(",")[0]?.trim();
    if (first !== undefined && first.length > 0) {
      return first.slice(0, 256);
    }
  }
  const rip = req.socket?.remoteAddress;
  if (typeof rip === "string" && rip.length > 0) {
    return rip.slice(0, 256);
  }
  return undefined;
}

function userAgentFromRequest(req: Request): string | undefined {
  const ua = req.headers["user-agent"];
  if (typeof ua !== "string" || ua.length === 0) {
    return undefined;
  }
  return ua.slice(0, 2048);
}

export type AuditListFilters = {
  actorId?: string;
  entityType?: string;
  entityId?: string;
  action?: AuditAction;
  from?: Date;
  to?: Date;
};

/**
 * Append-only audit log. `log` zawsze w ramach przekazanego `tx` (bez własnej transakcji).
 */
export class AuditLogService {
  constructor(private readonly prisma: PrismaClient) {}

  async log(
    tx: Prisma.TransactionClient,
    entry: AuditLogEntryInput,
    req?: Request,
  ): Promise<AuditLog> {
    let ipAddress = entry.ipAddress ?? undefined;
    let userAgent = entry.userAgent ?? undefined;
    if (req !== undefined) {
      if (ipAddress === undefined || ipAddress === null) {
        ipAddress = clientIpFromRequest(req);
      }
      if (userAgent === undefined || userAgent === null) {
        userAgent = userAgentFromRequest(req);
      }
    }

    return tx.auditLog.create({
      data: {
        actorId: entry.actorId ?? null,
        actorType: entry.actorType,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        metadata: entry.metadata,
        ipAddress: ipAddress ?? null,
        userAgent: userAgent ?? null,
      },
    });
  }

  /**
   * Paginacja kursorowa po `(createdAt desc, id desc)` — `cursor` to poprzedni `nextCursor`.
   */
  async listForAdmin(
    filters: AuditListFilters,
    limit: number,
    cursorEncoded: string | undefined,
  ): Promise<{ items: AuditLog[]; nextCursor: string | null }> {
    const take = Math.min(100, Math.max(1, limit));
    let cursor: { createdAt: string; id: string } | undefined;
    if (cursorEncoded !== undefined && cursorEncoded.trim().length > 0) {
      try {
        const raw = Buffer.from(cursorEncoded.trim(), "base64url").toString("utf8");
        const parsed = JSON.parse(raw) as { createdAt?: unknown; id?: unknown };
        if (
          typeof parsed.createdAt === "string" &&
          typeof parsed.id === "string" &&
          parsed.id.length > 0
        ) {
          cursor = { createdAt: parsed.createdAt, id: parsed.id };
        }
      } catch {
        cursor = undefined;
      }
    }

    const where: Prisma.AuditLogWhereInput = {};

    if (filters.actorId !== undefined && filters.actorId.length > 0) {
      where.actorId = filters.actorId;
    }
    if (filters.entityType !== undefined && filters.entityType.length > 0) {
      where.entityType = filters.entityType;
    }
    if (filters.entityId !== undefined && filters.entityId.length > 0) {
      where.entityId = filters.entityId;
    }
    if (filters.action !== undefined) {
      where.action = filters.action;
    }
    if (filters.from !== undefined || filters.to !== undefined) {
      where.createdAt = {};
      if (filters.from !== undefined) {
        where.createdAt.gte = filters.from;
      }
      if (filters.to !== undefined) {
        where.createdAt.lte = filters.to;
      }
    }

    if (cursor !== undefined) {
      const d = new Date(cursor.createdAt);
      if (!Number.isNaN(d.getTime())) {
        where.OR = [
          { createdAt: { lt: d } },
          { AND: [{ createdAt: d }, { id: { lt: cursor.id } }] },
        ];
      }
    }

    const rows = await this.prisma.auditLog.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: take + 1,
    });

    const hasMore = rows.length > take;
    const slice = hasMore ? rows.slice(0, take) : rows;
    let nextCursor: string | null = null;
    if (hasMore && slice.length > 0) {
      const last = slice[slice.length - 1]!;
      nextCursor = Buffer.from(
        JSON.stringify({
          createdAt: last.createdAt.toISOString(),
          id: last.id,
        }),
        "utf8",
      ).toString("base64url");
    }

    return { items: slice, nextCursor };
  }
}
