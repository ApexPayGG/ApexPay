import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { Redis } from "ioredis";
import { contextLogger } from "./logger.js";
import { getContext } from "./request-context.js";

export type RateLimiterOptions = {
  windowMs: number;
  max: number;
  keyPrefix: string;
  message?: string;
};

function parseTrustedIpsEnv(): Set<string> {
  const raw = process.env.RATE_LIMIT_TRUSTED_IPS?.trim();
  if (raw === undefined || raw.length === 0) {
    return new Set();
  }
  const out = new Set<string>();
  for (const part of raw.split(",")) {
    const ip = part.trim();
    if (ip.length > 0) {
      out.add(normalizeIp(ip));
    }
  }
  return out;
}

function normalizeIp(ip: string): string {
  if (ip.startsWith("::ffff:")) {
    return ip.slice("::ffff:".length);
  }
  return ip;
}

function ipFromRequest(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim().length > 0) {
    const first = forwarded.split(",")[0]?.trim();
    if (first !== undefined && first.length > 0) {
      return normalizeIp(first);
    }
  }
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  return normalizeIp(ip);
}

function identifierForRequest(req: Request): string {
  const ip = ipFromRequest(req);
  // Dla auth dokładamy email (jeśli dostępny), aby utrudnić brute force na pojedyncze konto.
  const authLike = req.path.includes("/auth/") || req.originalUrl.includes("/auth/");
  const maybeEmail = (req.body as { email?: unknown } | undefined)?.email;
  if (authLike && typeof maybeEmail === "string" && maybeEmail.trim().length > 0) {
    return `${ip}:${maybeEmail.trim().toLowerCase()}`;
  }
  return ip;
}

export function createRateLimiter(redis: Redis, options: RateLimiterOptions): RequestHandler {
  const trustedIps = parseTrustedIpsEnv();
  const max = Math.max(1, Math.floor(options.max));
  const windowMs = Math.max(1, Math.floor(options.windowMs));

  return (req: Request, res: Response, next: NextFunction): void => {
    void run(req, res, next).catch((err: unknown) => {
      console.error("[rate-limiter] redis error, failing open:", err);
      next();
    });
  };

  async function run(req: Request, res: Response, next: NextFunction): Promise<void> {
    const ip = ipFromRequest(req);
    if (trustedIps.has(ip)) {
      next();
      return;
    }

    const identifier = identifierForRequest(req);
    const key = `rl:${options.keyPrefix}:${identifier}`;
    const count = await redis.incr(key);
    if (count === 1) {
      await redis.pexpire(key, windowMs);
    }
    const ttlMs = await redis.pttl(key);
    const safeTtlMs = ttlMs > 0 ? ttlMs : windowMs;
    const retryAfter = Math.max(1, Math.ceil(safeTtlMs / 1000));
    const resetUnix = Math.floor((Date.now() + safeTtlMs) / 1000);
    const remaining = Math.max(0, max - count);

    res.setHeader("X-RateLimit-Limit", String(max));
    res.setHeader("X-RateLimit-Remaining", String(remaining));
    res.setHeader("X-RateLimit-Reset", String(resetUnix));

    if (count > max) {
      const { traceId } = getContext();
      contextLogger().warn(
        {
          ip,
          path: req.path,
          keyPrefix: options.keyPrefix,
          traceId,
        },
        "Rate limit exceeded",
      );
      res.status(429).json({
        error: "TOO_MANY_REQUESTS",
        retryAfter,
        message: options.message ?? "Too many requests",
      });
      return;
    }

    next();
  }
}

