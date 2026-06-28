import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const compose = readFileSync(
  new URL("../docker-compose.prod.yml", import.meta.url),
  "utf8",
);

describe("docker-compose.prod.yml", () => {
  it("requires API HMAC secrets for production-protected v1 routes", () => {
    expect(compose).toContain("API_SECRET_KEYS: ${API_SECRET_KEYS:?set API_SECRET_KEYS}");
  });

  it("routes SkillGaming /api traffic to the API service instead of the SPA", () => {
    expect(compose).toContain(
      "traefik.http.routers.api-skillgaming.rule=Host(`${SKILLGAMING_APP_DOMAIN:?set SKILLGAMING_APP_DOMAIN}`) && PathPrefix(`/api`)",
    );
    expect(compose).toContain("traefik.http.routers.api-skillgaming.service=api");
    expect(compose).toContain("traefik.http.routers.api-skillgaming.priority=100");
    expect(compose).toContain(
      "traefik.http.routers.skillgaming.rule=Host(`${SKILLGAMING_APP_DOMAIN:?set SKILLGAMING_APP_DOMAIN}`) && !PathPrefix(`/api`)",
    );
  });
});
