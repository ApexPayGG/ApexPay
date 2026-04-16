import type { Response } from "express";
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
} as const;

export type ApiErrorCodeType = (typeof ApiErrorCode)[keyof typeof ApiErrorCode];

export function sendApiError(
  res: Response,
  status: number,
  code: ApiErrorCodeType,
  message: string,
): void {
  const { traceId } = getContext();
  const body: { error: string; code: ApiErrorCodeType; traceId?: string } = {
    error: message,
    code,
  };
  if (traceId !== undefined) {
    body.traceId = traceId;
  }
  res.status(status).json(body);
}
