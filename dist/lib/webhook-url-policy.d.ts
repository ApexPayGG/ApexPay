export type ResolvedWebhookAddress = {
    address: string;
    family: 4 | 6;
};
export type WebhookHostnameResolver = (hostname: string) => Promise<readonly ResolvedWebhookAddress[]>;
export declare class UnsafeWebhookUrlError extends Error {
    constructor(message?: string);
}
export declare function parseSafeWebhookUrl(rawUrl: string): URL;
export declare function isSafeWebhookUrlForStorage(rawUrl: string): boolean;
export declare const resolveWebhookHostname: WebhookHostnameResolver;
export declare function assertWebhookUrlResolvesPublic(rawUrl: string, resolveHostname?: WebhookHostnameResolver): Promise<{
    url: URL;
    addresses: readonly ResolvedWebhookAddress[];
}>;
//# sourceMappingURL=webhook-url-policy.d.ts.map