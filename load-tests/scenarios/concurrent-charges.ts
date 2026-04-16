import { check, sleep } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";
import { defaultThresholds, getAdminEmail, getAdminPassword, getBaseUrl } from "../config";
import { adminLogin, bootstrapMarketplaceIntegrator, postIntegrationCharge } from "../lib/client";

const chargeDuration = new Trend("charge_duration");
const errors5xx = new Rate("errors_5xx");
const saw429 = new Counter("saw_429");

export const options = {
  scenarios: {
    marketplace_ramp: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "1m", target: 50 },
        { duration: "1m", target: 200 },
        { duration: "1m", target: 500 },
        { duration: "1m", target: 200 },
        { duration: "1m", target: 0 },
      ],
      gracefulRampDown: "30s",
    },
  },
  thresholds: {
    charge_duration: defaultThresholds.concurrentCharges.charge_duration,
    errors_5xx: ["rate<0.001"],
    saw_429: defaultThresholds.concurrentCharges.saw_429,
  },
};

type Setup = {
  baseUrl: string;
  apiKey: string;
  connectedAccountId: string;
};

export function setup(): Setup {
  const baseUrl = getBaseUrl();
  const adminJwt = adminLogin(baseUrl, getAdminEmail(), getAdminPassword());
  const int = bootstrapMarketplaceIntegrator(adminJwt, "conc");
  return {
    baseUrl,
    apiKey: int.apiKey,
    connectedAccountId: int.connectedAccountId,
  };
}

export default function (data: Setup): void {
  const idem = `idem-vu${__VU}-it${__ITER}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const res = postIntegrationCharge(data.baseUrl, data.apiKey, idem, data.connectedAccountId, 100, 50);
  chargeDuration.add(res.timings.duration);
  const s = res.status;
  if (s === 429) {
    saw429.add(1);
  }
  errors5xx.add(s >= 500);
  check(res, {
    "charge 2xx/4xx (no 5xx)": (r) => r.status < 500,
    "charge allowed status": (r) => r.status === 200 || r.status === 201 || r.status === 429 || r.status === 402,
  });
  sleep(0.01);
}
