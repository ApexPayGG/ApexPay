import type { NextFunction, Request, Response } from "express";
import type { Redis } from "ioredis";
export declare function computeResolveIdempotencyHash(matchId: string, idempotencyKey: string): string;
export type IdempotencyResolveOptions = {
    ttlSeconds?: number;
};
/**
 * Idempotency for POST /api/v1/matches/:id/resolve.
 * Hash = SHA-256(matchId + ":" + Idempotency-Key).
 * Redis: Lua acquire is atomic; completion uses MULTI/EXEC.
 */
export declare function createIdempotencyResolveMiddleware(redis: Redis, options?: IdempotencyResolveOptions): (req: Request, res: Response, next: NextFunction) => void;
//# sourceMappingURL=idempotency-resolve.middleware.d.ts.map