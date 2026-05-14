import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const compose = readFileSync(new URL("../docker-compose.prod.yml", import.meta.url), "utf8");

describe("docker-compose.prod.yml routing", () => {
  it("routes SkillGaming /api requests to the API service", () => {
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
