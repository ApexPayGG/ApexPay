/** Domyślny limit strony dla list kursorowych (panel integratora). */
export const DEFAULT_PAGE_LIMIT = 20;
/** Maksymalny dozwolony limit (query `limit`). */
export const MAX_PAGE_LIMIT = 50;
/**
 * Parsuje `limit` z query (np. `req.query.limit`). Nieprawidłowe wartości → domyślny limit.
 */
export function parsePaginationLimit(raw) {
    if (raw === undefined || raw === null || raw === "") {
        return DEFAULT_PAGE_LIMIT;
    }
    const n = Number.parseInt(String(raw), 10);
    if (!Number.isFinite(n) || n < 1) {
        return DEFAULT_PAGE_LIMIT;
    }
    return Math.min(MAX_PAGE_LIMIT, n);
}
/** ISO-8601 w UTF-8 → base64url (bez paddingu). */
export function encodeCursor(date) {
    return Buffer.from(date.toISOString(), "utf8")
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
}
/** base64url → `Date`; nieprawidłowy lub pusty → `undefined`. */
export function decodeCursor(cursor) {
    if (cursor === undefined || cursor === null) {
        return undefined;
    }
    const s = String(cursor).trim();
    if (s.length === 0) {
        return undefined;
    }
    let b64 = s.replace(/-/g, "+").replace(/_/g, "/");
    const pad = b64.length % 4;
    if (pad !== 0) {
        b64 += "=".repeat(4 - pad);
    }
    try {
        const iso = Buffer.from(b64, "base64").toString("utf8");
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) {
            return undefined;
        }
        return d;
    }
    catch {
        return undefined;
    }
}
/**
 * Obcina do `limit` elementów; jeśli wejście ma więcej niż `limit`, zwraca `nextCursor`
 * z daty ostatniego elementu na stronie.
 */
export function paginatedResponse(items, limit, getDate) {
    if (items.length <= limit) {
        return { items, nextCursor: null };
    }
    const page = items.slice(0, limit);
    const last = page[page.length - 1];
    return {
        items: page,
        nextCursor: encodeCursor(getDate(last)),
    };
}
//# sourceMappingURL=pagination.js.map