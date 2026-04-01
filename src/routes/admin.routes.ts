import { Router } from "express";
import type { AdminController } from "../controllers/admin.controller.js";

export function createAdminRouter(adminController: AdminController): Router {
  const router = Router();
  router.get("/transactions", (req, res) => {
    void adminController.listTransactions(req, res);
  });
  return router;
}
