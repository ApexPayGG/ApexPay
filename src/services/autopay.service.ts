import { parseStringPromise } from "xml2js";
import {
  getAutopayConfig,
  verifyHash,
  generateHash,
  compactHashFields,
} from "../infra/autopay.js";

export type CreateAutopayPaymentLinkParams = {
  orderId: string;
  amount: string;
  currency: string;
  customerEmail: string;
  description: string;
  returnUrl?: string;
};

export type AutopayItnData = {
  ServiceID: string;
  OrderID: string;
  RemoteID: string;
  Amount: string;
  Currency: string;
  PaymentStatus: string;
  Hash: string;
  GatewayID?: string;
  PaymentDate?: string;
  PaymentStatusDetails?: string;
  CustomerHash?: string;
};

function deepFindByKey(obj: unknown, key: string): string | undefined {
  if (obj === null || obj === undefined) {
    return undefined;
  }
  if (typeof obj !== "object") {
    return undefined;
  }
  const rec = obj as Record<string, unknown>;
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
  createPaymentLink(params: CreateAutopayPaymentLinkParams): string {
    const cfg = getAutopayConfig();
    const description = params.description.trim().slice(0, 79);
    const returnUrl = params.returnUrl?.trim() || cfg.returnUrl;
    // Autopay start hash numbering: ServiceID, OrderID, Amount, Description,
    // GatewayID (omitted), Currency, CustomerEmail, …, ReturnURL.
    const hash = generateHash(
      compactHashFields([
        cfg.serviceId,
        params.orderId,
        params.amount,
        description,
        params.currency,
        params.customerEmail,
        returnUrl,
      ]),
    );

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

  async parseItn(base64Xml: string): Promise<AutopayItnData> {
    const xml = Buffer.from(base64Xml.trim(), "base64").toString("utf8");
    const parsed = await parseStringPromise(xml, {
      explicitArray: false,
      trim: true,
    });

    const out: AutopayItnData = {
      ServiceID: deepFindByKey(parsed, "ServiceID") ?? "",
      OrderID: deepFindByKey(parsed, "OrderID") ?? "",
      RemoteID: deepFindByKey(parsed, "RemoteID") ?? "",
      Amount: deepFindByKey(parsed, "Amount") ?? "",
      Currency: deepFindByKey(parsed, "Currency") ?? "",
      PaymentStatus: deepFindByKey(parsed, "PaymentStatus") ?? "",
      Hash: deepFindByKey(parsed, "Hash") ?? "",
    };
    const gatewayId = deepFindByKey(parsed, "GatewayID");
    if (gatewayId !== undefined && gatewayId.length > 0) {
      out.GatewayID = gatewayId;
    }
    const paymentDate = deepFindByKey(parsed, "PaymentDate");
    if (paymentDate !== undefined && paymentDate.length > 0) {
      out.PaymentDate = paymentDate;
    }
    const paymentStatusDetails = deepFindByKey(parsed, "PaymentStatusDetails");
    if (paymentStatusDetails !== undefined && paymentStatusDetails.length > 0) {
      out.PaymentStatusDetails = paymentStatusDetails;
    }
    const customerHash = deepFindByKey(parsed, "CustomerHash");
    if (customerHash !== undefined && customerHash.length > 0) {
      out.CustomerHash = customerHash;
    }

    if (
      out.ServiceID.length === 0 ||
      out.OrderID.length === 0 ||
      out.RemoteID.length === 0 ||
      out.Amount.length === 0 ||
      out.Currency.length === 0 ||
      out.PaymentStatus.length === 0 ||
      out.Hash.length === 0
    ) {
      throw new RangeError("Invalid Autopay ITN payload");
    }
    return out;
  }

  verifyItnHash(itn: AutopayItnData): boolean {
    // Official Autopay ITN hash order (empty optionals skipped):
    // ServiceID|OrderID|RemoteID|Amount|Currency|GatewayID|PaymentDate|
    // PaymentStatus|PaymentStatusDetails|SHARED_KEY
    return verifyHash(
      compactHashFields([
        itn.ServiceID,
        itn.OrderID,
        itn.RemoteID,
        itn.Amount,
        itn.Currency,
        itn.GatewayID,
        itn.PaymentDate,
        itn.PaymentStatus,
        itn.PaymentStatusDetails,
      ]),
      itn.Hash,
    );
  }
}
