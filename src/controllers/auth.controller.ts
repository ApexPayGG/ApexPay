import { UserRole } from "@prisma/client";
import type { Request, Response } from "express";
import type { AuthService } from "../services/auth.service.js";
import {
  AuthValidationError,
  EmailAlreadyRegisteredError,
  InvalidCredentialsError,
} from "../services/auth.service.js";

const REGISTER_SUCCESS_MESSAGE =
  "Użytkownik utworzony pomyślnie. Portfel zainicjalizowany.";

export class AuthController {
  constructor(private authService: AuthService) {}

  async register(req: Request, res: Response): Promise<void> {
    try {
      const { email, password, role } = req.body as {
        email?: unknown;
        password?: unknown;
        role?: unknown;
      };
      if (!email || !password) {
        res.status(400).json({ error: "Email i hasło są wymagane." });
        return;
      }

      if (role === UserRole.ADMIN || role === "ADMIN") {
        res.status(403).json({
          error:
            "Odmowa dostępu: Nie można zarejestrować konta administratora przez publiczne API.",
        });
        return;
      }

      const user = await this.authService.registerUser(
        String(email),
        String(password),
        role,
      );
      res.status(201).json({
        message: REGISTER_SUCCESS_MESSAGE,
        userId: user.id,
      });
    } catch (error) {
      if (error instanceof AuthValidationError) {
        res.status(400).json({ error: error.message });
        return;
      }
      if (error instanceof EmailAlreadyRegisteredError) {
        res.status(409).json({ error: "Conflict", message: "Email already registered" });
        return;
      }
      console.error(error);
      res.status(500).json({ error: "Internal server error" });
    }
  }

  async login(req: Request, res: Response): Promise<void> {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        res.status(400).json({ error: "Email and password are required" });
        return;
      }

      const { token, user } = await this.authService.loginUser(email, password);

      res.cookie("jwt", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        maxAge: 86400000,
      });

      res.status(200).json({
        token,
        id: user.id,
        email: user.email,
        role: user.role,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      });
    } catch (error) {
      if (error instanceof InvalidCredentialsError) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      console.error(error);
      res.status(500).json({ error: "Internal server error" });
    }
  }

  /** Wymaga wcześniejszego `authenticateToken` (Bearer JWT). */
  async me(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      if (userId === undefined || userId.length === 0) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      const profile = await this.authService.getUserProfile(userId);
      if (profile === null) {
        res.status(404).json({ error: "User not found" });
        return;
      }

      res.status(200).json({
        id: profile.id,
        email: profile.email,
        role: profile.role,
        createdAt: profile.createdAt,
        updatedAt: profile.updatedAt,
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
}