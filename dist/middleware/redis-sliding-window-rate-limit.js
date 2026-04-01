import { randomUUID } from "node:crypto";
const SLIDING_WINDOW_LUA = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local member = ARGV[4]
redis.call('ZREMRANGEBYSCORE', key, '-inf', now - window)
local n = redis.call('ZCARD', key)
if n >= limit then
  return {0, n}
end
redis.call('ZADD', key, now, member)
redis.call('PEXPIRE', key, window + 1000)
return {1, n + 1}
`;
/**
 * Limit żądań na okno czasowe (Redis + Lua), jedna instancja na prefix.
 */
export function createSlidingWindowRateLimit(redis, options) {
    const { windowMs, maxRequests, keyPrefix, keyFromRequest } = options;
    return (req, res, next) => {
        void run(req, res, next).catch((err) => {
            next(err);
        });
    };
    async function run(req, res, next) {
        const part = keyFromRequest(req);
        if (part.length === 0) {
            next();
            return;
        }
        const now = Date.now();
        const member = `${now}:${randomUUID()}`;
        const key = `${keyPrefix}:${part}`;
        const result = (await redis.eval(SLIDING_WINDOW_LUA, 1, key, String(now), String(windowMs), String(maxRequests), member));
        const allowed = result[0] === 1;
        if (!allowed) {
            res.setHeader("Retry-After", String(Math.ceil(windowMs / 1000)));
            res.status(429).json({
                error: "Zbyt wiele żądań. Spróbuj za chwilę.",
                code: "TOO_MANY_REQUESTS",
            });
            return;
        }
        next();
    }
}
/** IP z proxy (pierwszy adres z X-Forwarded-For) lub socket. */
export function clientIpForRateLimit(req) {
    const forwarded = req.headers["x-forwarded-for"];
    if (typeof forwarded === "string" && forwarded.length > 0) {
        const first = forwarded.split(",")[0]?.trim();
        if (first !== undefined && first.length > 0) {
            return first;
        }
    }
    return req.socket.remoteAddress ?? "unknown";
}
//# sourceMappingURL=redis-sliding-window-rate-limit.js.map