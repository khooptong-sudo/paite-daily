import { env } from "cloudflare:test";
import { expect, it } from "vitest";

it("creates every table", async () => {
  const { results } = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all<{ name: string }>();
  const names = results.map((r) => r.name);
  for (const t of ["answers", "exports", "job_runs", "locks", "reviews", "seen", "sentences"]) expect(names).toContain(t);
});

it("rejects an unknown sentence status", async () => {
  await expect(
    env.DB.prepare("INSERT INTO sentences (english, english_key, source, status) VALUES ('a', 'a', 'x', 'bogus')").run(),
  ).rejects.toThrow();
});
