import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { runNightly } from "../src/export";
import { dashboard, dayStart, ensureRolled, istDay, readAgent, runVisitorRollup, sourceOf, sqlTime, visitorCode } from "../src/visitors";
import { call, fakeDeps, NOW } from "./helpers";

const OWNER = "owner@example.org";
const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36";
const IPHONE_FB = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/490.0]";
const MIN = 60_000, DAY = 86_400_000;

type E = Partial<{ kind: string; path: string; vid: string; visitor: string; ref: string; via: string; country: string; region: string; city: string; device: string; browser: string; os: string; returning: number; ms: number }>;
/** Put an event straight into the table, `ago` milliseconds before NOW. */
async function ev(ago: number, e: E) {
  await env.DB.prepare(
    "INSERT INTO events (at, kind, path, vid, visitor, ref, via, country, region, city, device, browser, os, revisit, ms) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
  ).bind(sqlTime(NOW - ago), e.kind ?? "page", e.path ?? "/", e.vid ?? null, e.visitor ?? e.vid ?? null, e.ref ?? null, e.via ?? null, e.country ?? null, e.region ?? null, e.city ?? null,
    e.device ?? "phone", e.browser ?? "Chrome", e.os ?? "Android", e.returning ?? null, e.ms ?? null).run();
}

describe("reading a visit", () => {
  it("names sources from link tags, referrers and in-app browsers", () => {
    expect(sourceOf(null, "wa")).toBe("WhatsApp");
    expect(sourceOf("lm.facebook.com", null)).toBe("Facebook");
    expect(sourceOf("www.google.co.in", null)).toBe("Google");
    expect(sourceOf("com.google.android.googlequicksearchbox", null)).toBe("Google");
    expect(sourceOf("com.lamkalabs.paitedaily", null)).toBe("Paite Daily app");
    expect(sourceOf("paite.lamkalabs.com", null)).toBeNull();
    expect(sourceOf(null, null)).toBe("Direct");
    expect(sourceOf(null, null, "Facebook")).toBe("Facebook");
    expect(sourceOf("blog.example.org", null)).toBe("blog.example.org");
  });
  it("reads device, browser and system, and flags bots", () => {
    expect(readAgent(ANDROID)).toMatchObject({ bot: false, device: "phone", browser: "Chrome", os: "Android" });
    expect(readAgent(IPHONE_FB)).toMatchObject({ device: "phone", browser: "Facebook app", os: "iOS", inApp: "Facebook" });
    expect(readAgent("Mozilla/5.0 (compatible; Googlebot/2.1)").bot).toBe(true);
    expect(readAgent("").bot).toBe(true);
  });
  it("gives the same visitor code all day and a new one the next day", async () => {
    const a = await visitorCode(env, "203.0.113.9", ANDROID, NOW);
    expect(await visitorCode(env, "203.0.113.9", ANDROID, NOW + 1000)).toBe(a);
    expect(await visitorCode(env, "203.0.113.10", ANDROID, NOW)).not.toBe(a);
    expect(await visitorCode(env, "203.0.113.9", ANDROID, NOW + DAY)).not.toBe(a);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("the collector", () => {
  it("stores the tag, the returning flag, time on screen and the browser, but never the IP", async () => {
    const send = (body: unknown, ua = ANDROID) => call("/api/event", { method: "POST", body: JSON.stringify(body), headers: { "user-agent": ua, "CF-Connecting-IP": "198.51.100.77" } });
    expect((await send({ kind: "page", path: "/proverbs", vid: "t1", via: "WA", ret: 1 })).status).toBe(204);
    await send({ kind: "leave", path: "/proverbs", vid: "t1", ms: 99_999_999 });
    await send({ kind: "page", vid: "t2" }, "Googlebot/2.1 (+http://www.google.com/bot.html)");
    await send({ kind: "page", vid: "t3", via: "<script>" });
    const rows = (await env.DB.prepare("SELECT * FROM events ORDER BY id").all<Record<string, unknown>>()).results;
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ kind: "page", path: "/proverbs", via: "wa", revisit: 1, device: "phone", browser: "Chrome", os: "Android", ms: null });
    expect(rows[1]).toMatchObject({ kind: "leave", ms: 1_800_000 });
    expect(rows[2]).toMatchObject({ via: null });
    expect(rows[0].visitor).toMatch(/^[0-9a-f]{16}$/);
    expect(JSON.stringify(rows)).not.toContain("198.51.100.77");
    expect(String(rows[0].at)).toBe(sqlTime(NOW));
  });
});

describe("the dashboard numbers", () => {
  it("counts visitors, visits, sources, time, bounces, the funnel and actions", async () => {
    // Visit A: WhatsApp tag, front page, sees a sentence, answers, 2 minutes on screen. Returning.
    await ev(30 * MIN, { vid: "a", via: "wa", country: "IN", region: "Manipur", city: "Churachandpur", returning: 1 });
    await ev(30 * MIN, { vid: "a", kind: "card" });
    await ev(29 * MIN, { vid: "a", kind: "answer" });
    await ev(28 * MIN, { vid: "a", kind: "leave", ms: 120_000 });
    // Visit B: Facebook referrer, two pages, new.
    await ev(20 * MIN, { vid: "b", ref: "lm.facebook.com", country: "IN", region: "Manipur", city: "Churachandpur", returning: 0 });
    await ev(19 * MIN, { vid: "b", path: "/proverbs", ref: "paite.lamkalabs.com" });
    // Visit C: no referrer, one page, nothing else: a bounce. From a city nobody else came from.
    await ev(10 * MIN, { vid: "c", path: "/glossary", country: "IN", region: "Delhi", city: "New Delhi", device: "desktop", browser: "Firefox", os: "Windows" });
    const d = await dashboard(env, "today", NOW);
    expect(d.totals).toMatchObject({ visitors: 3, visits: 3, pageviews: 4, actions: 1 });
    expect(d.totals.bounceRate).toBeCloseTo(33.3, 1);
    expect(d.sources.map((s) => s.key).sort()).toEqual(["Direct", "Facebook", "WhatsApp"]);
    expect(d.funnel).toEqual([{ step: "Arrived", visits: 3 }, { step: "Saw a sentence", visits: 1 }, { step: "Sent an answer", visits: 1 }]);
    expect(d.actions.map((a) => a.key)).toEqual(["answer"]);
    expect(d.entries.find((e) => e.key === "/")!.visits).toBe(2);
    expect(d.exits.find((e) => e.key === "/proverbs")!.visits).toBe(1);
    expect(d.returning).toMatchObject({ new: 1, returning: 1 });
    // Churachandpur has two visitors and is named; New Delhi has one and is folded away.
    expect(d.cities.map((c) => c.key)).toEqual(["IN|Manipur|Churachandpur", ""]);
    expect(d.regions.map((r) => r.key)).toEqual(["IN|Manipur", "IN|Delhi"]);
    // The move from / to /proverbs is the site itself, never a source.
    expect(d.sources.some((s) => s.key === "paite.lamkalabs.com")).toBe(false);
    // Time on screen is averaged over the views of a page: 2 minutes over 2 views of the front page.
    expect(d.pages.find((p) => p.key === "/")!.avgMs).toBe(60_000);
  });
  it("rolls finished days into daily totals and draws a week from them", async () => {
    const today = istDay(NOW);
    const yday = dayStart(today) - DAY + 3_600_000; // 01:00 IST yesterday
    for (const [vid, via] of [["y1", "wa"], ["y2", "wa"], ["y3", null]] as const) {
      await env.DB.prepare("INSERT INTO events (at, kind, path, vid, visitor, via) VALUES (?1, 'page', '/', ?2, ?2, ?3)").bind(sqlTime(yday), vid, via).run();
    }
    const rolled = await ensureRolled(env, NOW);
    expect(rolled).toContain(istDay(yday));
    expect(await ensureRolled(env, NOW)).toEqual([]);
    const d = await dashboard(env, "7", NOW);
    expect(d.series).toHaveLength(7);
    expect(d.series[5]).toMatchObject({ key: istDay(yday), visitors: 3, visits: 3 });
    expect(d.sources[0]).toMatchObject({ key: "WhatsApp", visits: 2 });
    expect(d.heatmap).toHaveLength(7);
    expect(d.heatmap!.flat().reduce((a, b) => a + b, 0)).toBe(3);
  });
  it("the nightly job keeps the totals and removes raw events after 30 days", async () => {
    await env.DB.prepare("INSERT INTO events (at, kind, path, vid) VALUES (?1, 'page', '/', 'old')").bind(sqlTime(NOW - 40 * DAY)).run();
    await ev(2 * DAY, { vid: "recent" });
    const r = await runVisitorRollup(env, NOW);
    expect(r!.deleted).toBe(1);
    const left = await env.DB.prepare("SELECT vid FROM events").all<{ vid: string }>();
    expect(left.results.map((x) => x.vid)).toEqual(["recent"]);
    const kept = await env.DB.prepare("SELECT visits FROM visit_stats WHERE day = ?1 AND dim = 'all'").bind(istDay(NOW - 2 * DAY)).first<{ visits: number }>();
    expect(kept!.visits).toBe(1);
  });
  it("runs as the nightly 'visitors' job", async () => {
    // runNightly reads the real clock, so this event is placed against it.
    await env.DB.prepare("INSERT INTO events (at, kind, path, vid) VALUES (?1, 'page', '/', 'n')").bind(sqlTime(Date.now() - 2 * DAY)).run();
    await runNightly(env, (async () => new Response("{}", { status: 500 })) as unknown as typeof fetch);
    const job = await env.DB.prepare("SELECT ok FROM job_runs WHERE job = 'visitors'").first<{ ok: number }>();
    expect(job!.ok).toBe(1);
  });
});

describe("the reviewers page API", () => {
  /** A request as a signed-in reviewer. */
  const as = (email: string | null, path: string) => call(path, {}, fakeDeps({ verifyReviewer: async () => email }));
  it("is for the owner only, and checks its inputs", async () => {
    expect((await as(null, "/review/api/visitors")).status).toBe(401);
    expect((await as("rev@example.org", "/review/api/visitors")).status).toBe(403);
    expect((await as("rev@example.org", "/review/api/visitors/live")).status).toBe(403);
    expect((await as("rev@example.org", "/review/api/visitors/visits")).status).toBe(403);
    const ok = await as(OWNER, "/review/api/visitors?range=30");
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ range: "30", totals: { visits: 0 } });
    expect((await as(OWNER, "/review/api/visitors?range=365")).status).toBe(400);
    expect((await as(OWNER, "/review/api/visitors/visits?before=abc")).status).toBe(400);
    expect((await as(OWNER, "/review/api/visitors/other")).status).toBe(404);
  });
  it("is no longer on the admin API", async () => {
    expect((await call("/admin/api/visitors")).status).toBe(401);
  });
  it("shows who is on now and recent visits with their steps, naming a city only with two visitors", async () => {
    await ev(2 * MIN, { vid: "x", country: "IN", region: "Mizoram", city: "Aizawl", via: "wa" });
    await ev(1 * MIN, { vid: "x", kind: "chat" });
    await ev(3 * 3_600_000, { vid: "y", country: "IN", region: "Manipur", city: "Lamka" });
    await ev(3 * 3_600_000 - MIN, { vid: "z", country: "IN", region: "Manipur", city: "Lamka" });
    const live = await (await as(OWNER, "/review/api/visitors/live")).json<{ count: number; visits: { source: string; city: string; region: string }[] }>();
    expect(live.count).toBe(1);
    expect(live.visits[0]).toMatchObject({ source: "WhatsApp", city: "", region: "Mizoram" });
    const recent = await (await as(OWNER, "/review/api/visitors/visits")).json<{ visits: { city: string; steps: { kind: string }[] }[]; more: boolean }>();
    expect(recent.visits).toHaveLength(3);
    // Newest first by arrival; here the Lamka rows were written last.
    expect(recent.visits.find((v) => v.steps.length === 2)!.steps.map((s) => s.kind)).toEqual(["page", "chat"]);
    expect(recent.visits.filter((v) => v.city === "Lamka")).toHaveLength(2);
    expect(recent.more).toBe(false);
  });
});