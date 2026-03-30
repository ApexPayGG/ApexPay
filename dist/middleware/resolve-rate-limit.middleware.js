import { randomUUID } from "node:crypto";
const WINDOW_MS = 60_000;
const MAX_REQUESTS = 5;
const KEY_PREFIX = "ratelimit:sliding:v1:resolve:user:";
/**
 * Sliding window (Redis ZSET + czas jako score) — atomowo w Lua.
 * Limit: MAX_REQUESTS żądań na WINDOW_MS na użytkownika (req.user.id — wymaga wcześniejszego auth).
 */
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
export function createResolveRateLimitMiddleware(redis) {
    return (req, res, next) => {
        void run(req, res, next).catch((err) => {
            next(err);
        });
    };
    async function run(req, res, next) {
        const userId = req.user?.id;
        if (typeof userId !== "string" || userId.length === 0) {
            res.status(401).json({ error: "Unauthorized" });
            return;
        }
        const now = Date.now();
        const member = `${now}:${randomUUID()}`;
        const key = `${KEY_PREFIX}${userId}`;
        const result = (await redis.eval(SLIDING_WINDOW_LUA, 1, key, String(now), String(WINDOW_MS), String(MAX_REQUESTS), member));
        const allowed = result[0] === 1;
        if (!allowed) {
            res.setHeader("Retry-After", String(Math.ceil(WINDOW_MS / 1000)));
            res.status(429).json({
                error: "Too Many Requests",
                message: `Limit ${MAX_REQUESTS} żądań na ${WINDOW_MS / 1000}s dla tego endpointu.`,
            });
            return;
        }
        next();
    }
}
//# sourceMappingURL=resolve-rate-limit.middleware.js.map