import { env } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/index";
import { logged } from "../src/export";
import { acquireRefillLock, FORCED_PER_DAY, lockedRefill, refillOnDemand, runRefill, TOPICS } from "../src/refill";
import { addSentences, fakeDeps, PHONE_A, PHONE_B, session } from "./helpers";

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

  it("uses the given topic, validates, dedupes, normalises, logs", async () => {
    await addSentences("I Go home.");
    const bodies: string[] = [];
    const list = ["  We eat rice.  ", "we  EAT rice.", "i go HOME.", "", "x".repeat(121), "Visit https://x.com now", "I have 25 goats.", "I have 20 goats.", 5, "Cafe\u0301 is open."];
    await logged(keyed, "refill", () => runRefill(keyed, mock(list, bodies), 3 * DAY + 5, "farming"));
    expect(bodies[0]).toContain('about \\"farming\\"');
    const r = await rows();
    expect(r.map((x) => x.english)).toEqual(["I Go home.", "We eat rice.", "I have 20 goats.", "Cafe\u0301 is open."]);
    expect(r[1]).toEqual({ english: "We eat rice.", english_key: "we eat rice.", source: "deepseek" });
    const j = await env.DB.prepare("SELECT ok, detail FROM job_runs WHERE job = 'refill'").all<{ ok: number; detail: string }>();
    expect(j.results).toEqual([{ ok: 1, detail: JSON.stringify({ topic: "farming", received: 10, inserted: 3 }) }]);
  });

  it("topic is chosen per call", async () => {
    const bodies: string[] = [];
    // Each call draws twice: gap words or a theme (0.9 = theme), then which theme.
    const spy = vi.spyOn(Math, "random").mockReturnValueOnce(0.9).mockReturnValueOnce(0).mockReturnValueOnce(0.9).mockReturnValueOnce(0.99);
    await runRefill(keyed, mock([], bodies), 10 * DAY);
    await runRefill(keyed, mock([], bodies), 10 * DAY);
    spy.mockRestore();
    expect(bodies[0]).toContain('about \\"home\\"');
    expect(bodies[1]).toContain('about \\"the road and transport\\"');
    expect(TOPICS).toHaveLength(30);
  });

  it("every other unthemed refill asks for the common words with no verified example", async () => {
    const bodies: string[] = [];
    const spy = vi.spyOn(Math, "random").mockReturnValueOnce(0);
    const r = await runRefill(keyed, mock([], bodies), 10 * DAY);
    spy.mockRestore();
    expect(r!.topic).toBe("gaps");
    expect(bodies[0]).toContain("using at least one of these words: go, come, see");
  });

  it("counts only servable sentences: full ones do not block the cron refill", async () => {
    await env.DB.batch(Array.from({ length: 300 }, (_, i) => env.DB.prepare("INSERT INTO sentences (english, english_key, source, answer_count) VALUES (?1, ?1, 't', 2)").bind(`s${i}`)));
    const bodies: string[] = [];
    await lockedRefill(keyed, mock(["A b c d."], bodies), 0, "home");
    expect(bodies).toHaveLength(1);
    await env.DB.prepare("UPDATE sentences SET answer_count = 0").run();
    await lockedRefill(keyed, mock([], bodies), 0, "home");
    expect(bodies).toHaveLength(1);
  });

  it("lock: one of two concurrent acquires wins; expired lock can be retaken; cron skips while held", async () => {
    const [a, b] = await Promise.all([acquireRefillLock(env.DB, 1000), acquireRefillLock(env.DB, 1000)]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    expect(await acquireRefillLock(env.DB, 1000 + 119_999)).toBe(false);
    const bodies: string[] = [];
    expect(await lockedRefill(keyed, mock([], bodies), 1000 + 5, "home")).toBeNull();
    expect(bodies).toHaveLength(0);
    expect(await acquireRefillLock(env.DB, 1000 + 120_001)).toBe(true);
  });

  it("lock is released after a run, even on failure", async () => {
    const f = (async () => new Response("no", { status: 500 })) as unknown as typeof fetch;
    await expect(lockedRefill(keyed, f, 5000, "home")).rejects.toThrow();
    expect(await acquireRefillLock(env.DB, 5001)).toBe(true);
  });

  it("/api/next with an empty pool starts one refill and answers 202 refilling", async () => {
    const bodies: string[] = [];
    let open!: () => void;
    const gate = new Promise<void>((r) => (open = r));
    const inner = mock(["I go home."], bodies);
    vi.stubGlobal("fetch", (async (u: string, i: RequestInit) => { await gate; return inner(u, i); }) as unknown as typeof fetch);
    const jobs: Promise<unknown>[] = [];
    const ctx = { waitUntil: (p: Promise<unknown>) => jobs.push(p) } as unknown as ExecutionContext;
    const app = createApp(fakeDeps());
    const hit = async (phone: string) => app(new Request("https://paite.lamkalabs.com/api/next", { headers: { "X-Session": await session(phone) } }), keyed, ctx);
    const r1 = await hit(PHONE_A), r2 = await hit(PHONE_B);
    expect(r1.status).toBe(202);
    expect(await r1.json()).toEqual({ refilling: true });
    expect(r2.status).toBe(202);
    open();
    await Promise.all(jobs);
    vi.unstubAllGlobals();
    expect(bodies).toHaveLength(1);
    expect(jobs).toHaveLength(1);
    expect((await env.DB.prepare("SELECT count(*) AS n FROM sentences").first<{ n: number }>())!.n).toBe(1);
    expect((await env.DB.prepare("SELECT count(*) AS n FROM job_runs").first<{ n: number }>())!.n).toBe(0);
  });

  it("forced refill ignores the 300 threshold; cron path still skips", async () => {
    await env.DB.batch(Array.from({ length: 300 }, (_, i) => env.DB.prepare("INSERT INTO sentences (english, english_key, source) VALUES (?1, ?1, 't')").bind(`s${i}`)));
    const bodies: string[] = [];
    expect(await lockedRefill(keyed, mock(["A b c d."], bodies), 0, "home")).toBeNull();
    expect(bodies).toHaveLength(0);
    vi.stubGlobal("fetch", mock(["A b c d."], bodies));
    expect(await refillOnDemand(keyed, 20_000)).toBe(true);
    vi.unstubAllGlobals();
    expect(bodies).toHaveLength(1);
  });

  it("caps forced refills per UTC day", async () => {
    const bodies: string[] = [];
    vi.stubGlobal("fetch", mock([], bodies));
    for (let i = 0; i < FORCED_PER_DAY; i++) expect(await refillOnDemand(keyed, 30_000 + i * 200_000)).toBe(true);
    expect(await refillOnDemand(keyed, 30_000 + 41 * 200_000)).toBe(false);
    expect(bodies).toHaveLength(FORCED_PER_DAY);
    expect(await refillOnDemand(keyed, 2 * DAY)).toBe(true); // next UTC day
    vi.unstubAllGlobals();
    expect(bodies).toHaveLength(FORCED_PER_DAY + 1);
  });

  it("count and timeoutMs parameters drive the prompt, the cap and the abort signal", async () => {
    const bodies: string[] = [];
    const many = Array.from({ length: 40 }, (_, i) => `Sentence ${"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMN"[i]} here.`);
    const r = await runRefill(keyed, mock(many, bodies), 0, "home", false, 5_000, 25);
    expect(bodies[0]).toContain("exactly 25 short");
    expect(r!.inserted).toBe(25);
    const spy = vi.spyOn(AbortSignal, "timeout");
    await runRefill(keyed, mock([], []), 0, "home", false, 1234);
    expect(spy).toHaveBeenCalledWith(1234);
    spy.mockRestore();
    const hang = ((_u: string, init: RequestInit) => new Promise((_, rej) => init.signal!.addEventListener("abort", () => rej(new Error("aborted"))))) as unknown as typeof fetch;
    await expect(runRefill(keyed, hang, 0, "home", false, 10)).rejects.toThrow();
  });

  it("on-demand refill asks for 25 sentences with a 20 s timeout and frees the lock on failure", async () => {
    const bodies: string[] = [];
    const spy = vi.spyOn(AbortSignal, "timeout");
    vi.stubGlobal("fetch", mock([], bodies));
    await refillOnDemand(keyed, 50_000);
    expect(bodies[0]).toContain("exactly 25 short");
    expect(spy).toHaveBeenCalledWith(20_000);
    spy.mockRestore();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", (async () => { throw new Error("boom"); }) as unknown as typeof fetch);
    await refillOnDemand(keyed, 60_000);
    vi.unstubAllGlobals();
    expect(await acquireRefillLock(env.DB, 60_001)).toBe(true);
  });

  it("on-demand failure writes no job_runs row", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", (async () => new Response("no", { status: 500 })) as unknown as typeof fetch);
    expect(await refillOnDemand(keyed, 9000)).toBe(true);
    vi.unstubAllGlobals();
    expect((await env.DB.prepare("SELECT count(*) AS n FROM job_runs").first<{ n: number }>())!.n).toBe(0);
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
