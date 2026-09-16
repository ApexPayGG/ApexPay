import { describe, expect, it } from "vitest";
import { generateHash } from "../infra/autopay.js";
import { AutopayService } from "./autopay.service.js";

describe("AutopayService.verifyItnHash", () => {
  it("accepts the official Autopay ITN example (GatewayID+PaymentDate+PaymentStatusDetails)", async () => {
    process.env.AUTOPAY_SHARED_KEY = "1test1";
    process.env.AUTOPAY_SERVICE_ID = "1";
    process.env.AUTOPAY_GATEWAY_URL = "https://pay-accept.bm.pl";
    process.env.AUTOPAY_RETURN_URL = "https://shop.example/return";
    process.env.AUTOPAY_ITN_URL = "https://shop.example/itn";

    const officialHash = "a103bfe581a938e9ad78238cfc674ffafdd6ec70cb6825e7ed5c41787671efe4";
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<transactions>
  <transaction>
    <ServiceID>1</ServiceID>
    <OrderID>11</OrderID>
    <RemoteID>91</RemoteID>
    <Amount>11.11</Amount>
    <Currency>PLN</Currency>
    <GatewayID>1</GatewayID>
    <PaymentDate>20010101111111</PaymentDate>
    <PaymentStatus>SUCCESS</PaymentStatus>
    <PaymentStatusDetails>AUTHORIZED</PaymentStatusDetails>
    <Hash>${officialHash}</Hash>
  </transaction>
</transactions>`;
    const service = new AutopayService();
    const itn = await service.parseItn(Buffer.from(xml, "utf8").toString("base64"));
    expect(service.verifyItnHash(itn)).toBe(true);
  });

  it("rejects the official ITN payload when hashed with the truncated field list", () => {
    process.env.AUTOPAY_SHARED_KEY = "1test1";
    const truncated = generateHash(["1", "11", "91", "11.11", "PLN", "SUCCESS"]);
    expect(truncated).not.toBe(
      "a103bfe581a938e9ad78238cfc674ffafdd6ec70cb6825e7ed5c41787671efe4",
    );
  });
});

describe("AutopayService.createPaymentLink", () => {
  it("hashes start params in Autopay numbered order including Currency and ReturnURL", () => {
    process.env.AUTOPAY_SHARED_KEY = "key";
    process.env.AUTOPAY_SERVICE_ID = "2";
    process.env.AUTOPAY_GATEWAY_URL = "https://pay-accept.bm.pl";
    process.env.AUTOPAY_RETURN_URL = "https://return.example";
    process.env.AUTOPAY_ITN_URL = "https://api.example/itn";

    const service = new AutopayService();
    const url = service.createPaymentLink({
      orderId: "100",
      amount: "1.50",
      currency: "PLN",
      customerEmail: "user@test.pl",
      description: "Doładowanie",
    });
    const parsed = new URL(url);
    const sentHash = parsed.searchParams.get("Hash");
    const expected = generateHash([
      "2",
      "100",
      "1.50",
      "Doładowanie",
      "PLN",
      "user@test.pl",
      "https://return.example",
    ]);
    expect(sentHash).toBe(expected);
  });
});

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
