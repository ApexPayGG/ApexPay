import { describe, expect, it } from "vitest";
import { generateHash } from "../infra/autopay.js";
import { AutopayService } from "./autopay.service.js";

describe("AutopayService.parseItn", () => {
  it("parsuje base64 XML do AutopayItnData", async () => {
    process.env.AUTOPAY_SHARED_KEY = "testkey123";
    const hash = generateHash([
      "123456",
      "dep:user-1:1710000000000",
      "REMOTE-1",
      "35.50",
      "PLN",
      "SUCCESS",
    ]);
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<transactions>
  <transaction>
    <ServiceID>123456</ServiceID>
    <OrderID>dep:user-1:1710000000000</OrderID>
    <RemoteID>REMOTE-1</RemoteID>
    <Amount>35.50</Amount>
    <Currency>PLN</Currency>
    <PaymentStatus>SUCCESS</PaymentStatus>
    <Hash>${hash}</Hash>
    <CustomerHash>cust_hash_1</CustomerHash>
  </transaction>
</transactions>`;
    const encoded = Buffer.from(xml, "utf8").toString("base64");
    const service = new AutopayService();

    const out = await service.parseItn(encoded);
    expect(out).toEqual({
      ServiceID: "123456",
      OrderID: "dep:user-1:1710000000000",
      RemoteID: "REMOTE-1",
      Amount: "35.50",
      Currency: "PLN",
      PaymentStatus: "SUCCESS",
      Hash: hash,
      CustomerHash: "cust_hash_1",
    });
    expect(service.verifyItnHash(out)).toBe(true);
  });
});
