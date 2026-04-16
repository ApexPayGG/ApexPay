import type { Request, Response } from "express";
import { DisputeStatus } from "@prisma/client";
import { z, ZodError } from "zod";
import {
  DisputeInvalidStateError,
  DisputeNotFoundError,
  DisputeService,
} from "../services/dispute.service.js";

const MAX_LIMIT = 100;

const evidenceBodySchema = z
  .object({
    evidence: z.record(z.string(), z.any()),
  })
  .strict();

const resolveBodySchema = z
  .object({
    outcome: z.enum(["WON", "LOST", "ACCEPTED"]),
  })
  .strict();

function isDisputeStatus(s: string): s is DisputeStatus {
  return Object.values(DisputeStatus).includes(s as DisputeStatus);
}

function serializeDispute(d: {
  id: string;
  chargeId: string;
  pspDisputeId: string;
  status: DisputeStatus;
  reason: string;
  amount: bigint;
  currency: string;
  evidenceDueBy: Date;
  evidence: unknown;
  resolvedAt: Date | null;
  integratorNotifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: d.id,
    chargeId: d.chargeId,
    pspDisputeId: d.pspDisputeId,
    status: d.status,
    reason: d.reason,
    amount: d.amount.toString(),
    currency: d.currency,
    evidenceDueBy: d.evidenceDueBy.toISOString(),
    evidence: d.evidence,
    resolvedAt: d.resolvedAt?.toISOString() ?? null,
    integratorNotifiedAt: d.integratorNotifiedAt?.toISOString() ?? null,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  };
}

export class DisputeAdminController {
  constructor(private readonly disputeService: DisputeService) {}

  async list(req: Request, res: Response): Promise<void> {
    try {
      const limitRaw = Number.parseInt(String(req.query.limit ?? "50"), 10);
      const limit = Number.isFinite(limitRaw)
        ? Math.min(MAX_LIMIT, Math.max(1, limitRaw))
        : 50;

      const statusRaw = req.query.status;
      let status: DisputeStatus | undefined;
      if (typeof statusRaw === "string" && statusRaw.trim().length > 0) {
        const t = statusRaw.trim();
        if (!isDisputeStatus(t)) {
          res.status(400).json({
            error: "Nieprawidłowy status.",
            code: "BAD_REQUEST",
          });
          return;
        }
        status = t;
      }

      let from: Date | undefined;
      const fromRaw = req.query.from;
      if (typeof fromRaw === "string" && fromRaw.trim().length > 0) {
        const d = new Date(fromRaw.trim());
        if (Number.isNaN(d.getTime())) {
          res.status(400).json({ error: "Nieprawidłowe from.", code: "BAD_REQUEST" });
          return;
        }
        from = d;
      }

      let to: Date | undefined;
      const toRaw = req.query.to;
      if (typeof toRaw === "string" && toRaw.trim().length > 0) {
        const d = new Date(toRaw.trim());
        if (Number.isNaN(d.getTime())) {
          res.status(400).json({ error: "Nieprawidłowe to.", code: "BAD_REQUEST" });
          return;
        }
        to = d;
      }

      const cursorRaw = req.query.cursor;
      const cursor =
        typeof cursorRaw === "string" && cursorRaw.trim().length > 0
          ? cursorRaw.trim()
          : undefined;

      const filters: Parameters<DisputeService["listForAdmin"]>[0] = {};
      if (status !== undefined) {
        filters.status = status;
      }
      if (from !== undefined) {
        filters.from = from;
      }
      if (to !== undefined) {
        filters.to = to;
      }

      const { items, nextCursor } = await this.disputeService.listForAdmin(filters, limit, cursor);

      res.status(200).json({
        status: "success",
        data: {
          items: items.map(serializeDispute),
          nextCursor,
        },
      });
    } catch (err) {
      console.error("DisputeAdmin list:", err);
      res.status(500).json({
        error: "Błąd serwera przy pobieraniu sporów.",
        code: "INTERNAL_ERROR",
      });
    }
  }

  async getById(req: Request, res: Response): Promise<void> {
    const id = typeof req.params.id === "string" ? req.params.id.trim() : "";
    if (id.length === 0) {
      res.status(400).json({ error: "Brak identyfikatora.", code: "BAD_REQUEST" });
      return;
    }

    try {
      const row = await this.disputeService.getById(id);
      if (row === null) {
        res.status(404).json({ error: "Spór nie znaleziony.", code: "NOT_FOUND" });
        return;
      }
      res.status(200).json({ status: "success", data: serializeDispute(row) });
    } catch (err) {
      console.error("DisputeAdmin getById:", err);
      res.status(500).json({
        error: "Błąd serwera.",
        code: "INTERNAL_ERROR",
      });
    }
  }

  async submitEvidence(req: Request, res: Response): Promise<void> {
    const id = typeof req.params.id === "string" ? req.params.id.trim() : "";
    if (id.length === 0) {
      res.status(400).json({ error: "Brak identyfikatora.", code: "BAD_REQUEST" });
      return;
    }

    const adminUserId = req.user?.id?.trim();
    if (adminUserId === undefined || adminUserId.length === 0) {
      res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
      return;
    }

    try {
      const body = evidenceBodySchema.parse(req.body);
      const updated = await this.disputeService.submitEvidence(id, body.evidence, adminUserId);
      res.status(200).json({ status: "success", data: serializeDispute(updated) });
    } catch (err) {
      if (err instanceof ZodError) {
        res.status(400).json({ error: "Nieprawidłowe dane.", code: "BAD_REQUEST" });
        return;
      }
      if (err instanceof DisputeNotFoundError) {
        res.status(404).json({ error: err.message, code: "NOT_FOUND" });
        return;
      }
      if (err instanceof DisputeInvalidStateError) {
        res.status(409).json({ error: err.message, code: "CONFLICT" });
        return;
      }
      console.error("DisputeAdmin submitEvidence:", err);
      res.status(500).json({
        error: "Błąd serwera.",
        code: "INTERNAL_ERROR",
      });
    }
  }

  async resolve(req: Request, res: Response): Promise<void> {
    const id = typeof req.params.id === "string" ? req.params.id.trim() : "";
    if (id.length === 0) {
      res.status(400).json({ error: "Brak identyfikatora.", code: "BAD_REQUEST" });
      return;
    }

    const adminUserId = req.user?.id?.trim();
    if (adminUserId === undefined || adminUserId.length === 0) {
      res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
      return;
    }

    try {
      const body = resolveBodySchema.parse(req.body);
      const { dispute } = await this.disputeService.resolve(id, body.outcome, adminUserId);
      res.status(200).json({ status: "success", data: serializeDispute(dispute) });
    } catch (err) {
      if (err instanceof ZodError) {
        res.status(400).json({ error: "Nieprawidłowe dane.", code: "BAD_REQUEST" });
        return;
      }
      if (err instanceof DisputeNotFoundError) {
        res.status(404).json({ error: err.message, code: "NOT_FOUND" });
        return;
      }
      if (err instanceof DisputeInvalidStateError) {
        res.status(409).json({ error: err.message, code: "CONFLICT" });
        return;
      }
      console.error("DisputeAdmin resolve:", err);
      res.status(500).json({
        error: "Błąd serwera.",
        code: "INTERNAL_ERROR",
      });
    }
  }
}
