import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("production compose routing guardrails", () => {
  it("routes SkillGaming /api traffic to the API instead of the SPA", () => {
    const compose = readFileSync("docker-compose.prod.yml", "utf8");

    expect(compose).toContain(
      "traefik.http.routers.api-skillgaming.rule=Host(`${SKILLGAMING_APP_DOMAIN:?set SKILLGAMING_APP_DOMAIN}`) && PathPrefix(`/api`)",
    );
    expect(compose).toContain("traefik.http.routers.api-skillgaming.service=api");
    expect(compose).toContain("API_SECRET_KEYS: ${API_SECRET_KEYS:-}");
    expect(compose).toContain("API_SECRET_KEY: ${API_SECRET_KEY:-}");
    expect(compose).toContain(
      "traefik.http.routers.skillgaming.rule=Host(`${SKILLGAMING_APP_DOMAIN:?set SKILLGAMING_APP_DOMAIN}`) && !PathPrefix(`/api`)",
    );
  });
});
