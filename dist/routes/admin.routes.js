import { Router } from "express";
export function createAdminRouter(adminController) {
    const router = Router();
    router.get("/transactions", (req, res) => {
        void adminController.listTransactions(req, res);
    });
    return router;
}
//# sourceMappingURL=admin.routes.js.map