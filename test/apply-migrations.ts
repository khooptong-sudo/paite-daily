import { applyD1Migrations, env } from "cloudflare:test";
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
await applyD1Migrations(env.WIKI, env.TEST_WIKI_MIGRATIONS);
// Workers AI and Vectorize only exist remotely. Tests never use the real ones: a test that needs
// them passes in its own fakes (test/kbvec.test.ts), so every other test runs the keyword-only path.
delete (env as Partial<typeof env>).AI;
delete (env as Partial<typeof env>).WIKI_VECTORS;
