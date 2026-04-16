import type { RequestHandler } from "express";
import type { ApiKeyService } from "../services/api-key.service.js";
/**
 * Panel integratora (JWT z cookie lub Bearer) **lub** integracja B2B (klucz API).
 * Używaj na endpointach `/api/v1/integrations/…` współdzielonych między UI a API key.
 * Kolejność: najpierw klucz API, potem JWT.
 */
export declare function createIntegratorHybridAuthMiddleware(apiKeyService: ApiKeyService): RequestHandler;
//# sourceMappingURL=integrator-hybrid-auth.middleware.d.ts.map