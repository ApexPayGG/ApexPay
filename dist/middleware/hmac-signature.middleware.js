import { createHmac, timingSafeEqual } from "node:crypto";
function hexDigest(secret, raw) {
    return createHmac("sha256", secret).update(raw).digest("hex");
}
/**
 * Odczyt `API_SECRET_KEYS` (comma-separated) lub pojedynczego `API_SECRET_KEY` (kompatybilność wsteczna).
 */
export function parseApiSecretKeysFromEnv() {
    const multi = process.env.API_SECRET_KEYS?.trim();
    if (multi !== undefined && multi.length > 0) {
        return multi
            .split(",")
            .map((s) => s.trim())
            .filter((s) => s.length > 0);
    }
    const single = process.env.API_SECRET_KEY?.trim();
    if (single !== undefined && single.length > 0) {
        return [single];
    }
    return [];
}
function signatureMatchesAnyKey(signature, buf, keys) {
    const a = Buffer.from(signature, "utf8");
    for (const secret of keys) {
        const expected = hexDigest(secret, buf);
        const b = Buffer.from(expected, "utf8");
        if (a.length === b.length && timingSafeEqual(a, b)) {
            return true;
        }
    }
    return false;
}
/**
 * Weryfikacja HMAC-SHA256(surowe body) w nagłówku (domyślnie x-signature).
 * Rotacja: dowolny z `secretKeys` może zweryfikować podpis.
 * Wymaga `req.rawBody` ustawionego w verify() globalnego express.json().
 */
export function createHmacSignatureMiddleware(options) {
    const headerName = (options.headerName ?? "x-signature").toLowerCase();
    const keys = options.secretKeys ?? [];
    return (req, res, next) => {
        if (keys.length === 0) {
            next();
            return;
        }
        const raw = req.rawBody;
        const buf = raw ?? Buffer.alloc(0);
        const provided = req.headers[headerName];
        const signature = typeof provided === "string"
            ? provided.trim()
            : Array.isArray(provided) && typeof provided[0] === "string"
                ? provided[0].trim()
                : "";
        if (signature.length === 0) {
            res.status(401).json({ error: "Unauthorized", message: "Brak nagłówka podpisu." });
            return;
        }
        if (!signatureMatchesAnyKey(signature, buf, keys)) {
            res.status(401).json({ error: "Unauthorized", message: "Nieprawidłowy podpis HMAC." });
            return;
        }
        next();
    };
}
//# sourceMappingURL=hmac-signature.middleware.js.map