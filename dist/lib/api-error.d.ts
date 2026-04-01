import type { Response } from "express";
/** Stabilne kody dla klientów (front / integracje). Komunikat może być PL lub EN w zależności od endpointu. */
export declare const ApiErrorCode: {
    readonly BAD_REQUEST: "BAD_REQUEST";
    readonly UNAUTHORIZED: "UNAUTHORIZED";
    readonly FORBIDDEN: "FORBIDDEN";
    readonly NOT_FOUND: "NOT_FOUND";
    readonly CONFLICT: "CONFLICT";
    readonly PAYMENT_REQUIRED: "PAYMENT_REQUIRED";
    readonly TOO_MANY_REQUESTS: "TOO_MANY_REQUESTS";
    readonly INTERNAL: "INTERNAL_ERROR";
};
export type ApiErrorCodeType = (typeof ApiErrorCode)[keyof typeof ApiErrorCode];
export declare function sendApiError(res: Response, status: number, code: ApiErrorCodeType, message: string): void;
//# sourceMappingURL=api-error.d.ts.map