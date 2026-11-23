import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig(async () => {
  const migrations = await readD1Migrations("./migrations");
  const wikiMigrations = await readD1Migrations("./migrations-wiki");
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            TEST_WIKI_MIGRATIONS: wikiMigrations,
            WIKI_INGEST_TOKEN: "test-ingest-token-0123456789abcdef",
            SESSION_SECRET: "test-session-secret",
            TURNSTILE_SECRET: "unused-in-tests",
            GITHUB_TOKEN: "test-github-token",
            REVIEWERS: JSON.stringify({ "rev@example.org": "Rev One", "owner@example.org": "Owner" }),
            OWNER_EMAIL: "owner@example.org",
            // Live has the wiki public; tests start with it off and switch it on where they need it.
            WIKI_PUBLIC: "",
          },
        },
      }),
    ],
    // .claude holds worktree copies of the project; their tests are not this checkout's.
    test: { setupFiles: ["./test/apply-migrations.ts"], exclude: [...configDefaults.exclude, ".claude/**"] },
  };
});
