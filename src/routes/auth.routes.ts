import { Router } from "express";
import type { AuthController } from "../controllers/auth.controller.js";
import { authenticateToken } from "../middlewares/auth.middleware.js";

/**
 * Trasy auth: POST /register, /login; GET /me (Bearer JWT).
 * Montuj pod `/api/v1/auth` lub `/api/auth`.
 */
export function createAuthRouter(authController: AuthController): Router {
  const router = Router();

  router.post("/register", (req, res) => {
    void authController.register(req, res);
  });

  router.post("/login", (req, res) => {
    void authController.login(req, res);
  });

  router.get("/me", authenticateToken, (req, res) => {
    void authController.me(req, res);
  });

  return router;
}
