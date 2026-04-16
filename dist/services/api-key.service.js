import { randomBytes } from "node:crypto";
import bcrypt from "bcrypt";
import { AuditAction, AuditActorType, } from "@prisma/client";
import { decodeCursor, paginatedResponse, parsePaginationLimit, } from "../lib/pagination.js";
const BCRYPT_ROUNDS = 12;
/** Prefiks klucza wyświetlany w UI i używany do parsowania z nagłówka. */
export const API_KEY_PUBLIC_PREFIX = "apx_live_";
/** Długość unikalnego prefiksu indeksowanego w DB (= pierwsze N znaków pełnego klucza). */
export const API_KEY_LOOKUP_PREFIX_LENGTH = 24;
function buildSecretSuffix() {
    return randomBytes(32).toString("base64url");
}
export class ApiKeyNotFoundError extends Error {
    constructor() {
        super("Nie znaleziono klucza API.");
        this.name = "ApiKeyNotFoundError";
    }
}
export class ApiKeyService {
    prisma;
    auditLogService;
    constructor(prisma, auditLogService) {
        this.prisma = prisma;
        this.auditLogService = auditLogService;
    }
    /**
     * Generuje klucz `apx_live_<losowe>`, zapisuje bcrypt w `keyHash`, unikalny `prefix` (pierwsze 24 znaki).
     */
    async createKey(userId, name, options) {
        const trimmedName = name.trim();
        if (trimmedName.length === 0) {
            throw new RangeError("name is required");
        }
        const expiresAt = options?.expiresAt ?? null;
        for (let attempt = 0; attempt < 5; attempt++) {
            const fullKeyPlaintext = `${API_KEY_PUBLIC_PREFIX}${buildSecretSuffix()}`;
            if (fullKeyPlaintext.length < API_KEY_LOOKUP_PREFIX_LENGTH) {
                continue;
            }
            const prefix = fullKeyPlaintext.slice(0, API_KEY_LOOKUP_PREFIX_LENGTH);
            const keyHash = await bcrypt.hash(fullKeyPlaintext, BCRYPT_ROUNDS);
            try {
                const req = options?.request;
                const row = await this.prisma.$transaction(async (tx) => {
                    const created = await tx.apiKey.create({
                        data: {
                            userId,
                            keyHash,
                            prefix,
                            name: trimmedName,
                            expiresAt,
                        },
                    });
                    if (this.auditLogService !== undefined) {
                        await this.auditLogService.log(tx, {
                            actorId: userId,
                            actorType: AuditActorType.USER,
                            action: AuditAction.API_KEY_CREATED,
                            entityType: "ApiKey",
                            entityId: created.id,
                            metadata: { name: trimmedName, prefix: created.prefix },
                        }, req);
                    }
                    return created;
                });
                const record = {
                    id: row.id,
                    userId: row.userId,
                    prefix: row.prefix,
                    name: row.name,
                    lastUsedAt: row.lastUsedAt,
                    expiresAt: row.expiresAt,
                    isActive: row.isActive,
                    createdAt: row.createdAt,
                    updatedAt: row.updatedAt,
                };
                return {
                    fullKeyPlaintext,
                    record,
                };
            }
            catch (err) {
                const code = err.code;
                if (code === "P2002") {
                    continue;
                }
                throw err;
            }
        }
        throw new Error("Nie udało się wygenerować unikalnego klucza API.");
    }
    /**
     * Usuwa klucz należący do użytkownika (twardy delete — audyt API_KEY_DELETED).
     */
    async deleteKey(userId, apiKeyId, req) {
        const id = apiKeyId.trim();
        if (id.length === 0) {
            throw new RangeError("apiKeyId is required");
        }
        await this.prisma.$transaction(async (tx) => {
            const existing = await tx.apiKey.findFirst({
                where: { id, userId },
                select: { id: true, prefix: true, name: true },
            });
            if (existing === null) {
                throw new ApiKeyNotFoundError();
            }
            await tx.apiKey.delete({ where: { id: existing.id } });
            if (this.auditLogService !== undefined) {
                await this.auditLogService.log(tx, {
                    actorId: userId,
                    actorType: AuditActorType.USER,
                    action: AuditAction.API_KEY_DELETED,
                    entityType: "ApiKey",
                    entityId: existing.id,
                    metadata: { prefix: existing.prefix, name: existing.name },
                }, req);
            }
        });
    }
    /** Lista kluczy użytkownika (bez `keyHash`) — do panelu integratora. */
    async listForUser(userId, opts) {
        const limit = parsePaginationLimit(opts?.limit);
        const cursorDate = decodeCursor(opts?.cursor);
        const rows = await this.prisma.apiKey.findMany({
            where: {
                userId,
                ...(cursorDate !== undefined ? { createdAt: { lt: cursorDate } } : {}),
            },
            orderBy: { createdAt: "desc" },
            take: limit + 1,
            select: {
                id: true,
                userId: true,
                prefix: true,
                name: true,
                lastUsedAt: true,
                expiresAt: true,
                isActive: true,
                createdAt: true,
                updatedAt: true,
            },
        });
        return paginatedResponse(rows, limit, (r) => r.createdAt);
    }
    /**
     * Waliduje surowy klucz: wyszukanie po `prefix`, bcrypt, aktywność, ważność.
     * Opcjonalnie aktualizuje `lastUsedAt`.
     */
    async validateKey(rawKey, options) {
        const trimmed = rawKey.trim();
        if (!trimmed.startsWith(API_KEY_PUBLIC_PREFIX)) {
            return null;
        }
        if (trimmed.length < API_KEY_LOOKUP_PREFIX_LENGTH) {
            return null;
        }
        const prefix = trimmed.slice(0, API_KEY_LOOKUP_PREFIX_LENGTH);
        const row = await this.prisma.apiKey.findUnique({
            where: { prefix },
            include: {
                user: { select: { id: true, role: true } },
            },
        });
        if (row === null || !row.isActive) {
            return null;
        }
        if (row.expiresAt !== null && row.expiresAt <= new Date()) {
            return null;
        }
        const ok = await bcrypt.compare(trimmed, row.keyHash);
        if (!ok) {
            return null;
        }
        const touch = options?.touchLastUsed !== false;
        if (touch) {
            void this.prisma.apiKey
                .update({
                where: { id: row.id },
                data: { lastUsedAt: new Date() },
            })
                .catch(() => {
                /* ignore */
            });
        }
        return {
            userId: row.user.id,
            role: row.user.role,
            apiKeyId: row.id,
        };
    }
}
//# sourceMappingURL=api-key.service.js.map