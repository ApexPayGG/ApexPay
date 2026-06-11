import { getContext } from "./request-context.js";
/** Stabilne kody dla klientów (front / integracje). Komunikat może być PL lub EN w zależności od endpointu. */
export const ApiErrorCode = {
    BAD_REQUEST: "BAD_REQUEST",
    UNAUTHORIZED: "UNAUTHORIZED",
    FORBIDDEN: "FORBIDDEN",
    NOT_FOUND: "NOT_FOUND",
    CONFLICT: "CONFLICT",
    PAYMENT_REQUIRED: "PAYMENT_REQUIRED",
    TOO_MANY_REQUESTS: "TOO_MANY_REQUESTS",
    SERVICE_UNAVAILABLE: "SERVICE_UNAVAILABLE",
    INTERNAL: "INTERNAL_ERROR",
};
export function sendApiError(res, status, code, message) {
    const { traceId } = getContext();
    const body = {
        error: message,
        code,
    };
    if (traceId !== undefined) {
        body.traceId = traceId;
    }
    res.status(status).json(body);
}
//# sourceMappingURL=api-error.js.map