import { Prisma, PaymentMethodProvider, } from "@prisma/client";
import { z } from "zod";
export const createPaymentMethodBodySchema = z
    .object({
    provider: z.nativeEnum(PaymentMethodProvider),
    token: z.string().trim().min(1).max(512),
    type: z.string().trim().min(1).max(64),
    last4: z.string().trim().length(4).optional(),
    expMonth: z.number().int().min(1).max(12).optional(),
    expYear: z.number().int().min(2000).max(2100).optional(),
    isDefault: z.boolean().optional(),
})
    .strict();
export class PaymentMethodDuplicateError extends Error {
    constructor() {
        super("Metoda płatności z tym tokenem u danego dostawcy już istnieje.");
        this.name = "PaymentMethodDuplicateError";
    }
}
function isUniqueProviderTokenViolation(err) {
    if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== "P2002") {
        return false;
    }
    const target = err.meta?.target;
    if (Array.isArray(target)) {
        return target.includes("provider") && target.includes("token");
    }
    const c = err.meta?.constraint;
    return typeof c === "string" && c.includes("provider") && c.includes("token");
}
/** Odpowiedź API — bez pełnego tokenu PSP (PCI / least privilege). */
export function toPublicPaymentMethod(pm) {
    return {
        ...pm,
        token: "[redacted]",
    };
}
export class PaymentMethodService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    parseCreateBody(body) {
        return createPaymentMethodBodySchema.parse(body);
    }
    async createForUser(userId, input) {
        const isDefault = input.isDefault === true;
        const token = input.token.trim();
        try {
            return await this.prisma.$transaction(async (tx) => {
                if (isDefault) {
                    await tx.paymentMethod.updateMany({
                        where: { userId },
                        data: { isDefault: false },
                    });
                }
                return tx.paymentMethod.create({
                    data: {
                        userId,
                        provider: input.provider,
                        token,
                        type: input.type.trim(),
                        last4: input.last4 !== undefined ? input.last4.trim() : null,
                        expMonth: input.expMonth ?? null,
                        expYear: input.expYear ?? null,
                        isDefault,
                    },
                });
            }, {
                isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
                maxWait: 5000,
                timeout: 10000,
            });
        }
        catch (err) {
            if (isUniqueProviderTokenViolation(err)) {
                throw new PaymentMethodDuplicateError();
            }
            throw err;
        }
    }
    async listForUser(userId) {
        return this.prisma.paymentMethod.findMany({
            where: { userId },
            orderBy: { createdAt: "desc" },
        });
    }
}
//# sourceMappingURL=payment-method.service.js.map