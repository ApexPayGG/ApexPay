import { check, sleep } from "k6";
import { defaultThresholds, getAutopayServiceId, getAutopaySharedKey, getBaseUrl, LOAD_PASSWORD } from "../config";
import {
  createApiKeyForUser,
  getIntegratorCharges,
  itnSuccessXml,
  loginUser,
  postAutopayItn,
  postPaymentsInitiate,
  registerUser,
  uniqueEmail,
} from "../lib/client";

export const options = {
  scenarios: {
    taxi_payment: {
      executor: "constant-vus",
      vus: 100,
      duration: "2m",
    },
  },
  thresholds: defaultThresholds.paymentFlow,
};

type SetupData = {
  baseUrl: string;
  passengerJwt: string;
  initiateAmountCents: number;
  integratorApiKey: string;
  serviceId: string;
  sharedKey: string;
};

export function setup(): SetupData {
  const baseUrl = getBaseUrl();
  const serviceId = getAutopayServiceId();
  const sharedKey = getAutopaySharedKey();

  const passengerEmail = uniqueEmail("passenger");
  registerUser(baseUrl, passengerEmail, LOAD_PASSWORD);
  const passenger = loginUser(baseUrl, passengerEmail, LOAD_PASSWORD);

  const intEmail = uniqueEmail("integrator");
  registerUser(baseUrl, intEmail, LOAD_PASSWORD);
  const integrator = loginUser(baseUrl, intEmail, LOAD_PASSWORD);
  const integratorApiKey = createApiKeyForUser(baseUrl, integrator.jwt, `payflow-${Date.now()}`);

  const initiateAmountCents = 2500;

  return {
    baseUrl,
    passengerJwt: passenger.jwt,
    initiateAmountCents,
    integratorApiKey,
    serviceId,
    sharedKey,
  };
}

export default function (data: SetupData): void {
  const desc = `Load ride ${__VU}-${__ITER}`;
  const initRes = postPaymentsInitiate(data.baseUrl, data.passengerJwt, data.initiateAmountCents, desc);
  const initOk = check(initRes, {
    "initiate 200": (r) => r.status === 200,
  });
  if (!initOk || initRes.status !== 200) {
    return;
  }
  const body = JSON.parse(initRes.body as string) as { data?: { orderId?: string } };
  const orderId = body.data?.orderId;
  if (typeof orderId !== "string" || orderId.length === 0) {
    return;
  }
  const amountMajor = (data.initiateAmountCents / 100).toFixed(2);
  const remoteId = `itn-${__VU}-${__ITER}-${Date.now()}`;
  const xml = itnSuccessXml({
    serviceId: data.serviceId,
    sharedKey: data.sharedKey,
    orderId,
    remoteId,
    amountMajor,
    currency: "PLN",
  });
  const itnRes = postAutopayItn(data.baseUrl, xml);
  check(itnRes, {
    "itn 200": (r) => r.status === 200,
    "itn confirmed": (r) =>
      typeof r.body === "string" && r.body.includes("<confirmation>CONFIRMED</confirmation>"),
  });

  const listRes = getIntegratorCharges(data.baseUrl, data.integratorApiKey);
  check(listRes, {
    "charges list 200": (r) => r.status === 200,
  });

  sleep(0.05);
}
