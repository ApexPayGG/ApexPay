import type { Request, Response } from "express";
import { WebhookDeadLetterService } from "../services/webhook-dead-letter.service.js";
export declare class WebhookDeadLetterAdminController {
    private readonly service;
    constructor(service: WebhookDeadLetterService);
    list(req: Request, res: Response): Promise<void>;
    requeue(req: Request, res: Response): Promise<void>;
}
//# sourceMappingURL=webhook-dead-letter-admin.controller.d.ts.map