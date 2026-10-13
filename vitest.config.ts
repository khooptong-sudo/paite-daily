import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
  const migrations = await readD1Migrations("./migrations");
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            SESSION_SECRET: "test-session-secret",
            TURNSTILE_SECRET: "unused-in-tests",
            GITHUB_TOKEN: "test-github-token",
            REVIEWERS: JSON.stringify({ "rev@example.org": "Rev One", "owner@example.org": "Owner" }),
            OWNER_EMAIL: "owner@example.org",
          },
        },
      }),
    ],
    test: { setupFiles: ["./test/apply-migrations.ts"] },
  };
});
