import type { NextFunction, Request, Response } from "express";

/**
 * Oznacza odpowiedzi z legacy `/api/...` (bez `/api/v1`) nagłówkami Deprecation / Sunset.
 * Preferuj klienty pod `/api/v1/...`.
 */
export function legacyApiDeprecationMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const p = req.path;
  if (
    p.startsWith("/api/v1") ||
    p.startsWith("/internal") ||
    p.startsWith("/health") ||
    p === "/metrics" ||
    p.startsWith("/metrics/")
  ) {
    next();
    return;
  }
  if (p.startsWith("/api/")) {
    res.setHeader("Deprecation", "true");
    res.setHeader("Sunset", "Wed, 31 Dec 2026 23:59:59 GMT");
    res.setHeader(
      "Link",
      '<https://api.apexpay.pl/api/v1/>; rel="successor-version"',
    );
  }
  next();
}
