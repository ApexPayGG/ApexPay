import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";

/** Rozszerzenie typu Request o obiekt użytkownika zdekodowany z tokena */
export interface AuthRequest extends Request {
  user?: { id: string; role?: string };
}

declare global {
  namespace Express {
    interface Request {
      user?: { id: string; role?: string };
    }
  }
}

const MSG_NO_TOKEN = "Brak tokena dostępu. Odmowa dostępu.";
const MSG_TOKEN_INVALID = "Token wygasł lub jest nieprawidłowy.";
const MSG_FORBIDDEN_ROLE = "Brak uprawnień do wykonania tej operacji.";

function getJwtSecret(): string {
  return process.env.JWT_SECRET || "dev-secret";
}

function tokenFromAuthorizationHeader(req: Request): string | undefined {
  const authHeader = req.headers.authorization;
  const part = authHeader?.split(" ")[1];
  if (typeof part !== "string" || part.trim().length === 0) {
    return undefined;
  }
  return part.trim();
}

/**
 * Zero Trust: JWT z ciasteczka `jwt` lub z nagłówka `Authorization` (drugi segment po spacji).
 * Nie loguj tokenów ani sekretów.
 */
function tokenFromRequest(req: Request): string | undefined {
  const fromCookie = req.cookies?.jwt;
  if (typeof fromCookie === "string" && fromCookie.trim().length > 0) {
    return fromCookie.trim();
  }
  return tokenFromAuthorizationHeader(req);
}

function attachUserFromPayload(
  req: Request,
  payload: jwt.JwtPayload & { userId?: unknown; role?: unknown },
): boolean {
  if (typeof payload.userId !== "string" || payload.userId.trim().length === 0) {
    return false;
  }
  const id = payload.userId.trim();
  const role =
    typeof payload.role === "string" && payload.role.length > 0
      ? payload.role
      : undefined;
  req.user = role !== undefined ? { id, role } : { id };
  return true;
}

export const authenticateToken = (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): void => {
  const token = tokenFromAuthorizationHeader(req);
  if (token === undefined) {
    res.status(401).json({ error: MSG_NO_TOKEN });
    return;
  }

  try {
    const decoded = jwt.verify(token, getJwtSecret());
    if (typeof decoded !== "object" || decoded === null) {
      res.status(403).json({ error: MSG_TOKEN_INVALID });
      return;
    }
    const payload = decoded as jwt.JwtPayload & {
      userId?: unknown;
      role?: unknown;
    };
    if (!attachUserFromPayload(req, payload)) {
      res.status(403).json({ error: MSG_TOKEN_INVALID });
      return;
    }
    next();
  } catch {
    res.status(403).json({ error: MSG_TOKEN_INVALID });
  }
};

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const token = tokenFromRequest(req);
  if (token === undefined) {
    res.status(401).json({ error: MSG_NO_TOKEN });
    return;
  }

  try {
    const decoded = jwt.verify(token, getJwtSecret());
    if (typeof decoded !== "object" || decoded === null) {
      res.status(403).json({ error: MSG_TOKEN_INVALID });
      return;
    }
    const payload = decoded as jwt.JwtPayload & {
      userId?: unknown;
      role?: unknown;
    };
    if (!attachUserFromPayload(req, payload)) {
      res.status(403).json({ error: MSG_TOKEN_INVALID });
      return;
    }
    next();
  } catch {
    res.status(403).json({ error: MSG_TOKEN_INVALID });
  }
}

/** Funkcja wyższego rzędu (HOF) do weryfikacji ról (RBAC) */
export const requireRole = (allowedRoles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (
      !req.user ||
      req.user.role === undefined ||
      !allowedRoles.includes(req.user.role)
    ) {
      res.status(403).json({ error: MSG_FORBIDDEN_ROLE });
      return;
    }
    next();
  };
};
