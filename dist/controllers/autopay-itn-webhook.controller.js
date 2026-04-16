import { PaymentMethodProvider } from "@prisma/client";
import { contextLogger } from "../lib/logger.js";
import { AutopayService } from "../services/autopay.service.js";
import { PaymentMethodDuplicateError } from "../services/payment-method.service.js";
import { WalletNotFoundError } from "../services/wallet.service.js";
const IDEMP_PREFIX = "idemp:autopay-itn:";
const IDEMP_TTL_SEC = 86_400;
function xmlEscape(s) {
    return s
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&apos;");
}
function confirmationXml(serviceId, orderId) {
    return `<?xml version="1.0" encoding="UTF-8"?><confirmationList><serviceID>${xmlEscape(serviceId)}</serviceID><transactionsConfirmations><transactionConfirmed><orderID>${xmlEscape(orderId)}</orderID><confirmation>CONFIRMED</confirmation></transactionConfirmed></transactionsConfirmations></confirmationList>`;
}
function errorXml(message) {
    return `<?xml version="1.0" encoding="UTF-8"?><error><message>${xmlEscape(message)}</message></error>`;
}
function userIdFromOrderId(orderId) {
    // expected: dep:{userId}:{timestamp}
    const parts = orderId.split(":");
    if (parts.length < 3 || parts[0] !== "dep" || parts[1] === undefined || parts[1].length === 0) {
        throw new RangeError("Invalid OrderID format");
    }
    return parts[1];
}
export class AutopayItnWebhookController {
    autopayService;
    walletService;
    paymentMethodService;
    redis;
    constructor(autopayService, walletService, paymentMethodService, redis) {
        this.autopayService = autopayService;
        this.walletService = walletService;
        this.paymentMethodService = paymentMethodService;
        this.redis = redis;
    }
    async handle(req, res) {
        try {
            const rawTransactions = req.body?.transactions;
            if (typeof rawTransactions !== "string" || rawTransactions.trim().length === 0) {
                res.status(200).type("application/xml").send(errorXml("Missing transactions"));
                return;
            }
            const itn = await this.autopayService.parseItn(rawTransactions);
            if (!this.autopayService.verifyItnHash(itn)) {
                contextLogger().warn({ orderId: itn.OrderID, remoteId: itn.RemoteID }, "Autopay ITN invalid hash");
                res.status(200).type("application/xml").send(errorXml("INVALID_HASH"));
                return;
            }
            const idempKey = `${IDEMP_PREFIX}${itn.OrderID}:${itn.RemoteID}`;
            const setOk = await this.redis.set(idempKey, "1", "EX", IDEMP_TTL_SEC, "NX");
            if (setOk !== "OK") {
                res.status(200).type("application/xml").send(confirmationXml(itn.ServiceID, itn.OrderID));
                return;
            }
            if (itn.PaymentStatus === "SUCCESS") {
                const userId = userIdFromOrderId(itn.OrderID);
                const amountMinor = Math.round(Number.parseFloat(itn.Amount) * 100);
                if (!Number.isFinite(amountMinor) || amountMinor <= 0) {
                    throw new RangeError("Invalid Amount");
                }
                await this.walletService.depositFundsPspWebhook(userId, BigInt(amountMinor), itn.RemoteID);
                if (itn.CustomerHash !== undefined && itn.CustomerHash.length > 0) {
                    try {
                        await this.paymentMethodService.createForUser(userId, {
                            provider: PaymentMethodProvider.AUTOPAY,
                            token: itn.CustomerHash,
                            type: "AUTOPAY_RECURRING",
                        });
                    }
                    catch (err) {
                        if (!(err instanceof PaymentMethodDuplicateError)) {
                            throw err;
                        }
                    }
                }
            }
            else if (itn.PaymentStatus === "PENDING") {
                contextLogger().info({ orderId: itn.OrderID, remoteId: itn.RemoteID }, "Autopay ITN pending");
            }
            else if (itn.PaymentStatus === "FAILURE") {
                contextLogger().warn({ orderId: itn.OrderID, remoteId: itn.RemoteID }, "Autopay ITN failure");
            }
            else {
                contextLogger().warn({ orderId: itn.OrderID, remoteId: itn.RemoteID, status: itn.PaymentStatus }, "Autopay ITN unknown status");
            }
            res.status(200).type("application/xml").send(confirmationXml(itn.ServiceID, itn.OrderID));
        }
        catch (err) {
            if (err instanceof WalletNotFoundError || err instanceof RangeError) {
                contextLogger().warn({ err: err.message }, "Autopay ITN invalid business payload");
                res.status(200).type("application/xml").send(errorXml("BAD_REQUEST"));
                return;
            }
            contextLogger().error({ err: err instanceof Error ? err.message : String(err) }, "Autopay ITN processing error");
            res.status(200).type("application/xml").send(errorXml("INTERNAL_ERROR"));
        }
    }
}
//# sourceMappingURL=autopay-itn-webhook.controller.js.map