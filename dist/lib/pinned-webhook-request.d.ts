import type { ResolvedWebhookAddress } from "./webhook-url-policy.js";
export type WebhookPostRequest = {
    url: URL;
    address: ResolvedWebhookAddress;
    body: string;
    headers: Record<string, string>;
    signal: AbortSignal;
};
export type WebhookPostResult = {
    ok: boolean;
    status: number;
};
export type WebhookPost = (request: WebhookPostRequest) => Promise<WebhookPostResult>;
export declare function postWebhookToResolvedAddresses(postWebhook: WebhookPost, request: Omit<WebhookPostRequest, "address"> & {
    addresses: readonly ResolvedWebhookAddress[];
}): Promise<WebhookPostResult>;
export declare function raceWithAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T>;
/** Test adapter; production uses `postPinnedWebhook`. */
export declare function createFetchWebhookPost(fetchImpl: typeof fetch): WebhookPost;
/**
 * Connects to the already-validated address while retaining the URL hostname for
 * TLS SNI and certificate verification. The built-in client never follows redirects.
 */
export declare const postPinnedWebhook: WebhookPost;
//# sourceMappingURL=pinned-webhook-request.d.ts.map