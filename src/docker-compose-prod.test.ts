import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("docker-compose.prod.yml SkillGaming routing", () => {
  const compose = readFileSync(resolve(process.cwd(), "docker-compose.prod.yml"), "utf8");

  it("routes SkillGaming same-origin /api requests to the API service before the SPA", () => {
    expect(compose).toContain(
      "traefik.http.routers.api-skillgaming-inapp.rule=Host(`${SKILLGAMING_APP_DOMAIN:?set SKILLGAMING_APP_DOMAIN}`) && PathPrefix(`/api`)",
    );
    expect(compose).toContain("traefik.http.routers.api-skillgaming-inapp.service=api");
    expect(compose).toContain("traefik.http.routers.api-skillgaming-inapp.priority=100");
    expect(compose).toContain(
      "traefik.http.routers.skillgaming.rule=Host(`${SKILLGAMING_APP_DOMAIN:?set SKILLGAMING_APP_DOMAIN}`) && !PathPrefix(`/api`)",
    );
  });
});
