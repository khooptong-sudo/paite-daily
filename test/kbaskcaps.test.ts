import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import "./helpers";
import { NOW } from "./helpers";
import { ask } from "../src/kbask";

const day = new Date(NOW).toISOString().slice(0, 10);
const keyed = { ...env, DEEPSEEK_API_KEY: "k" };
const none = (async () => new Response(JSON.stringify({ choices: [{ message: { content: '{"status":"none"}' } }] }))) as unknown as typeof fetch;
const counter = async (n: string) => (await env.WIKI.prepare("SELECT n FROM kb_counters WHERE name = ?1").bind(n).first<{ n: number }>())?.n ?? 0;

describe("ask daily caps", () => {
  it("a public ask refused by the public cap must not consume the shared daily cap (reviewers' 60 reserved)", async () => {
    const T = "What brings strength? Unity brings strength";
    const src = await env.WIKI.prepare("INSERT INTO kb_sources (kind, title, url, rights, trust, status, added_by, created_at, updated_at) VALUES ('book','B','https://example.org/b','quote-only',2,'approved','x',1,1) RETURNING id").first<{ id: number }>();
    await env.WIKI.prepare("INSERT INTO kb_chunks (source_id, ordinal, locator, text, sha256) VALUES (?1,1,'p. 1',?2,'x')").bind(src!.id, T).run();
    await env.WIKI.prepare("INSERT INTO kb_counters (name, n) VALUES (?1, 240), (?2, 299)").bind(`ask:dp:${day}`, `ask:d:${day}`).run();
    const pub = await ask(keyed, none, "What brings strength?", { via: "public", key: "ip:a" }, NOW);
    expect(pub.status).toBe("limited");
    expect(await counter(`ask:d:${day}`)).toBe(299); // refused request should not burn a slot
    const rev = await ask(keyed, none, "What brings unity strength?", { via: "review", key: "rev:a@example.org" }, NOW);
    expect(rev.status).not.toBe("limited"); // reserved reviewer capacity still available
  });

  it("a question that finds no passages (no model call) uses no daily slot", async () => {
    const a = await ask(keyed, none, "zzqx vvkj wwpl", { via: "public", key: "ip:a" }, NOW);
    expect(a.status).toBe("none");
    expect(await counter(`ask:d:${day}`)).toBe(0);
    expect(await counter(`ask:dp:${day}`)).toBe(0);
  });
});
