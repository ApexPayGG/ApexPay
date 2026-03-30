import { createHash } from "node:crypto";
const ACQUIRE_LUA = `
local sk = KEYS[1]
local bk = KEYS[2]
local ttl = tonumber(ARGV[1])
local s = redis.call('GET', sk)
if s == false then
  redis.call('SET', sk, 'PENDING', 'EX', ttl)
  return 'ACQUIRED'
end
if s == 'PENDING' then
  return 'PENDING'
end
if s == 'COMPLETE' then
  return redis.call('GET', bk)
end
return 'UNKNOWN'
`;
export function computeResolveIdempotencyHash(matchId, idempotencyKey) {
    return createHash("sha256")
        .update(`${matchId}:${idempotencyKey}`, "utf8")
        .digest("hex");
}
function stateKey(hash) {
    return `idemp:v1:${hash}:state`;
}
function bodyKey(hash) {
    return `idemp:v1:${hash}:body`;
}
/**
 * Idempotency for POST /api/v1/matches/:id/resolve.
 * Hash = SHA-256(matchId + ":" + Idempotency-Key).
 * Redis: Lua acquire is atomic; completion uses MULTI/EXEC.
 */
export function createIdempotencyResolveMiddleware(redis, options = {}) {
    const ttlSeconds = options.ttlSeconds ?? 86_400;
    return (req, res, next) => {
        void run(req, res, next).catch((err) => {
            next(err);
        });
    };
    async function run(req, res, next) {
        const rawMatch = req.params.id;
        const matchId = typeof rawMatch === "string"
            ? rawMatch.trim()
            : Array.isArray(rawMatch) && rawMatch[0] !== undefined
                ? String(rawMatch[0]).trim()
                : "";
        const rawKey = req.headers["idempotency-key"];
        const idempotencyKey = typeof rawKey === "string" ? rawKey.trim() : undefined;
        if (matchId.length === 0 ||
            idempotencyKey === undefined ||
            idempotencyKey.length === 0) {
            res.status(400).json({
                error: "Wymagane: Idempotency-Key oraz prawidłowe ID meczu.",
            });
            return;
        }
        const hash = computeResolveIdempotencyHash(matchId, idempotencyKey);
        const sk = stateKey(hash);
        const bk = bodyKey(hash);
        const evalResult = await redis.eval(ACQUIRE_LUA, 2, sk, bk, String(ttlSeconds));
        if (evalResult === "PENDING") {
            res.status(409).json({
                error: "Rozliczenie w toku dla tego klucza idempotentności.",
            });
            return;
        }
        if (evalResult === "ACQUIRED") {
            const origJson = res.json.bind(res);
            res.json = (body) => {
                const code = res.statusCode;
                if (code >= 200 && code < 300) {
                    const serialized = JSON.stringify(body ?? null);
                    void redis
                        .multi()
                        .set(sk, "COMPLETE", "EX", ttlSeconds)
                        .set(bk, serialized, "EX", ttlSeconds)
                        .exec();
                }
                else {
                    void redis.del(sk, bk);
                }
                return origJson(body);
            };
            next();
            return;
        }
        if (evalResult === "UNKNOWN" ||
            evalResult === null ||
            evalResult === undefined) {
            res.status(500).json({ error: "Stan idempotentności jest nieprawidłowy." });
            return;
        }
        try {
            const parsed = JSON.parse(evalResult);
            res.status(200).json(parsed);
        }
        catch {
            res.status(500).json({ error: "Nie można odtworzyć odpowiedzi z cache." });
        }
    }
}
//# sourceMappingURL=idempotency-resolve.middleware.js.map