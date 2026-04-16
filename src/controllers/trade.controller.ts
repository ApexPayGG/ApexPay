import type { Request, Response } from "express";
import { z } from "zod";
import { sendApiError, ApiErrorCode } from "../lib/api-error.js";
import {
  TradeService,
  TradeExpiredError,
  TradeInsufficientFundsError,
  TradeInvalidStatusError,
  TradeNotFoundError,
  TradePlatformConfigError,
} from "../services/trade.service.js";

function paramTradeId(req: Request): string {
  const raw = req.params["tradeId"];
  if (typeof raw !== "string") {
    return "";
  }
  return raw.trim();
}

const createTradeSchema = z.object({
  itemName: z.string().min(1).max(256),
  description: z.string().max(4000).optional(),
  amountCents: z.number().int().positive(),
  expiresInHours: z.number().int().min(1).max(720).optional(),
});

export class TradeController {
  constructor(private readonly tradeService: TradeService) {}

  /** GET /api/v1/trades?seller=me — lista trade'ów zalogowanego sprzedawcy (wymaga JWT). */
  async listMine(req: Request, res: Response): Promise<void> {
    const sellerParam = req.query["seller"];
    if (sellerParam !== "me") {
      sendApiError(res, 400, ApiErrorCode.BAD_REQUEST, "Expected query seller=me");
      return;
    }
    const userId = req.user?.id?.trim();
    if (userId === undefined || userId.length === 0) {
      sendApiError(res, 401, ApiErrorCode.UNAUTHORIZED, "Unauthorized");
      return;
    }

    const limitRaw = Number.parseInt(String(req.query["limit"] ?? "20"), 10);
    const limit = Number.isFinite(limitRaw) ? limitRaw : 20;

    try {
      const data = await this.tradeService.listTradesForSeller(userId, { limit });
      res.status(200).json({ status: "success", data });
    } catch (err) {
      console.error("[trade/list]", err);
      sendApiError(res, 500, ApiErrorCode.INTERNAL, "Internal server error");
    }
  }

  async create(req: Request, res: Response): Promise<void> {
    const userId = req.user?.id?.trim();
    if (userId === undefined || userId.length === 0) {
      sendApiError(res, 401, ApiErrorCode.UNAUTHORIZED, "Unauthorized");
      return;
    }

    const parsed = createTradeSchema.safeParse(req.body);
    if (!parsed.success) {
      sendApiError(res, 400, ApiErrorCode.BAD_REQUEST, "Invalid request body");
      return;
    }

    try {
      const body = parsed.data;
      const result = await this.tradeService.createTrade(userId, {
        itemName: body.itemName,
        amountCents: body.amountCents,
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.expiresInHours !== undefined ? { expiresInHours: body.expiresInHours } : {}),
      });
      res.status(201).json({ status: "success", data: result });
    } catch (err) {
      if (err instanceof RangeError) {
        sendApiError(res, 400, ApiErrorCode.BAD_REQUEST, err.message);
        return;
      }
      console.error("[trade/create]", err);
      sendApiError(res, 500, ApiErrorCode.INTERNAL, "Internal server error");
    }
  }

  async getById(req: Request, res: Response): Promise<void> {
    const tradeId = paramTradeId(req);
    if (tradeId.length === 0) {
      sendApiError(res, 400, ApiErrorCode.BAD_REQUEST, "Missing trade id");
      return;
    }

    try {
      const data = await this.tradeService.getTrade(tradeId);
      res.status(200).json({ status: "success", data });
    } catch (err) {
      if (err instanceof TradeNotFoundError) {
        sendApiError(res, 404, ApiErrorCode.NOT_FOUND, err.message);
        return;
      }
      console.error("[trade/get]", err);
      sendApiError(res, 500, ApiErrorCode.INTERNAL, "Internal server error");
    }
  }

  async pay(req: Request, res: Response): Promise<void> {
    const userId = req.user?.id?.trim();
    if (userId === undefined || userId.length === 0) {
      sendApiError(res, 401, ApiErrorCode.UNAUTHORIZED, "Unauthorized");
      return;
    }
    const tradeId = paramTradeId(req);
    if (tradeId.length === 0) {
      sendApiError(res, 400, ApiErrorCode.BAD_REQUEST, "Missing trade id");
      return;
    }

    try {
      await this.tradeService.payTrade(tradeId, userId);
      res.status(200).json({ status: "success", data: { paid: true } });
    } catch (err) {
      if (err instanceof TradeNotFoundError) {
        sendApiError(res, 404, ApiErrorCode.NOT_FOUND, err.message);
        return;
      }
      if (err instanceof TradeExpiredError) {
        sendApiError(res, 410, ApiErrorCode.BAD_REQUEST, err.message);
        return;
      }
      if (err instanceof TradeInvalidStatusError) {
        sendApiError(res, 409, ApiErrorCode.CONFLICT, err.message);
        return;
      }
      if (err instanceof TradeInsufficientFundsError) {
        sendApiError(res, 402, ApiErrorCode.PAYMENT_REQUIRED, err.message);
        return;
      }
      console.error("[trade/pay]", err);
      sendApiError(res, 500, ApiErrorCode.INTERNAL, "Internal server error");
    }
  }

  async confirm(req: Request, res: Response): Promise<void> {
    const userId = req.user?.id?.trim();
    if (userId === undefined || userId.length === 0) {
      sendApiError(res, 401, ApiErrorCode.UNAUTHORIZED, "Unauthorized");
      return;
    }
    const tradeId = paramTradeId(req);
    if (tradeId.length === 0) {
      sendApiError(res, 400, ApiErrorCode.BAD_REQUEST, "Missing trade id");
      return;
    }

    try {
      await this.tradeService.confirmReceipt(tradeId, userId);
      res.status(200).json({ status: "success", data: { completed: true } });
    } catch (err) {
      if (err instanceof TradeNotFoundError) {
        sendApiError(res, 404, ApiErrorCode.NOT_FOUND, err.message);
        return;
      }
      if (err instanceof TradeInvalidStatusError) {
        sendApiError(res, 409, ApiErrorCode.CONFLICT, err.message);
        return;
      }
      if (err instanceof TradePlatformConfigError) {
        sendApiError(res, 503, ApiErrorCode.SERVICE_UNAVAILABLE, err.message);
        return;
      }
      console.error("[trade/confirm]", err);
      sendApiError(res, 500, ApiErrorCode.INTERNAL, "Internal server error");
    }
  }

  async cancel(req: Request, res: Response): Promise<void> {
    const userId = req.user?.id?.trim();
    if (userId === undefined || userId.length === 0) {
      sendApiError(res, 401, ApiErrorCode.UNAUTHORIZED, "Unauthorized");
      return;
    }
    const tradeId = paramTradeId(req);
    if (tradeId.length === 0) {
      sendApiError(res, 400, ApiErrorCode.BAD_REQUEST, "Missing trade id");
      return;
    }

    try {
      await this.tradeService.cancelBySeller(tradeId, userId);
      res.status(200).json({ status: "success", data: { cancelled: true } });
    } catch (err) {
      if (err instanceof TradeNotFoundError) {
        sendApiError(res, 404, ApiErrorCode.NOT_FOUND, err.message);
        return;
      }
      if (err instanceof TradeInvalidStatusError) {
        sendApiError(res, 409, ApiErrorCode.CONFLICT, err.message);
        return;
      }
      console.error("[trade/cancel]", err);
      sendApiError(res, 500, ApiErrorCode.INTERNAL, "Internal server error");
    }
  }
}
