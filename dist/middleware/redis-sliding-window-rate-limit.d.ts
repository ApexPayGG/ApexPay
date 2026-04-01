import type { NextFunction, Request, Response } from "express";
import type { Redis } from "ioredis";
export type SlidingWindowRateLimitOptions = {
    windowMs: number;
    maxRequests: number;
    keyPrefix: string;
    /** Klucz Redis dla danego żądania (np. IP). */
    keyFromRequest: (req: Request) => string;
};
/**
 * Limit żądań na okno czasowe (Redis + Lua), jedna instancja na prefix.
 */
export declare function createSlidingWindowRateLimit(redis: Redis, options: SlidingWindowRateLimitOptions): (req: Request, res: Response, next: NextFunction) => void;
/** IP z proxy (pierwszy adres z X-Forwarded-For) lub socket. */
export declare function clientIpForRateLimit(req: Request): string;
//# sourceMappingURL=redis-sliding-window-rate-limit.d.ts.map