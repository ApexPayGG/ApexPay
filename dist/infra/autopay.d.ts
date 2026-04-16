export type AutopayConfig = {
    serviceId: string;
    sharedKey: string;
    gatewayUrl: string;
    returnUrl: string;
    itnUrl: string;
};
export declare function getAutopayConfig(): AutopayConfig;
/**
 * Autopay BM: hash SHA-256 z `field1|field2|...|SHARED_KEY` (hex lowercase).
 */
export declare function generateHash(fields: string[]): string;
export declare function verifyHash(fields: string[], receivedHash: string): boolean;
//# sourceMappingURL=autopay.d.ts.map