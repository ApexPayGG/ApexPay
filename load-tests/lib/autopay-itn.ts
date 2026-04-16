import encoding from "k6/encoding";
import { sha256 } from "k6/crypto";

/**
 * Hash Autopay BM: SHA-256 z `field1|field2|...|SHARED_KEY` (hex lowercase) — jak `generateHash` w `src/infra/autopay.ts`.
 */
export function autopayBmHash(fields: string[], sharedKey: string): string {
  const base = [...fields.map((f) => f.trim()), sharedKey].join("|");
  return sha256(base, "hex");
}

export function buildItnXml(params: {
  serviceId: string;
  orderId: string;
  remoteId: string;
  amountMajor: string;
  currency: string;
  status: "SUCCESS" | "PENDING" | "FAILURE";
  sharedKey: string;
  customerHash?: string;
}): string {
  const hash = autopayBmHash(
    [
      params.serviceId,
      params.orderId,
      params.remoteId,
      params.amountMajor,
      params.currency,
      params.status,
    ],
    params.sharedKey,
  );
  const customerBlock =
    params.customerHash !== undefined && params.customerHash.length > 0
      ? `<CustomerHash>${params.customerHash}</CustomerHash>`
      : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<transactions>
  <transaction>
    <ServiceID>${params.serviceId}</ServiceID>
    <OrderID>${params.orderId}</OrderID>
    <RemoteID>${params.remoteId}</RemoteID>
    <Amount>${params.amountMajor}</Amount>
    <Currency>${params.currency}</Currency>
    <PaymentStatus>${params.status}</PaymentStatus>
    <Hash>${hash}</Hash>
    ${customerBlock}
  </transaction>
</transactions>`;
}

/** Body `application/x-www-form-urlencoded` dla POST /internal/webhooks/autopay-itn */
export function buildAutopayItnFormBody(xml: string): string {
  const b64 = encoding.b64encode(xml, "std");
  return `transactions=${encodeURIComponent(b64)}`;
}
