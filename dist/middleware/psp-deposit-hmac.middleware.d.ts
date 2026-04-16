import type { RequestHandler } from "express";
export declare const PSP_DEPOSIT_SIGNATURE_HEADER = "x-apexpay-signature";
export type GetPspDepositWebhookSecret = () => string | undefined;
/**
 * Weryfikacja HMAC surowego body (PSP_DEPOSIT_WEBHOOK_SECRET).
 * Musi być zarejestrowana **po** `express.json({ verify: rawBody })`.
 */
export declare function createPspDepositWebhookHmacMiddleware(getSecret: GetPspDepositWebhookSecret): RequestHandler;
//# sourceMappingURL=psp-deposit-hmac.middleware.d.ts.map