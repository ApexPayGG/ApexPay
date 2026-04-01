/** Stabilne kody dla klientów (front / integracje). Komunikat może być PL lub EN w zależności od endpointu. */
export const ApiErrorCode = {
    BAD_REQUEST: "BAD_REQUEST",
    UNAUTHORIZED: "UNAUTHORIZED",
    FORBIDDEN: "FORBIDDEN",
    NOT_FOUND: "NOT_FOUND",
    CONFLICT: "CONFLICT",
    PAYMENT_REQUIRED: "PAYMENT_REQUIRED",
    TOO_MANY_REQUESTS: "TOO_MANY_REQUESTS",
    INTERNAL: "INTERNAL_ERROR",
};
export function sendApiError(res, status, code, message) {
    res.status(status).json({ error: message, code });
}
//# sourceMappingURL=api-error.js.map