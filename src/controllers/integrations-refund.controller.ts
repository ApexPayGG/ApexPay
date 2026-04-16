import type { Request, Response } from "express";
import { RefundCoveredBy } from "@prisma/client";
import { z, ZodError } from "zod";
import { IdempotencyConflictError } from "../services/marketplace-charge.service.js";
import {
  ChargeAlreadyFullyRefundedError,
  RefundAmountExceededError,
  RefundChargeNotFoundError,
  RefundConfigurationError,
  RefundForbiddenError,
  RefundNoConnectedAccountsForCoverageError,
  RefundService,
  RefundSplitAccountsMissingError,
  RefundWindowExpiredError,
} from "../services/refund.service.js";
import { InsufficientFundsError, WalletNotFoundError } from "../services/wallet.service.js";
import type { Redis } from "ioredis";

const bodySchema = z
  .object({
    amount: z.number().int().positive(),
    coveredBy: z.enum(["PLATFORM", "CONNECTED_ACCOUNT", "SPLIT"]),
    reason: z.string().trim().max(255).optional(),
  })
  .strict();

function coveredByFromString(s: string): RefundCoveredBy {
  switch (s) {
    case "PLATFORM":
      return RefundCoveredBy.PLATFORM;
    case "CONNECTED_ACCOUNT":
      return RefundCoveredBy.CONNECTED_ACCOUNT;
    case "SPLIT":
      return RefundCoveredBy.SPLIT;
    default:
      return RefundCoveredBy.PLATFORM;
  }
}

function serializeRefund(row: {
  id: string;
  chargeId: string;
  amount: bigint;
  currency: string;
  status: string;
  coveredBy: string;
  reason: string | null;
  initiatedBy: string;
  idempotencyKey: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    chargeId: row.chargeId,
    amount: row.amount.toString(),
    currency: row.currency,
    status: row.status,
    coveredBy: row.coveredBy,
    reason: row.reason,
    initiatedBy: row.initiatedBy,
    idempotencyKey: row.idempotencyKey,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export class IntegrationsRefundController {
  constructor(
    private readonly refundService: RefundService,
    private readonly redis: Redis,
  ) {}

  async listForCharge(req: Request, res: Response): Promise<void> {
    const integratorUserId = req.user?.id?.trim();
    if (integratorUserId === undefined || integratorUserId.length === 0) {
      res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
      return;
    }

    const chargeId = typeof req.params.chargeId === "string" ? req.params.chargeId.trim() : "";
    if (chargeId.length === 0) {
      res.status(400).json({ error: "Brak chargeId.", code: "BAD_REQUEST" });
      return;
    }

    try {
      const rows = await this.refundService.listForCharge(integratorUserId, chargeId);
      res.status(200).json({
        status: "success",
        data: { items: rows.map(serializeRefund) },
      });
    } catch (err) {
      if (err instanceof RefundChargeNotFoundError) {
        res.status(404).json({ error: err.message, code: "NOT_FOUND" });
        return;
      }
      if (err instanceof RefundForbiddenError) {
        res.status(403).json({ error: err.message, code: "FORBIDDEN" });
        return;
      }
      if (err instanceof RangeError) {
        res.status(400).json({ error: err.message, code: "BAD_REQUEST" });
        return;
      }
      console.error("[integrations/charges/.../refunds GET]", err);
      res.status(500).json({ error: "Internal server error" });
    }
  }

  async create(req: Request, res: Response): Promise<void> {
    const integratorUserId = req.user?.id?.trim();
    if (integratorUserId === undefined || integratorUserId.length === 0) {
      res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
      return;
    }

    const chargeId = typeof req.params.chargeId === "string" ? req.params.chargeId.trim() : "";
    if (chargeId.length === 0) {
      res.status(400).json({ error: "Brak chargeId.", code: "BAD_REQUEST" });
      return;
    }

    const idemHeader = req.headers["idempotency-key"];
    const idempotencyKey =
      typeof idemHeader === "string" && idemHeader.trim().length > 0
        ? idemHeader.trim().slice(0, 256)
        : "";
    if (idempotencyKey.length === 0) {
      res.status(400).json({
        error: "Wymagany nagłówek Idempotency-Key.",
        code: "BAD_REQUEST",
      });
      return;
    }

    try {
      const body = bodySchema.parse(req.body);
      const { refund } = await this.refundService.createRefund({
        redis: this.redis,
        integratorUserId,
        chargeId,
        amount: BigInt(body.amount),
        coveredBy: coveredByFromString(body.coveredBy),
        reason: body.reason,
        idempotencyKey,
        initiatedBy: integratorUserId,
        request: req,
      });

      res.status(201).json({ status: "success", data: serializeRefund(refund) });
    } catch (err) {
      if (err instanceof ZodError) {
        res.status(400).json({ error: "Nieprawidłowe dane.", code: "BAD_REQUEST" });
        return;
      }
      if (err instanceof IdempotencyConflictError) {
        res.status(409).json({ error: err.message, code: "CONFLICT" });
        return;
      }
      if (err instanceof RefundChargeNotFoundError) {
        res.status(404).json({ error: err.message, code: "NOT_FOUND" });
        return;
      }
      if (err instanceof RefundForbiddenError) {
        res.status(403).json({ error: err.message, code: "FORBIDDEN" });
        return;
      }
      if (
        err instanceof RefundWindowExpiredError ||
        err instanceof RefundAmountExceededError ||
        err instanceof ChargeAlreadyFullyRefundedError ||
        err instanceof RefundSplitAccountsMissingError ||
        err instanceof RefundNoConnectedAccountsForCoverageError
      ) {
        res.status(400).json({ error: err.message, code: "BAD_REQUEST" });
        return;
      }
      if (err instanceof RefundConfigurationError) {
        res.status(503).json({ error: err.message, code: "SERVICE_UNAVAILABLE" });
        return;
      }
      if (err instanceof InsufficientFundsError) {
        res.status(409).json({ error: err.message, code: "CONFLICT" });
        return;
      }
      if (err instanceof WalletNotFoundError) {
        res.status(404).json({ error: err.message, code: "NOT_FOUND" });
        return;
      }
      if (err instanceof RangeError) {
        res.status(400).json({ error: err.message, code: "BAD_REQUEST" });
        return;
      }
      console.error("[integrations/charges/.../refunds POST]", err);
      res.status(500).json({ error: "Internal server error" });
    }
  }
}
