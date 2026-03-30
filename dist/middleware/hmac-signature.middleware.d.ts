import type { NextFunction, Request, Response } from "express";
export type HmacSignatureOptions = {
    /**
     * Lista sekretów (rotacja). Pusta — middleware no-op (dev).
     * Ustawiane z env przez `parseApiSecretKeysFromEnv()`.
     */
    secretKeys?: string[];
    headerName?: string;
};
/**
 * Odczyt `API_SECRET_KEYS` (comma-separated) lub pojedynczego `API_SECRET_KEY` (kompatybilność wsteczna).
 */
export declare function parseApiSecretKeysFromEnv(): string[];
/**
 * Weryfikacja HMAC-SHA256(surowe body) w nagłówku (domyślnie x-signature).
 * Rotacja: dowolny z `secretKeys` może zweryfikować podpis.
 * Wymaga `req.rawBody` ustawionego w verify() globalnego express.json().
 */
export declare function createHmacSignatureMiddleware(options: HmacSignatureOptions): (req: Request, res: Response, next: NextFunction) => void;
//# sourceMappingURL=hmac-signature.middleware.d.ts.map