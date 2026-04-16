import type { NextFunction, Request, RequestHandler, Response } from "express";
import { attachUserToRequestContext } from "../lib/request-context.js";
import type { ApiKeyService } from "../services/api-key.service.js";
import { API_KEY_PUBLIC_PREFIX } from "../services/api-key.service.js";

const HDR_API_KEY = "x-api-key";
const AUTH = "authorization";

function extractRawApiKey(req: Request): string | undefined {
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

const MSG_UNAUTHORIZED = "Nieprawidłowy lub nieaktywny klucz API.";

/**
 * Autoryzacja integratora kluczem API (`x-api-key` lub `Authorization: Bearer apx_live_…`).
 * Nie zastępuje JWT — stosuj tylko na trasach B2B. Nie wywołuj razem z `authMiddleware` na tej samej trasie bez wyboru jednej metody.
 */
export function createApiKeyAuthMiddleware(apiKeyService: ApiKeyService): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const raw = extractRawApiKey(req);
      if (raw === undefined) {
        res.status(401).json({ error: MSG_UNAUTHORIZED, code: "UNAUTHORIZED" });
        return;
      }

      const validated = await apiKeyService.validateKey(raw);
      if (validated === null) {
        res.status(401).json({ error: MSG_UNAUTHORIZED, code: "UNAUTHORIZED" });
        return;
      }

      req.user = {
        id: validated.userId,
        role: validated.role,
      };
      attachUserToRequestContext(req);
      next();
    } catch (err) {
      console.error("[api-key-auth]", err);
      res.status(500).json({ error: "Internal Server Error", code: "INTERNAL" });
    }
  };
}
