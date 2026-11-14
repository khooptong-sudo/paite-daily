import { applyD1Migrations, env } from "cloudflare:test";
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
await applyD1Migrations(env.WIKI, env.TEST_WIKI_MIGRATIONS);
