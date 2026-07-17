import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
export async function postWebhookToResolvedAddresses(postWebhook, request) {
    const { addresses, ...baseRequest } = request;
    let lastError = new Error("Webhook hostname resolved without addresses");
    for (const address of addresses) {
        try {
            return await postWebhook({ ...baseRequest, address });
        }
        catch (error) {
            if (request.signal.aborted) {
                throw error;
            }
            lastError = error;
        }
    }
    throw lastError;
}
export function raceWithAbort(operation, signal) {
    if (signal.aborted) {
        return Promise.reject(signal.reason);
    }
    return new Promise((resolve, reject) => {
        const onAbort = () => reject(signal.reason);
        signal.addEventListener("abort", onAbort, { once: true });
        operation.then(resolve, reject).finally(() => {
            signal.removeEventListener("abort", onAbort);
        });
    });
}
/** Test adapter; production uses `postPinnedWebhook`. */
export function createFetchWebhookPost(fetchImpl) {
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
export const postPinnedWebhook = async ({ url, address, body, headers, signal, }) => new Promise((resolve, reject) => {
    const hostname = url.hostname.replace(/^\[|\]$/g, "");
    const req = httpsRequest(url, {
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
    }, (res) => {
        res.resume();
        const status = res.statusCode ?? 0;
        resolve({ ok: status >= 200 && status < 300, status });
    });
    req.once("error", reject);
    req.end(body);
});
//# sourceMappingURL=pinned-webhook-request.js.map