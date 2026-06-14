import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function readProdCompose(): Promise<string> {
  return readFile(resolve(repoRoot, "docker-compose.prod.yml"), "utf8");
}

describe("production compose routing", () => {
  it("routes SkillGaming /api requests to the API service before the SPA", async () => {
    const compose = await readProdCompose();

    expect(compose).toContain(
      "traefik.http.routers.api-skillgaming.rule=Host(`${SKILLGAMING_APP_DOMAIN:?set SKILLGAMING_APP_DOMAIN}`) && PathPrefix(`/api`)",
    );
    expect(compose).toContain("traefik.http.routers.api-skillgaming.service=api");
    expect(compose).toContain("traefik.http.routers.api-skillgaming.priority=100");
    expect(compose).toContain(
      "traefik.http.routers.skillgaming.rule=Host(`${SKILLGAMING_APP_DOMAIN:?set SKILLGAMING_APP_DOMAIN}`) && !PathPrefix(`/api`)",
    );
  });

  it("passes HMAC secrets into the API container for protected v1 routes", async () => {
    const compose = await readProdCompose();

    expect(compose).toContain("API_SECRET_KEYS: ${API_SECRET_KEYS:?set API_SECRET_KEYS}");
  });
});
