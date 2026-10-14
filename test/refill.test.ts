import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { logged } from "../src/export";
import { runRefill } from "../src/refill";
import { addSentences } from "./helpers";

const keyed = { ...env, DEEPSEEK_API_KEY: "k" };
const DAY = 86_400_000;
const reply = (o: unknown) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(o) } }] }));
const mock = (sentences: unknown[], bodies: string[] = []) => (async (_u: string, init: RequestInit) => { bodies.push(init.body as string); return reply({ sentences }); }) as unknown as typeof fetch;
const rows = async () => (await env.DB.prepare("SELECT english, english_key, source FROM sentences ORDER BY id").all<{ english: string; english_key: string; source: string }>()).results;

describe("refill", () => {
  it("missing key or >= 300 open: no call, no row", async () => {
    let calls = 0;
    const f = (async () => { calls++; return reply({ sentences: [] }); }) as unknown as typeof fetch;
    await logged(env, "refill", () => runRefill(env, f, 0));
    await env.DB.batch(Array.from({ length: 300 }, (_, i) => env.DB.prepare("INSERT INTO sentences (english, english_key, source) VALUES (?1, ?1, 't')").bind(`s${i}`)));
    await logged(keyed, "refill", () => runRefill(keyed, f, 0));
    expect(calls).toBe(0);
    expect((await env.DB.prepare("SELECT count(*) AS n FROM job_runs").first<{ n: number }>())!.n).toBe(0);
  });

  it("rotates topic by UTC day, validates, dedupes, normalises, logs", async () => {
    await addSentences("I Go home.");
    const bodies: string[] = [];
    const list = ["  We eat rice.  ", "we  EAT rice.", "i go HOME.", "", "x".repeat(121), "Visit https://x.com now", "I have 25 goats.", "I have 20 goats.", 5, "Cafe\u0301 is open."];
    await logged(keyed, "refill", () => runRefill(keyed, mock(list, bodies), 3 * DAY + 5));
    expect(bodies[0]).toContain('about \\"farming\\"'); // 3 -> index 3
    const r = await rows();
    expect(r.map((x) => x.english)).toEqual(["I Go home.", "We eat rice.", "I have 20 goats.", "Cafe\u0301 is open."]);
    expect(r[1]).toEqual({ english: "We eat rice.", english_key: "we eat rice.", source: "deepseek" });
    const j = await env.DB.prepare("SELECT ok, detail FROM job_runs WHERE job = 'refill'").all<{ ok: number; detail: string }>();
    expect(j.results).toEqual([{ ok: 1, detail: JSON.stringify({ topic: "farming", received: 10, inserted: 3 }) }]);
  });

  it("topic changes with the day", async () => {
    const bodies: string[] = [];
    await runRefill(keyed, mock([], bodies), 10 * DAY);
    await runRefill(keyed, mock([], bodies), 11 * DAY);
    expect(bodies[0]).toContain('about \\"home\\"');
    expect(bodies[1]).toContain('about \\"market\\"');
  });

  it("API error logs ok=0 without the key", async () => {
    const f = (async () => new Response("no", { status: 500 })) as unknown as typeof fetch;
    await logged(keyed, "refill", () => runRefill(keyed, f, 0));
    const j = await env.DB.prepare("SELECT ok, detail FROM job_runs").first<{ ok: number; detail: string }>();
    expect(j!.ok).toBe(0);
    expect(j!.detail).toContain("500");
    expect(j!.detail).not.toContain("Bearer");
  });
});
