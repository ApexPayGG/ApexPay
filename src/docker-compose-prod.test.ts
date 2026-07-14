import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("docker-compose.prod.yml SkillGaming routing", () => {
  it("routes same-origin /api requests to the API and excludes them from the SPA", () => {
    const compose = readFileSync(
      new URL("../docker-compose.prod.yml", import.meta.url),
      "utf8",
    );

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
