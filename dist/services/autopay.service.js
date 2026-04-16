import { parseStringPromise } from "xml2js";
import { getAutopayConfig, verifyHash, generateHash } from "../infra/autopay.js";
function deepFindByKey(obj, key) {
    if (obj === null || obj === undefined) {
        return undefined;
    }
    if (typeof obj !== "object") {
        return undefined;
    }
    const rec = obj;
    const val = rec[key];
    if (typeof val === "string" && val.trim().length > 0) {
        return val.trim();
    }
    for (const v of Object.values(rec)) {
        const nested = deepFindByKey(v, key);
        if (nested !== undefined) {
            return nested;
        }
    }
    return undefined;
}
export class AutopayService {
    createPaymentLink(params) {
        const cfg = getAutopayConfig();
        const description = params.description.trim().slice(0, 255);
        const hash = generateHash([
            cfg.serviceId,
            params.orderId,
            params.amount,
            description,
            params.customerEmail,
        ]);
        const q = new URLSearchParams();
        q.set("ServiceID", cfg.serviceId);
        q.set("OrderID", params.orderId);
        q.set("Amount", params.amount);
        q.set("Currency", params.currency);
        q.set("Description", description);
        q.set("CustomerEmail", params.customerEmail);
        q.set("ReturnURL", params.returnUrl?.trim() || cfg.returnUrl);
        q.set("ITNURL", cfg.itnUrl);
        q.set("Hash", hash);
        const base = cfg.gatewayUrl.replace(/\/+$/, "");
        return `${base}?${q.toString()}`;
    }
    async parseItn(base64Xml) {
        const xml = Buffer.from(base64Xml.trim(), "base64").toString("utf8");
        const parsed = await parseStringPromise(xml, {
            explicitArray: false,
            trim: true,
        });
        const out = {
            ServiceID: deepFindByKey(parsed, "ServiceID") ?? "",
            OrderID: deepFindByKey(parsed, "OrderID") ?? "",
            RemoteID: deepFindByKey(parsed, "RemoteID") ?? "",
            Amount: deepFindByKey(parsed, "Amount") ?? "",
            Currency: deepFindByKey(parsed, "Currency") ?? "",
            PaymentStatus: deepFindByKey(parsed, "PaymentStatus") ?? "",
            Hash: deepFindByKey(parsed, "Hash") ?? "",
        };
        const customerHash = deepFindByKey(parsed, "CustomerHash");
        if (customerHash !== undefined && customerHash.length > 0) {
            out.CustomerHash = customerHash;
        }
        if (out.ServiceID.length === 0 ||
            out.OrderID.length === 0 ||
            out.RemoteID.length === 0 ||
            out.Amount.length === 0 ||
            out.Currency.length === 0 ||
            out.PaymentStatus.length === 0 ||
            out.Hash.length === 0) {
            throw new RangeError("Invalid Autopay ITN payload");
        }
        return out;
    }
    verifyItnHash(itn) {
        return verifyHash([
            itn.ServiceID,
            itn.OrderID,
            itn.RemoteID,
            itn.Amount,
            itn.Currency,
            itn.PaymentStatus,
        ], itn.Hash);
    }
}
//# sourceMappingURL=autopay.service.js.map