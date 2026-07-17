import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
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

export function raceWithAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(signal.reason);
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    operation.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", onAbort);
    });
  });
}

/** Test adapter; production uses `postPinnedWebhook`. */
export function createFetchWebhookPost(fetchImpl: typeof fetch): WebhookPost {
  return async ({ url, body, headers, signal }) => {
    const response = await fetchImpl(url.toString(), {
      method: "POST",
      redirect: "error",
      headers,
      body,
      signal,
    });
    return { ok: response.ok, status: response.status };
  };
}

/**
 * Connects to the already-validated address while retaining the URL hostname for
 * TLS SNI and certificate verification. The built-in client never follows redirects.
 */
export const postPinnedWebhook: WebhookPost = async ({
  url,
  address,
  body,
  headers,
  signal,
}) =>
  new Promise<WebhookPostResult>((resolve, reject) => {
    const hostname = url.hostname.replace(/^\[|\]$/g, "");
    const req = httpsRequest(
      url,
      {
        method: "POST",
        headers: {
          ...headers,
          "Content-Length": Buffer.byteLength(body).toString(),
        },
        signal,
        family: address.family,
        servername: isIP(hostname) === 0 ? hostname : undefined,
        lookup: (_hostname, _options, callback) => {
          callback(null, address.address, address.family);
        },
      },
      (res) => {
        res.resume();
        const status = res.statusCode ?? 0;
        resolve({ ok: status >= 200 && status < 300, status });
      },
    );
    req.once("error", reject);
    req.end(body);
  });
