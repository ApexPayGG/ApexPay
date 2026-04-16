import type { Request, Response } from "express";
import { z, ZodError } from "zod";
import {
  ApiKeyNotFoundError,
  ApiKeyService,
} from "../services/api-key.service.js";
import { decodeCursor, parsePaginationLimit } from "../lib/pagination.js";

const createBodySchema = z
  .object({
    name: z.string().trim().min(1).max(128),
    expiresAt: z.string().datetime().optional(),
  })
  .strict();

export class ApiKeyController {
  constructor(private readonly apiKeyService: ApiKeyService) {}

  /** Lista kluczy zalogowanego użytkownika — JWT. */
  async list(req: Request, res: Response): Promise<void> {
    const userId = req.user?.id?.trim();
    if (userId === undefined || userId.length === 0) {
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
      const { items, nextCursor } = await this.apiKeyService.listForUser(
        userId,
        cursorStr === undefined ? { limit } : { limit, cursor: cursorStr },
      );
      res.status(200).json({ status: "success", data: { items, nextCursor } });
    } catch (err) {
      console.error("[api-keys] list:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  }

  /** Tworzenie klucza — wymaga JWT (konto integratora). */
  async create(req: Request, res: Response): Promise<void> {
    const userId = req.user?.id?.trim();
    if (userId === undefined || userId.length === 0) {
      res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
      return;
    }

    try {
      const body = createBodySchema.parse(req.body);
      const { fullKeyPlaintext, record } = await this.apiKeyService.createKey(
        userId,
        body.name,
        {
          expiresAt: body.expiresAt !== undefined ? new Date(body.expiresAt) : null,
          request: req,
        },
      );

      res.status(201).json({
        status: "success",
        data: {
          ...record,
          /** Pełny klucz — tylko w tej odpowiedzi. */
          key: fullKeyPlaintext,
          warning: "Zapisz klucz w menedżerze sekretów — nie będzie ponownie wyświetlony.",
        },
      });
    } catch (err) {
      if (err instanceof ZodError) {
        res.status(400).json({ error: "Nieprawidłowe dane.", code: "BAD_REQUEST" });
        return;
      }
      if (err instanceof RangeError) {
        res.status(400).json({ error: err.message, code: "BAD_REQUEST" });
        return;
      }
      console.error("[api-keys] create:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  }

  /** Usunięcie klucza — JWT; audyt API_KEY_DELETED. */
  async deleteById(req: Request, res: Response): Promise<void> {
    const userId = req.user?.id?.trim();
    if (userId === undefined || userId.length === 0) {
      res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
      return;
    }

    const id = typeof req.params.id === "string" ? req.params.id.trim() : "";
    if (id.length === 0) {
      res.status(400).json({ error: "Brak identyfikatora klucza.", code: "BAD_REQUEST" });
      return;
    }

    try {
      await this.apiKeyService.deleteKey(userId, id, req);
      res.status(204).send();
    } catch (err) {
      if (err instanceof ApiKeyNotFoundError) {
        res.status(404).json({ error: err.message, code: "NOT_FOUND" });
        return;
      }
      if (err instanceof RangeError) {
        res.status(400).json({ error: err.message, code: "BAD_REQUEST" });
        return;
      }
      console.error("[api-keys] delete:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  }

  /** Profil wyłącznie po kluczu API (middleware `apiKeyAuth`). */
  async integrationsMe(req: Request, res: Response): Promise<void> {
    const userId = req.user?.id?.trim();
    const role = req.user?.role;
    if (userId === undefined || userId.length === 0) {
      res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
      return;
    }

    res.status(200).json({
      status: "success",
      data: { userId, role },
    });
  }
}
