import type { Response } from "express";

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
} as const;

export type ApiErrorCodeType = (typeof ApiErrorCode)[keyof typeof ApiErrorCode];

export function sendApiError(
  res: Response,
  status: number,
  code: ApiErrorCodeType,
  message: string,
): void {
  res.status(status).json({ error: message, code });
}
