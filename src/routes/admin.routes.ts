import { Router } from "express";
import type { AdminController } from "../controllers/admin.controller.js";
import type { DisputeAdminController } from "../controllers/dispute-admin.controller.js";
import type { FraudAdminController } from "../controllers/fraud-admin.controller.js";
import type { WebhookDeadLetterAdminController } from "../controllers/webhook-dead-letter-admin.controller.js";
import type { AdminAnalyticsController } from "../controllers/admin-analytics.controller.js";

export function createAdminRouter(
  adminController: AdminController,
  disputeAdminController: DisputeAdminController,
  fraudAdminController: FraudAdminController,
  webhookDeadLetterAdminController: WebhookDeadLetterAdminController,
  adminAnalyticsController: AdminAnalyticsController,
): Router {
  const router = Router();
  router.get("/audit-logs", (req, res) => {
    void adminController.listAuditLogs(req, res);
  });
  router.get("/transactions", (req, res) => {
    void adminController.listTransactions(req, res);
  });
  router.post("/payouts/:id/settle", (req, res) => {
    void adminController.settlePayout(req, res);
  });
  router.get("/disputes", (req, res) => {
    void disputeAdminController.list(req, res);
  });
  router.get("/disputes/:id", (req, res) => {
    void disputeAdminController.getById(req, res);
  });
  router.post("/disputes/:id/evidence", (req, res) => {
    void disputeAdminController.submitEvidence(req, res);
  });
  router.post("/disputes/:id/resolve", (req, res) => {
    void disputeAdminController.resolve(req, res);
  });
  router.get("/fraud-checks", (req, res) => {
    void fraudAdminController.list(req, res);
  });
  router.get("/fraud-checks/:id", (req, res) => {
    void fraudAdminController.getById(req, res);
  });
  router.post("/fraud-checks/:id/review", (req, res) => {
    void fraudAdminController.review(req, res);
  });
  router.get("/webhook-dead-letters", (req, res) => {
    void webhookDeadLetterAdminController.list(req, res);
  });
  router.post("/webhook-dead-letters/:id/requeue", (req, res) => {
    void webhookDeadLetterAdminController.requeue(req, res);
  });
  router.get("/analytics/overview", (req, res) => {
    void adminAnalyticsController.overview(req, res);
  });
  router.get("/analytics/revenue-chart", (req, res) => {
    void adminAnalyticsController.revenueChart(req, res);
  });
  router.get("/analytics/fraud-chart", (req, res) => {
    void adminAnalyticsController.fraudChart(req, res);
  });
  router.get("/users-wallets", (req, res) => {
    void adminController.listUsersWithWallets(req, res);
  });
  return router;
}
