import { check, sleep } from "k6";
import { Trend } from "k6/metrics";
import { defaultThresholds, getAdminEmail, getAdminPassword, getBaseUrl } from "../config";
import {
  adminLogin,
  bootstrapMarketplaceIntegrator,
  postIntegrationCharge,
  prewarmIntegrationCharges,
} from "../lib/client";

const chargeDuration = new Trend("charge_duration");

export const options = {
  scenarios: {
    fraud_mix: {
      executor: "constant-vus",
      vus: 50,
      duration: "2m",
    },
  },
  thresholds: defaultThresholds.fraud,
};

type Setup = {
  baseUrl: string;
  cold: { apiKey: string; connectedAccountId: string };
  hot: { apiKey: string; connectedAccountId: string };
};

export function setup(): Setup {
  const baseUrl = getBaseUrl();
  const adminJwt = adminLogin(baseUrl, getAdminEmail(), getAdminPassword());
  const cold = bootstrapMarketplaceIntegrator(adminJwt, "cold");
  const hot = bootstrapMarketplaceIntegrator(adminJwt, "hot");
  prewarmIntegrationCharges(hot.apiKey, hot.connectedAccountId, 15, "vel");
  return {
    baseUrl,
    cold: { apiKey: cold.apiKey, connectedAccountId: cold.connectedAccountId },
    hot: { apiKey: hot.apiKey, connectedAccountId: hot.connectedAccountId },
  };
}

export default function (data: Setup): void {
  const fraudPath = Math.random() < 0.2;
  const ctx = fraudPath ? data.hot : data.cold;
  const idem = `fraud-${fraudPath ? "h" : "c"}-vu${__VU}-it${__ITER}-${Date.now()}`;
  const res = postIntegrationCharge(data.baseUrl, ctx.apiKey, idem, ctx.connectedAccountId, 200, 100);
  chargeDuration.add(res.timings.duration);
  check(res, {
    "charge no 5xx": (r) => r.status < 500,
    "charge business response": (r) =>
      r.status === 201 || r.status === 402 || r.status === 422 || r.status === 429,
  });
  sleep(0.05);
}
