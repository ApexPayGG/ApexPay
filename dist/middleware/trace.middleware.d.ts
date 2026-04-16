import type { NextFunction, Request, Response } from "express";
export declare const APEX_TRACE_HEADER = "x-trace-id";
/**
 * HTTP: `x-trace-id` z upstream lub nowy UUID, nagłówek odpowiedzi, AsyncLocalStorage,
 * automatyczny access log (method, url, statusCode, responseTime) przez pino-http.
 */
export declare function createTraceMiddleware(): (req: Request, res: Response, next: NextFunction) => void;
//# sourceMappingURL=trace.middleware.d.ts.map