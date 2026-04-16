import { Prisma, AuditAction, AuditActorType, ConnectedAccountSubjectType, } from "@prisma/client";
import { decodeCursor, paginatedResponse, parsePaginationLimit, } from "../lib/pagination.js";
export class ConnectedAccountDuplicateError extends Error {
    constructor() {
        super("Subkonto dla tego integratora i adresu e-mail już istnieje.");
        this.name = "ConnectedAccountDuplicateError";
    }
}
export class ConnectedAccountService {
    prisma;
    auditLogService;
    constructor(prisma, auditLogService) {
        this.prisma = prisma;
        this.auditLogService = auditLogService;
    }
    /**
     * Subkonta integratora — widok listy (bez wrażliwych pól), malejąco po `createdAt`.
     */
    async listForIntegration(integratorUserId, opts) {
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
    async createForIntegration(integratorUserId, input, req) {
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
                    await this.auditLogService.log(tx, {
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
                    }, req);
                }
                return row;
            });
        }
        catch (err) {
            if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
                throw new ConnectedAccountDuplicateError();
            }
            throw err;
        }
    }
}
//# sourceMappingURL=connected-account.service.js.map