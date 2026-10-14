import { env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runNightly } from "../src/export";
import { getGoal } from "../src/goal";
import { addSentences, call, fakeDeps, NOW, PHONE_A } from "./helpers";

const saved = { r: env.REVIEWERS, a: env.ALERT_EMAIL, g: env.COMMUNITY_GOAL };
afterEach(() => { env.REVIEWERS = saved.r; env.ALERT_EMAIL = saved.a; env.COMMUNITY_GOAL = saved.g; vi.restoreAllMocks(); });

const ans = (sentence: number, status = "new") =>
  env.DB.prepare("INSERT INTO answers (sentence_id, phone_id, paite, register, status) VALUES (?1, ?2, 'x', 'both', ?3)").bind(sentence, PHONE_A, status).run();
const bind = (send: (m: { to: string; subject: string; text: string }) => Promise<unknown>) => { env.ALERT_EMAIL = { send } as unknown as SendEmail; };
const nightly = () => runNightly(env, async () => new Response("{}", { status: 404 }));

describe("digest", () => {
  it("sends one email per distinct address with the counts", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    env.REVIEWERS = JSON.stringify({ "a@example.org": "A", "A@Example.org": "A2", "b@example.org": "B" });
    const [s1, s2, s3] = await addSentences("One.", "Two.", "Three.");
    await env.DB.prepare("UPDATE sentences SET status = 'full' WHERE id = ?1").bind(s1).run();
    await ans(s1); await ans(s1); await ans(s2);
    await env.DB.prepare("UPDATE sentences SET status = 'verified' WHERE id = ?1").bind(s3).run();
    await ans(s3);
    const send = vi.fn(async () => ({})); bind(send);
    await nightly();
    expect(send).toHaveBeenCalledTimes(2);
    const msgs = send.mock.calls.map((c) => (c as unknown as [{ to: string; subject: string; text: string }])[0]);
    expect(msgs.map((m) => m.to).sort()).toEqual(["a@example.org", "b@example.org"]);
    expect(msgs[0].subject).toBe("Paite Daily: 3 answers waiting");
    expect(msgs[0].text).toContain("2 sentences");
    expect(msgs[0].text).toContain("https://paite.lamkalabs.com/review");
    expect((await env.DB.prepare("SELECT ok FROM job_runs WHERE job = 'digest'").first<{ ok: number }>())?.ok).toBe(1);
  });
  it("skips at zero and without the binding", async () => {
    const send = vi.fn(async () => ({})); bind(send);
    await nightly();
    expect(send).not.toHaveBeenCalled();
    const [s1] = await addSentences("One."); await ans(s1);
    env.ALERT_EMAIL = undefined;
    await nightly();
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM job_runs WHERE job = 'digest'").first<{ n: number }>())!.n).toBe(0);
  });
  it("one failing address does not stop the others or the export", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    env.REVIEWERS = JSON.stringify({ "a@example.org": "A", "b@example.org": "B" });
    const [s1] = await addSentences("One."); await ans(s1);
    const send = vi.fn(async (m: { to: string }) => { if (m.to === "a@example.org") throw new Error("down"); });
    bind(send);
    await nightly();
    expect(send).toHaveBeenCalledTimes(2);
    expect((await env.DB.prepare("SELECT ok FROM job_runs WHERE job = 'digest'").first<{ ok: number }>())?.ok).toBe(0);
    expect((await env.DB.prepare("SELECT ok FROM job_runs WHERE job = 'export'").first<{ ok: number }>())?.ok).toBe(1);
  });
});

describe("review queue", () => {
  it("returns the waiting count to reviewers only", async () => {
    const [s1] = await addSentences("One."); await ans(s1); await ans(s1);
    const r = await call("/review/api/queue", {}, fakeDeps({ verifyAccess: async () => "rev@example.org" }));
    expect(await r.json()).toEqual({ waiting: 2 });
    expect((await call("/review/api/queue", {}, fakeDeps({ verifyAccess: async () => "x@example.org" }))).status).toBe(403);
  });
  it("excludes sentences locked by another reviewer", async () => {
    const [s1] = await addSentences("One."); await ans(s1);
    await env.DB.prepare("INSERT INTO locks (sentence_id, reviewer_email, expires_at) VALUES (?1, 'owner@example.org', ?2)").bind(s1, NOW + 60_000).run();
    const q = async (e: string) => (await (await call("/review/api/queue", {}, fakeDeps({ verifyAccess: async () => e }))).json<{ waiting: number }>()).waiting;
    expect(await q("rev@example.org")).toBe(0);
    expect(await q("owner@example.org")).toBe(1);
  });
});

describe("community goal", () => {
  it("counts distinct verified sentences and doubles when reached", async () => {
    const [s1, s2] = await addSentences("One.", "Two.");
    await ans(s1, "accepted"); await ans(s1, "also_correct"); await ans(s2, "rejected");
    env.COMMUNITY_GOAL = "1";
    expect(await getGoal(env)).toEqual({ verified: 1, goal: 2 });
    await ans(s2, "accepted");
    expect(await getGoal(env)).toEqual({ verified: 2, goal: 4 });
    env.COMMUNITY_GOAL = "junk";
    expect((await getGoal(env)).goal).toBe(1000);
  });
  it("is public and cacheable", async () => {
    for (const path of ["/api/goal", "/api/contributors"]) {
      const r = await call(path);
      expect(r.status).toBe(200);
      expect(r.headers.get("cache-control")).toBe("public, max-age=300");
    }
  });
  it("Pan Late shows the bar and the invite link", async () => {
    const page = await (await call("/contributors")).text();
    expect(page).toContain('role="progressbar"');
    expect(page).toContain("https://wa.me/?text=Help%20write%20Paite");
  });
});
