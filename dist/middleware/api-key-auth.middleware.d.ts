import type { RequestHandler } from "express";
import type { ApiKeyService } from "../services/api-key.service.js";
/**
 * Autoryzacja integratora kluczem API (`x-api-key` lub `Authorization: Bearer apx_live_…`).
 * Nie zastępuje JWT — stosuj tylko na trasach B2B. Nie wywołuj razem z `authMiddleware` na tej samej trasie bez wyboru jednej metody.
 */
export declare function createApiKeyAuthMiddleware(apiKeyService: ApiKeyService): RequestHandler;
//# sourceMappingURL=api-key-auth.middleware.d.ts.map