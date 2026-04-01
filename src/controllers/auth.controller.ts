import type { Request, Response } from "express";
import type { AuthService } from "../services/auth.service.js";
import {
  AuthValidationError,
  EmailAlreadyRegisteredError,
  InvalidCredentialsError,
} from "../services/auth.service.js";

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
        res.status(400).json({ error: "Email and password are required" });
        return;
      }

      const user = await this.authService.registerUser(
        String(email),
        String(password),
        role,
      );
      res.status(201).json({
        id: user.id,
        email: user.email,
        role: user.role,
        walletBalance: "0", // Obejście błędu typu - nowy portfel ma zawsze 0
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
}