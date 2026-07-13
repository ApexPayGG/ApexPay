import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("production compose routing", () => {
  const compose = readFileSync(resolve(process.cwd(), "docker-compose.prod.yml"), "utf8");

  it("routes SkillGaming same-host /api requests to the API service", () => {
    expect(compose).toContain(
      "traefik.http.routers.api-skillgaming.rule=Host(`${SKILLGAMING_APP_DOMAIN:?set SKILLGAMING_APP_DOMAIN}`) && PathPrefix(`/api`)",
    );
    expect(compose).toContain("traefik.http.routers.api-skillgaming.service=api");
    expect(compose).toContain("traefik.http.routers.api-skillgaming.priority=100");
    expect(compose).toContain(
      "traefik.http.routers.skillgaming.rule=Host(`${SKILLGAMING_APP_DOMAIN:?set SKILLGAMING_APP_DOMAIN}`) && !PathPrefix(`/api`)",
    );
    expect(compose).toContain("traefik.http.routers.skillgaming.priority=1");
  });
});
