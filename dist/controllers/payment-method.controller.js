import { ZodError } from "zod";
import { PaymentMethodDuplicateError, PaymentMethodService, toPublicPaymentMethod, } from "../services/payment-method.service.js";
export class PaymentMethodController {
    service;
    constructor(service) {
        this.service = service;
    }
    async create(req, res) {
        const userId = req.user?.id?.trim();
        if (userId === undefined || userId.length === 0) {
            res.status(401).json({ error: "Unauthorized" });
            return;
        }
        try {
            const body = this.service.parseCreateBody(req.body);
            const created = await this.service.createForUser(userId, body);
            res.status(201).json({ status: "success", data: toPublicPaymentMethod(created) });
        }
        catch (err) {
            if (err instanceof ZodError) {
                res.status(400).json({ error: "Nieprawidłowe dane wejściowe.", code: "BAD_REQUEST" });
                return;
            }
            if (err instanceof PaymentMethodDuplicateError) {
                res.status(409).json({ error: err.message, code: "CONFLICT" });
                return;
            }
            console.error("[payment-methods] create:", err);
            res.status(500).json({ error: "Internal server error" });
        }
    }
    async list(req, res) {
        const userId = req.user?.id?.trim();
        if (userId === undefined || userId.length === 0) {
            res.status(401).json({ error: "Unauthorized" });
            return;
        }
        try {
            const items = await this.service.listForUser(userId);
            res.status(200).json({
                status: "success",
                data: items.map((pm) => toPublicPaymentMethod(pm)),
            });
        }
        catch (err) {
            console.error("[payment-methods] list:", err);
            res.status(500).json({ error: "Internal server error" });
        }
    }
}
//# sourceMappingURL=payment-method.controller.js.map