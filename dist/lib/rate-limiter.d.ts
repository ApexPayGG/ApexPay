import type { RequestHandler } from "express";
import type { Redis } from "ioredis";
export type RateLimiterOptions = {
    windowMs: number;
    max: number;
    keyPrefix: string;
    message?: string;
};
export declare function createRateLimiter(redis: Redis, options: RateLimiterOptions): RequestHandler;
//# sourceMappingURL=rate-limiter.d.ts.map