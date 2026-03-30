import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    env: {
      DATABASE_URL:
        process.env.DATABASE_URL ??
        "postgresql://test:test@127.0.0.1:5432/apexpay_vitest",
      JWT_SECRET: process.env.JWT_SECRET ?? "vitest-jwt-secret",
    },
  },
});
