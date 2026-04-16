import type { Request } from "express";
import {
  Prisma,
  AuditAction,
  AuditActorType,
  type PrismaClient,
  ConnectedAccountSubjectType,
  type ConnectedAccountStatus,
} from "@prisma/client";
import type { AuditLogService } from "./audit-log.service.js";
import {
  decodeCursor,
  paginatedResponse,
  parsePaginationLimit,
  type PaginatedSlice,
} from "../lib/pagination.js";

export class ConnectedAccountDuplicateError extends Error {
  constructor() {
    super("Subkonto dla tego integratora i adresu e-mail już istnieje.");
    this.name = "ConnectedAccountDuplicateError";
  }
}

export type CreateIntegrationAccountInput = {
  email: string;
  subjectType: ConnectedAccountSubjectType;
  country: string;
};

export type IntegrationConnectedAccountRow = {
  id: string;
  email: string;
  subjectType: ConnectedAccountSubjectType;
  country: string;
  status: ConnectedAccountStatus;
  createdAt: Date;
};

export class ConnectedAccountService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly auditLogService?: AuditLogService,
  ) {}

  /**
   * Subkonta integratora — widok listy (bez wrażliwych pól), malejąco po `createdAt`.
   */
  async listForIntegration(
    integratorUserId: string,
    opts?: { limit?: unknown; cursor?: string },
  ): Promise<PaginatedSlice<IntegrationConnectedAccountRow>> {
    const limit = parsePaginationLimit(opts?.limit);
    const cursorDate = decodeCursor(opts?.cursor);
    const rows = await this.prisma.connectedAccount.findMany({
      where: {
        integratorUserId,
        ...(cursorDate !== undefined ? { createdAt: { lt: cursorDate } } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: limit + 1,
      select: {
        id: true,
        email: true,
        subjectType: true,
        country: true,
        status: true,
        createdAt: true,
      },
    });
    return paginatedResponse(rows, limit, (r) => r.createdAt);
  }

  /**
   * Onboarding KYC z poziomu integratora (klucz API). Status PENDING.
   */
  async createForIntegration(
    integratorUserId: string,
    input: CreateIntegrationAccountInput,
    req?: Request,
  ) {
    const email = input.email.trim().toLowerCase();
    const country = input.country.trim().toUpperCase();
    if (country.length !== 2) {
      throw new RangeError("country musi mieć dokładnie 2 znaki (ISO 3166-1 alpha-2).");
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const row = await tx.connectedAccount.create({
          data: {
            integratorUserId,
            email,
            subjectType: input.subjectType,
            country,
          },
        });
        if (this.auditLogService !== undefined) {
          await this.auditLogService.log(
            tx,
            {
              actorId: integratorUserId,
              actorType: AuditActorType.USER,
              action: AuditAction.CONNECTED_ACCOUNT_CREATED,
              entityType: "ConnectedAccount",
              entityId: row.id,
              metadata: {
                email: row.email,
                country: row.country,
                subjectType: input.subjectType,
              },
            },
            req,
          );
        }
        return row;
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new ConnectedAccountDuplicateError();
      }
      throw err;
    }
  }
}
