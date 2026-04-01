import { Router, type RequestHandler } from "express";
import type { AuthController } from "../controllers/auth.controller.js";
export type CreateAuthRouterOptions = {
    /** Limit IP na POST register/login (np. Redis sliding window). */
    postRateLimit?: RequestHandler;
};
/**
 * Trasy auth: POST /register, /login; GET /me (Bearer JWT).
 * Montuj pod `/api/v1/auth` lub `/api/auth`.
 */
export declare function createAuthRouter(authController: AuthController, options?: CreateAuthRouterOptions): Router;
//# sourceMappingURL=auth.routes.d.ts.map