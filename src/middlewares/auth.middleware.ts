import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";

declare global {
  namespace Express {
    interface Request {
      user?: { id: string };
    }
  }
}

function getJwtSecret(): string {
  return process.env.JWT_SECRET || "dev-secret";
}

/**
 * Zero Trust: JWT z ciasteczka `jwt` lub z nagłówka `Authorization` (drugi segment po spacji).
 * Nie loguj tokenów ani sekretów.
 */
export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const token = req.cookies?.jwt || req.headers.authorization?.split(" ")[1];

  if (token === undefined || typeof token !== "string" || token.trim().length === 0) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const trimmed = token.trim();

  try {
    const decoded = jwt.verify(trimmed, getJwtSecret());
    if (typeof decoded !== "object" || decoded === null) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const payload = decoded as jwt.JwtPayload & { userId?: unknown };
    if (typeof payload.userId !== "string" || payload.userId.trim().length === 0) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    req.user = { id: payload.userId.trim() };
    next();
  } catch {
    res.status(401).json({ error: "Unauthorized" });
  }
}
