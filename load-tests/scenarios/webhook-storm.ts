import { check } from "k6";
import { Counter, Rate } from "k6/metrics";
import { getAutopayServiceId, getAutopaySharedKey, getBaseUrl, LOAD_PASSWORD } from "../config";
import {
  getWalletBalanceString,
  itnSuccessXml,
  loginUser,
  postAutopayItn,
  registerUser,
  uniqueEmail,
} from "../lib/client";

const itnOk = new Rate("itn_ok");
const http5xx = new Counter("http_5xx");

export const options = {
  scenarios: {
    storm: {
      executor: "constant-vus",
      vus: 200,
      duration: "1m",
    },
  },
  thresholds: {
    itn_ok: ["rate>0.99"],
    http_5xx: ["count<1"],
  },
};

type Setup = {
  baseUrl: string;
  passengerJwt: string;
  passengerUserId: string;
  serviceId: string;
  sharedKey: string;
};

export function setup(): Setup {
  const baseUrl = getBaseUrl();
  const serviceId = getAutopayServiceId();
  const sharedKey = getAutopaySharedKey();
  const email = uniqueEmail("storm-pass");
  registerUser(baseUrl, email, LOAD_PASSWORD);
  const session = loginUser(baseUrl, email, LOAD_PASSWORD);
  return {
    baseUrl,
    passengerJwt: session.jwt,
    passengerUserId: session.userId,
    serviceId,
    sharedKey,
  };
}

function recordItn(res: { status: number }): void {
  itnOk.add(res.status === 200);
  if (res.status >= 500) {
    http5xx.add(1);
  }
}

export default function (data: Setup): void {
  const uid = data.passengerUserId;
  const ts = Date.now();

  for (let i = 0; i < 10; i++) {
    const orderId = `dep:${uid}:storm-${__VU}-${__ITER}-${i}-${ts}`;
    const remoteId = `rem-${__VU}-${__ITER}-${i}-${ts}`;
    const xml = itnSuccessXml({
      serviceId: data.serviceId,
      sharedKey: data.sharedKey,
      orderId,
      remoteId,
      amountMajor: "1.00",
      currency: "PLN",
    });
    const res = postAutopayItn(data.baseUrl, xml);
    recordItn(res);
    check(res, { "storm itn 200": (r) => r.status === 200 });
  }

  const dupOrder = `dep:${uid}:storm-dup-${__VU}-${ts}`;
  const dupRemote = `rem-dup-${__VU}-${ts}`;
  const dupXml = itnSuccessXml({
    serviceId: data.serviceId,
    sharedKey: data.sharedKey,
    orderId: dupOrder,
    remoteId: dupRemote,
    amountMajor: "1.00",
    currency: "PLN",
  });

  const balBefore = Number.parseInt(getWalletBalanceString(data.baseUrl, data.passengerJwt), 10);
  const r1 = postAutopayItn(data.baseUrl, dupXml);
  recordItn(r1);
  const r2 = postAutopayItn(data.baseUrl, dupXml);
  recordItn(r2);
  check(r1, { "dup first 200": (r) => r.status === 200 });
  check(r2, { "dup second 200": (r) => r.status === 200 });
  const balAfter = Number.parseInt(getWalletBalanceString(data.baseUrl, data.passengerJwt), 10);
  check(balAfter - balBefore, {
    "idempotency: single1 PLN credit (100 gr)": (d) => d === 100,
  });
}
