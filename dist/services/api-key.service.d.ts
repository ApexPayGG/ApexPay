import type { Request } from "express";
import { type PrismaClient, type UserRole } from "@prisma/client";
import type { AuditLogService } from "./audit-log.service.js";
import { type PaginatedSlice } from "../lib/pagination.js";
/** Prefiks klucza wyświetlany w UI i używany do parsowania z nagłówka. */
export declare const API_KEY_PUBLIC_PREFIX = "apx_live_";
/** Długość unikalnego prefiksu indeksowanego w DB (= pierwsze N znaków pełnego klucza). */
export declare const API_KEY_LOOKUP_PREFIX_LENGTH = 24;
export type ApiKeyPublic = {
    id: string;
    userId: string;
    prefix: string;
    name: string;
    lastUsedAt: Date | null;
    expiresAt: Date | null;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
};
export type ApiKeyCreateResult = {
    /** Surowy klucz — tylko przy tworzeniu; nie logować. */
    fullKeyPlaintext: string;
    record: ApiKeyPublic;
};
export declare class ApiKeyNotFoundError extends Error {
    constructor();
}
export declare class ApiKeyService {
    private readonly prisma;
    private readonly auditLogService?;
    constructor(prisma: PrismaClient, auditLogService?: AuditLogService | undefined);
    /**
     * Generuje klucz `apx_live_<losowe>`, zapisuje bcrypt w `keyHash`, unikalny `prefix` (pierwsze 24 znaki).
     */
    createKey(userId: string, name: string, options?: {
        expiresAt?: Date | null;
        request?: Request;
    }): Promise<ApiKeyCreateResult>;
    /**
     * Usuwa klucz należący do użytkownika (twardy delete — audyt API_KEY_DELETED).
     */
    deleteKey(userId: string, apiKeyId: string, req?: Request): Promise<void>;
    /** Lista kluczy użytkownika (bez `keyHash`) — do panelu integratora. */
    listForUser(userId: string, opts?: {
        limit?: unknown;
        cursor?: string;
    }): Promise<PaginatedSlice<ApiKeyPublic>>;
    /**
     * Waliduje surowy klucz: wyszukanie po `prefix`, bcrypt, aktywność, ważność.
     * Opcjonalnie aktualizuje `lastUsedAt`.
     */
    validateKey(rawKey: string, options?: {
        touchLastUsed?: boolean;
    }): Promise<{
        userId: string;
        role: UserRole;
        apiKeyId: string;
    } | null>;
}
//# sourceMappingURL=api-key.service.d.ts.map