import type { Request, Response } from "express";
import {
  MatchSettlementError,
  MatchSettlementService,
} from "../services/match-settlement.service.js";
import type { WebSocketService } from "../services/websocket.service.js";

function paramId(raw: string | string[] | undefined): string | undefined {
  if (typeof raw === "string") {
    return raw;
  }
  if (Array.isArray(raw) && raw.length > 0 && typeof raw[0] === "string") {
    return raw[0];
  }
  return undefined;
}

export class MatchResolveV1Controller {
  constructor(
    private readonly settlementService: Pick<
      MatchSettlementService,
      "settleDisputedMatch"
    >,
    private readonly wsService: WebSocketService,
  ) {}

  async resolve(req: Request, res: Response): Promise<void> {
    try {
      const rawMatchId = paramId(req.params.id);
      const { finalWinnerId } = req.body as { finalWinnerId?: unknown };

      if (
        rawMatchId === undefined ||
        rawMatchId.trim().length === 0 ||
        typeof finalWinnerId !== "string" ||
        finalWinnerId.trim().length === 0
      ) {
        res.status(400).json({ error: "Brak ID meczu lub ID zwycięzcy." });
        return;
      }

      const matchId = rawMatchId.trim();
      const winnerId = finalWinnerId.trim();

      const result = await this.settlementService.settleDisputedMatch({
        matchId,
        finalWinnerId: winnerId,
      });

      if (result.prizePaid) {
        this.wsService.notifyWallet(winnerId, "PAYOUT_RECEIVED", {
          message: "Środki rozliczone (v1).",
          matchId,
        });
      }

      res.status(200).json({
        status: "success",
        message: "Mecz rozliczony (SETTLED).",
        matchId: result.matchId,
        settlementStatus: result.status,
        winnerId: result.winnerId,
      });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : undefined;
      console.error("[ApexPay] Match resolve v1 failed:", msg ?? error);

      if (error instanceof MatchSettlementError) {
        if (error.code === "MATCH_NOT_FOUND") {
          res.status(404).json({ error: "Mecz nie istnieje." });
          return;
        }
        if (
          error.code === "MATCH_ALREADY_SETTLED" ||
          error.code === "MATCH_NOT_DISPUTED"
        ) {
          res.status(409).json({ error: "Mecz nie może być rozliczony w tym stanie." });
          return;
        }
      }

      if (
        typeof msg === "string" &&
        (msg.startsWith("CRITICAL:") || msg.includes("CRITICAL"))
      ) {
        res.status(500).json({ error: "Błąd rozliczenia meczu." });
        return;
      }

      res.status(500).json({ error: "Wewnętrzny błąd rozliczenia v1." });
    }
  }
}
