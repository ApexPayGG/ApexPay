import jwt from "jsonwebtoken";
import { attachUserToRequestContext } from "../lib/request-context.js";
import { API_KEY_PUBLIC_PREFIX } from "../services/api-key.service.js";
const HDR_API_KEY = "x-api-key";
const AUTH = "authorization";
function extractRawApiKey(req) {
    const direct = req.get(HDR_API_KEY);
    if (typeof direct === "string" && direct.trim().length > 0) {
        return direct.trim();
    }
    const auth = req.get(AUTH);
    if (typeof auth !== "string" || auth.length === 0) {
        return undefined;
    }
    const bearer = "Bearer ";
    if (!auth.startsWith(bearer)) {
        return undefined;
    }
    const token = auth.slice(bearer.length).trim();
    if (token.startsWith(API_KEY_PUBLIC_PREFIX)) {
        return token;
    }
    return undefined;
}
function getJwtSecret() {
    return process.env.JWT_SECRET || "dev-secret";
}
/** Cookie `jwt` lub `Authorization: Bearer` (JWT — zwykle `eyJ…`). */
function tokenFromRequest(req) {
    const fromCookie = req.cookies?.jwt;
    if (typeof fromCookie === "string" && fromCookie.trim().length > 0) {
        return fromCookie.trim();
    }
    const authHeader = req.headers.authorization;
    const part = authHeader?.split(" ")[1];
    if (typeof part === "string" && part.trim().length > 0) {
        return part.trim();
    }
    return undefined;
}
function attachUserFromJwtPayload(req, payload) {
    if (typeof payload.userId !== "string" || payload.userId.trim().length === 0) {
        return false;
    }
    const id = payload.userId.trim();
    const role = typeof payload.role === "string" && payload.role.length > 0 ? payload.role : undefined;
    req.user = role !== undefined ? { id, role } : { id };
    return true;
}
const MSG_API_KEY = "Nieprawidłowy lub nieaktywny klucz API.";
const MSG_NEED_AUTH = "Wymagane uwierzytelnienie: nagłówek x-api-key / Bearer apx_live_… albo sesja JWT.";
/**
 * Panel integratora (JWT z cookie lub Bearer) **lub** integracja B2B (klucz API).
 * Używaj na endpointach `/api/v1/integrations/…` współdzielonych między UI a API key.
 * Kolejność: najpierw klucz API, potem JWT.
 */
export function createIntegratorHybridAuthMiddleware(apiKeyService) {
    return async (req, res, next) => {
        try {
            const rawKey = extractRawApiKey(req);
            if (rawKey !== undefined) {
                const validated = await apiKeyService.validateKey(rawKey);
                if (validated === null) {
                    res.status(401).json({ error: MSG_API_KEY, code: "UNAUTHORIZED" });
                    return;
                }
                req.user = { id: validated.userId, role: validated.role };
                attachUserToRequestContext(req);
                next();
                return;
            }
            const token = tokenFromRequest(req);
            if (token === undefined) {
                res.status(401).json({ error: MSG_NEED_AUTH, code: "UNAUTHORIZED" });
                return;
            }
            if (token.startsWith(API_KEY_PUBLIC_PREFIX)) {
                res.status(401).json({ error: MSG_API_KEY, code: "UNAUTHORIZED" });
                return;
            }
            try {
                const decoded = jwt.verify(token, getJwtSecret());
                if (typeof decoded !== "object" || decoded === null) {
                    res.status(403).json({ error: "Token wygasł lub jest nieprawidłowy." });
                    return;
                }
                const payload = decoded;
                if (!attachUserFromJwtPayload(req, payload)) {
                    res.status(403).json({ error: "Token wygasł lub jest nieprawidłowy." });
                    return;
                }
                attachUserToRequestContext(req);
                next();
            }
            catch {
                res.status(403).json({ error: "Token wygasł lub jest nieprawidłowy." });
            }
        }
        catch (err) {
            console.error("[integrator-hybrid-auth]", err);
            res.status(500).json({ error: "Internal Server Error", code: "INTERNAL" });
        }
    };
}
//# sourceMappingURL=integrator-hybrid-auth.middleware.js.map