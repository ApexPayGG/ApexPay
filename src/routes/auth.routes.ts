import { Router } from "express";
import type { AuthController } from "../controllers/auth.controller.js";

/**
 * Trasy rejestracji i logowania (POST /register, POST /login).
 * Montuj pod `/api/v1/auth` lub `/api/auth` — pełne ścieżki: `/api/v1/auth/register`, itd.
 */
export function createAuthRouter(authController: AuthController): Router {
  const router = Router();

  router.post("/register", (req, res) => {
    void authController.register(req, res);
  });

  router.post("/login", (req, res) => {
    void authController.login(req, res);
  });

  return router;
}
