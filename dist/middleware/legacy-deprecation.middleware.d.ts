import type { NextFunction, Request, Response } from "express";
/**
 * Oznacza odpowiedzi z legacy `/api/...` (bez `/api/v1`) nagłówkami Deprecation / Sunset.
 * Preferuj klienty pod `/api/v1/...`.
 */
export declare function legacyApiDeprecationMiddleware(req: Request, res: Response, next: NextFunction): void;
//# sourceMappingURL=legacy-deprecation.middleware.d.ts.map