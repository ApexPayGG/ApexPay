import { randomUUID } from "node:crypto";
import { pinoHttp } from "pino-http";
import { logger } from "../lib/logger.js";
import { getContext, runWithContext } from "../lib/request-context.js";
export const APEX_TRACE_HEADER = "x-trace-id";
/**
 * HTTP: `x-trace-id` z upstream lub nowy UUID, nagłówek odpowiedzi, AsyncLocalStorage,
 * automatyczny access log (method, url, statusCode, responseTime) przez pino-http.
 */
export function createTraceMiddleware() {
    const httpLogger = pinoHttp({
        logger,
        genReqId: (req) => typeof req.apexTraceId === "string" && req.apexTraceId.length > 0
            ? req.apexTraceId
            : randomUUID(),
        customProps: () => {
            const ctx = getContext();
            return ctx.traceId !== undefined ? { traceId: ctx.traceId } : {};
        },
    });
    return (req, res, next) => {
        const raw = req.headers[APEX_TRACE_HEADER];
        const traceId = typeof raw === "string" && raw.trim().length > 0
            ? raw.trim().slice(0, 128)
            : randomUUID();
        req.apexTraceId = traceId;
        const ctx = {
            traceId,
            userId: undefined,
            actorType: undefined,
        };
        runWithContext(ctx, () => {
            res.setHeader(APEX_TRACE_HEADER, traceId);
            httpLogger(req, res, next);
        });
    };
}
//# sourceMappingURL=trace.middleware.js.map