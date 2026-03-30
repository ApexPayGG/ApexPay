/**
 * Weryfikuje HMAC-SHA256(payload) z nagłówka (64 znaki hex), porównanie stałoczasowe.
 */
export declare function verifyPspWebhookHmacSha256Hex(rawBody: Buffer, signatureHeader: string | undefined, secret: string): boolean;
//# sourceMappingURL=psp-webhook-hmac.d.ts.map