import { Router, type RequestHandler } from "express";
import type { AuthController } from "../controllers/auth.controller.js";
import { authenticateToken } from "../middlewares/auth.middleware.js";

export type CreateAuthRouterOptions = {
  /** Limit IP na POST register/login (np. Redis sliding window). */
  postRateLimit?: RequestHandler;
};

/**
 * Trasy auth: POST /register, /login; GET /me (Bearer JWT).
 * Montuj pod `/api/v1/auth` lub `/api/auth`.
 */
export function createAuthRouter(
  authController: AuthController,
  options?: CreateAuthRouterOptions,
): Router {
  const router = Router();
  const rl = options?.postRateLimit;

  const registerHandlers: RequestHandler[] = [];
  if (rl !== undefined) {
    registerHandlers.push(rl);
  }
  registerHandlers.push((req, res) => {
    void authController.register(req, res);
  });
  router.post("/register", ...registerHandlers);

  const loginHandlers: RequestHandler[] = [];
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
