import type { NextFunction, Request, Response } from "express";
import type { Redis } from "ioredis";
export declare function createResolveRateLimitMiddleware(redis: Redis): (req: Request, res: Response, next: NextFunction) => void;
//# sourceMappingURL=resolve-rate-limit.middleware.d.ts.map