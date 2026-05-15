import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("docker-compose.prod.yml SkillGaming routing", () => {
  it("routes SkillGaming /api requests to the API service before the SPA", () => {
    const compose = readFileSync(resolve("docker-compose.prod.yml"), "utf8");

    expect(compose).toContain(
      "traefik.http.routers.skillgaming-api-inapp.rule=Host(`${SKILLGAMING_APP_DOMAIN:?set SKILLGAMING_APP_DOMAIN}`) && PathPrefix(`/api`)",
    );
    expect(compose).toContain("traefik.http.routers.skillgaming-api-inapp.service=api");
    expect(compose).toContain("traefik.http.routers.skillgaming-api-inapp.priority=100");
    expect(compose).toContain(
      "traefik.http.routers.skillgaming.rule=Host(`${SKILLGAMING_APP_DOMAIN:?set SKILLGAMING_APP_DOMAIN}`) && !PathPrefix(`/api`)",
    );
  });
});
