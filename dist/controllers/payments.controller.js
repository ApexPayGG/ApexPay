import { z, ZodError } from "zod";
import { AutopayService } from "../services/autopay.service.js";
const bodySchema = z
    .object({
    amount: z.number().int().positive(),
    currency: z.string().trim().min(1).max(8).default("PLN"),
    description: z.string().trim().min(1).max(255),
})
    .strict();
export class PaymentsController {
    autopayService;
    prisma;
    constructor(autopayService, prisma) {
        this.autopayService = autopayService;
        this.prisma = prisma;
    }
    async initiate(req, res) {
        const userId = req.user?.id?.trim();
        if (userId === undefined || userId.length === 0) {
            res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
            return;
        }
        try {
            const body = bodySchema.parse(req.body);
            const amountMajor = (body.amount / 100).toFixed(2);
            const orderId = `dep:${userId}:${Date.now()}`;
            const user = await this.prisma.user.findUnique({
                where: { id: userId },
                select: { email: true },
            });
            if (user === null) {
                res.status(404).json({ error: "User not found", code: "NOT_FOUND" });
                return;
            }
            const paymentUrl = this.autopayService.createPaymentLink({
                orderId,
                amount: amountMajor,
                currency: body.currency.toUpperCase(),
                customerEmail: user.email,
                description: body.description,
            });
            res.status(200).json({
                status: "success",
                data: { paymentUrl, orderId },
            });
        }
        catch (err) {
            if (err instanceof ZodError || err instanceof RangeError) {
                res.status(400).json({ error: "Nieprawidłowe dane.", code: "BAD_REQUEST" });
                return;
            }
            console.error("[payments/initiate]", err);
            res.status(500).json({ error: "Internal server error" });
        }
    }
}
//# sourceMappingURL=payments.controller.js.map