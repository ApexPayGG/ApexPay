import { type PaymentMethod, type PrismaClient } from "@prisma/client";
import { z } from "zod";
export declare const createPaymentMethodBodySchema: z.ZodObject<{
    provider: z.ZodEnum<{
        STRIPE: "STRIPE";
        ADYEN: "ADYEN";
        MOCK_PSP: "MOCK_PSP";
        AUTOPAY: "AUTOPAY";
    }>;
    token: z.ZodString;
    type: z.ZodString;
    last4: z.ZodOptional<z.ZodString>;
    expMonth: z.ZodOptional<z.ZodNumber>;
    expYear: z.ZodOptional<z.ZodNumber>;
    isDefault: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strict>;
export type CreatePaymentMethodBody = z.infer<typeof createPaymentMethodBodySchema>;
export declare class PaymentMethodDuplicateError extends Error {
    constructor();
}
/** Odpowiedź API — bez pełnego tokenu PSP (PCI / least privilege). */
export declare function toPublicPaymentMethod(pm: PaymentMethod): Omit<PaymentMethod, "token"> & {
    token: "[redacted]";
};
export declare class PaymentMethodService {
    private readonly prisma;
    constructor(prisma: PrismaClient);
    parseCreateBody(body: unknown): CreatePaymentMethodBody;
    createForUser(userId: string, input: CreatePaymentMethodBody): Promise<PaymentMethod>;
    listForUser(userId: string): Promise<PaymentMethod[]>;
}
//# sourceMappingURL=payment-method.service.d.ts.map