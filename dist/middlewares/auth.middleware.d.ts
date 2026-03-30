import type { NextFunction, Request, Response } from "express";
declare global {
    namespace Express {
        interface Request {
            user?: {
                id: string;
            };
        }
    }
}
/**
 * Zero Trust: JWT z ciasteczka `jwt` lub z nagłówka `Authorization` (drugi segment po spacji).
 * Nie loguj tokenów ani sekretów.
 */
export declare function authMiddleware(req: Request, res: Response, next: NextFunction): void;
//# sourceMappingURL=auth.middleware.d.ts.map