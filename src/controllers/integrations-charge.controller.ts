import type { Request, Response } from "express";
import { z, ZodError } from "zod";
import {
  ConnectedAccountInactiveError,
  ConnectedAccountIntegratorMismatchError,
  ConnectedAccountNotFoundError,
  IdempotencyConflictError,
  MarketplaceChargeService,
  MarketplaceValidationError,
  PaymentMethodNotOwnedError,
} from "../services/marketplace-charge.service.js";
import { FraudBlockedError } from "../services/fraud-detection.service.js";
import { InsufficientFundsError, WalletNotFoundError } from "../services/wallet.service.js";
import type { Redis } from "ioredis";
import { decodeCursor, parsePaginationLimit } from "../lib/pagination.js";
import { csvResponse, toCsv } from "../lib/csv-export.js";

const bodySchema = z
  .object({
    amount: z.number().int().positive(),
    currency: z.string().trim().min(1).max(16),
    paymentMethodId: z.string().trim().min(1).max(128).optional(),
    splits: z.array(
      z
        .object({
          connectedAccountId: z.string().trim().min(1).max(128),
          amount: z.number().int().positive(),
        })
        .strict(),
    ),
  })
  .strict();

function serializeCharge(charge: {
  id: string;
  debitUserId: string;
  integratorUserId: string;
  amountCents: bigint;
  currency: string;
  idempotencyKey: string | null;
  fraudCheckId: string | null;
  createdAt: Date;
}) {
  return {
    id: charge.id,
    debitUserId: charge.debitUserId,
    integratorUserId: charge.integratorUserId,
    amountCents: charge.amountCents.toString(),
    currency: charge.currency,
    idempotencyKey: charge.idempotencyKey,
    fraudCheckId: charge.fraudCheckId,
    createdAt: charge.createdAt,
  };
}

function serializeChargeListItem(row: {
  id: string;
  amountCents: bigint;
  currency: string;
  createdAt: Date;
  connectedAccountIds: string[];
}) {
  return {
    id: row.id,
    amountCents: row.amountCents.toString(),
    currency: row.currency,
    createdAt: row.createdAt.toISOString(),
    connectedAccountIds: row.connectedAccountIds,
  };
}

export class IntegrationsChargeController {
  constructor(
    private readonly marketplaceChargeService: MarketplaceChargeService,
    private readonly redis: Redis,
  ) {}

  async listCharges(req: Request, res: Response): Promise<void> {
    const integratorUserId = req.user?.id?.trim();
    if (integratorUserId === undefined || integratorUserId.length === 0) {
      res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
      return;
    }

    try {
      const limit = parsePaginationLimit(req.query["limit"]);
      const rawCursor = req.query["cursor"];
      const cursorStr =
        typeof rawCursor === "string" && rawCursor.trim().length > 0 ? rawCursor.trim() : undefined;
      if (cursorStr !== undefined && decodeCursor(cursorStr) === undefined) {
        res.status(400).json({ error: "Nieprawidłowy parametr cursor.", code: "BAD_REQUEST" });
        return;
      }
      const { items: rows, nextCursor } = await this.marketplaceChargeService.listForIntegration(
        integratorUserId,
        cursorStr === undefined ? { limit } : { limit, cursor: cursorStr },
      );
      const items = rows.map(serializeChargeListItem);
      res.status(200).json({ status: "success", data: { items, nextCursor } });
    } catch (err) {
      console.error("[integrations/charges GET]", err);
      res.status(500).json({ error: "Internal server error" });
    }
  }

  async exportCharges(req: Request, res: Response): Promise<void> {
    const integratorUserId = req.user?.id?.trim();
    if (integratorUserId === undefined || integratorUserId.length === 0) {
      res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
      return;
    }

    const parseDateQuery = (raw: unknown): Date | undefined => {
      if (typeof raw !== "string" || raw.trim().length === 0) {
        return undefined;
      }
      const date = new Date(raw.trim());
      if (Number.isNaN(date.getTime())) {
        throw new RangeError("invalid-date");
      }
      return date;
    };

    const parseExportLimit = (raw: unknown): number => {
      if (typeof raw !== "string" || raw.trim().length === 0) {
        return 5000;
      }
      const parsed = Number.parseInt(raw.trim(), 10);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new RangeError("invalid-limit");
      }
      return Math.min(parsed, 5000);
    };

    const formatPln = (amountCents: bigint): string => {
      const sign = amountCents < 0n ? "-" : "";
      const abs = amountCents < 0n ? -amountCents : amountCents;
      const zl = abs / 100n;
      const gr = (abs % 100n).toString().padStart(2, "0");
      return `${sign}${zl.toString()},${gr}`;
    };

    try {
      const from = parseDateQuery(req.query["from"]);
      const to = parseDateQuery(req.query["to"]);
      if (from !== undefined && to !== undefined && from > to) {
        res.status(400).json({ error: "Parametr from nie może być późniejszy niż to.", code: "BAD_REQUEST" });
        return;
      }
      const limit = parseExportLimit(req.query["limit"]);
      const { items } = await this.marketplaceChargeService.listForIntegration(integratorUserId, {
        limit,
      });
      const filtered = items.filter((row) => {
        if (from !== undefined && row.createdAt < from) {
          return false;
        }
        if (to !== undefined && row.createdAt > to) {
          return false;
        }
        return true;
      });

      const csv = toCsv(
        ["ID", "Kwota (PLN)", "Waluta", "Subkonto ID", "Status", "Data utworzenia"],
        filtered.map((row) => [
          row.id,
          formatPln(row.amountCents),
          row.currency,
          row.connectedAccountIds.length > 0 ? row.connectedAccountIds.join(" | ") : "—",
          "CREATED",
          row.createdAt.toISOString(),
        ]),
      );
      const today = new Date().toISOString().slice(0, 10);
      csvResponse(res, `charges_${today}.csv`, csv);
    } catch (err) {
      if (err instanceof RangeError) {
        res.status(400).json({ error: "Nieprawidłowe parametry eksportu.", code: "BAD_REQUEST" });
        return;
      }
      console.error("[integrations/charges/export GET]", err);
      res.status(500).json({ error: "Internal server error" });
    }
  }

  async createCharge(req: Request, res: Response): Promise<void> {
    const integratorUserId = req.user?.id?.trim();
    if (integratorUserId === undefined || integratorUserId.length === 0) {
      res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
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
      const splits = body.splits.map((s) => ({
        connectedAccountId: s.connectedAccountId,
        amountCents: BigInt(s.amount),
      }));

      const { charge } = await this.marketplaceChargeService.createIntegrationCharge({
        redis: this.redis,
        integratorUserId,
        idempotencyKey,
        amountCents: BigInt(body.amount),
        currency: body.currency,
        splits,
        paymentMethodId: body.paymentMethodId,
        request: req,
      });

      res.status(201).json({
        status: "success",
        data: serializeCharge(charge),
      });
    } catch (err) {
      if (err instanceof ZodError) {
        res.status(400).json({ error: "Nieprawidłowe dane.", code: "BAD_REQUEST" });
        return;
      }
      if (err instanceof IdempotencyConflictError) {
        res.status(409).json({ error: err.message, code: "CONFLICT" });
        return;
      }
      if (err instanceof MarketplaceValidationError) {
        res.status(400).json({ error: err.message, code: "BAD_REQUEST" });
        return;
      }
      if (err instanceof PaymentMethodNotOwnedError) {
        res.status(403).json({ error: err.message, code: "FORBIDDEN" });
        return;
      }
      if (err instanceof ConnectedAccountNotFoundError) {
        res.status(404).json({ error: "Nie znaleziono subkonta.", code: "NOT_FOUND" });
        return;
      }
      if (err instanceof ConnectedAccountIntegratorMismatchError) {
        res.status(403).json({ error: err.message, code: "FORBIDDEN" });
        return;
      }
      if (err instanceof ConnectedAccountInactiveError) {
        res.status(403).json({ error: err.message, code: "FORBIDDEN" });
        return;
      }
      if (err instanceof InsufficientFundsError) {
        res.status(402).json({ error: "Niewystarczające środki.", code: "PAYMENT_REQUIRED" });
        return;
      }
      if (err instanceof FraudBlockedError) {
        res.status(422).json({
          error: err.message,
          code: "FRAUD_BLOCKED",
          fraudCheckId: err.fraudCheckId,
          score: err.score,
        });
        return;
      }
      if (err instanceof WalletNotFoundError) {
        res.status(404).json({ error: "Brak portfela.", code: "NOT_FOUND" });
        return;
      }
      console.error("[integrations/charges]", err);
      res.status(500).json({ error: "Internal server error" });
    }
  }
}
