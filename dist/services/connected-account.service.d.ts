import type { Request } from "express";
import { type PrismaClient, ConnectedAccountSubjectType, type ConnectedAccountStatus } from "@prisma/client";
import type { AuditLogService } from "./audit-log.service.js";
import { type PaginatedSlice } from "../lib/pagination.js";
export declare class ConnectedAccountDuplicateError extends Error {
    constructor();
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
export declare class ConnectedAccountService {
    private readonly prisma;
    private readonly auditLogService?;
    constructor(prisma: PrismaClient, auditLogService?: AuditLogService | undefined);
    /**
     * Subkonta integratora — widok listy (bez wrażliwych pól), malejąco po `createdAt`.
     */
    listForIntegration(integratorUserId: string, opts?: {
        limit?: unknown;
        cursor?: string;
    }): Promise<PaginatedSlice<IntegrationConnectedAccountRow>>;
    /**
     * Onboarding KYC z poziomu integratora (klucz API). Status PENDING.
     */
    createForIntegration(integratorUserId: string, input: CreateIntegrationAccountInput, req?: Request): Promise<{
        userId: string | null;
        id: string;
        createdAt: Date;
        integratorUserId: string;
        email: string;
        subjectType: import("@prisma/client").$Enums.ConnectedAccountSubjectType;
        country: string;
        status: import("@prisma/client").$Enums.ConnectedAccountStatus;
        kycReferenceId: string | null;
        updatedAt: Date;
    }>;
}
//# sourceMappingURL=connected-account.service.d.ts.map