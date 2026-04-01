import { Router } from "express";
import { authenticateToken } from "../middlewares/auth.middleware.js";
/**
 * Trasy auth: POST /register, /login; GET /me (Bearer JWT).
 * Montuj pod `/api/v1/auth` lub `/api/auth`.
 */
export function createAuthRouter(authController, options) {
    const router = Router();
    const rl = options?.postRateLimit;
    const registerHandlers = [];
    if (rl !== undefined) {
        registerHandlers.push(rl);
    }
    registerHandlers.push((req, res) => {
        void authController.register(req, res);
    });
    router.post("/register", ...registerHandlers);
    const loginHandlers = [];
    if (rl !== undefined) {
        loginHandlers.push(rl);
    }
    loginHandlers.push((req, res) => {
        void authController.login(req, res);
    });
    router.post("/login", ...loginHandlers);
    router.get("/me", authenticateToken, (req, res) => {
        void authController.me(req, res);
    });
    return router;
}
//# sourceMappingURL=auth.routes.js.map