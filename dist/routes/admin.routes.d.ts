import { Router } from "express";
import type { AdminController } from "../controllers/admin.controller.js";
import type { DisputeAdminController } from "../controllers/dispute-admin.controller.js";
import type { FraudAdminController } from "../controllers/fraud-admin.controller.js";
import type { WebhookDeadLetterAdminController } from "../controllers/webhook-dead-letter-admin.controller.js";
export declare function createAdminRouter(adminController: AdminController, disputeAdminController: DisputeAdminController, fraudAdminController: FraudAdminController, webhookDeadLetterAdminController: WebhookDeadLetterAdminController): Router;
//# sourceMappingURL=admin.routes.d.ts.map