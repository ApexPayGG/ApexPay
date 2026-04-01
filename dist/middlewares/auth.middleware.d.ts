import type { NextFunction, Request, Response } from "express";
/** Rozszerzenie typu Request o obiekt użytkownika zdekodowany z tokena */
export interface AuthRequest extends Request {
    user?: {
        id: string;
        role?: string;
    };
}
declare global {
    namespace Express {
        interface Request {
            user?: {
                id: string;
                role?: string;
            };
        }
    }
}
export declare const authenticateToken: (req: AuthRequest, res: Response, next: NextFunction) => void;
export declare function authMiddleware(req: Request, res: Response, next: NextFunction): void;
/** Funkcja wyższego rzędu (HOF) do weryfikacji ról (RBAC) */
export declare const requireRole: (allowedRoles: string[]) => (req: AuthRequest, res: Response, next: NextFunction) => void;
//# sourceMappingURL=auth.middleware.d.ts.map