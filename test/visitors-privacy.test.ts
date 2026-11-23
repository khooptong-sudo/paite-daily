import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { handleEvent } from "../src/observability";
import { dashboard, ensureRolled, istDay, parseQuery, runVisitorRollup, sourceOf, sqlTime } from "../src/visitors";
import trackJs from "../public/track.js?raw";
import { NOW } from "./helpers";

const DAY = 86_400_000;
const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36";
async function ev(ago: number, e: Record<string, string | number | null>) {
  const row: Record<string, string | number | null> = { kind: "page", path: "/", device: "phone", browser: "Chrome", os: "Android", ...e, at: sqlTime(NOW - ago) };
  const cols = Object.keys(row);
  await env.DB.prepare(`INSERT INTO events (${cols.map((c) => `"${c}"`).join(", ")}) VALUES (${cols.map((_, i) => `?${i + 1}`).join(", ")})`).bind(...Object.values(row)).run();
}
const post = (body: unknown, headers: Record<string, string> = {}, ip = "198.51.100.7") =>
  handleEvent(new Request("https://x.test/api/event", { method: "POST", body: JSON.stringify(body), headers: { "user-agent": ANDROID, "CF-Connecting-IP": ip, ...headers } }), env, NOW);
const count = async () => (await env.DB.prepare("SELECT count(*) AS n FROM events").first<{ n: number }>())!.n;
const PLACE = { country: "IN", region: "Manipur", city: "Tinyville" };

describe("visitor privacy promises", () => {
  it("one person on two days (two daily codes) does not get their city named", async () => {
    await ev(2 * DAY, { vid: "t1", visitor: "codeday1", ...PLACE });
    await ev(1 * DAY, { vid: "t2", visitor: "codeday2", ...PLACE });
    const d = await dashboard(env, "7", NOW);
    expect(d.cities.map((c) => c.key)).not.toContain("IN|Manipur|Tinyville");
  });
  it("two visitors on the same day do get the city named, even across a multi-day window", async () => {
    await ev(2 * DAY, { vid: "a1", visitor: "a1", ...PLACE });
    await ev(2 * DAY, { vid: "a2", visitor: "a2", ...PLACE });
    await ev(1 * DAY, { vid: "b1", visitor: "b1", ...PLACE });
    const d = await dashboard(env, "7", NOW);
    expect(d.cities.map((c) => c.key)).toContain("IN|Manipur|Tinyville");
  });
  it("the nightly roll-up stores no rare value seen by fewer than two visitors", async () => {
    await ev(2 * DAY, { vid: "t1", visitor: "c1", ...PLACE, model: "SM-A546E", isp: "Tiny ISP", tz: "Asia/Kolkata" });
    await ensureRolled(env, NOW);
    const r = await env.DB.prepare("SELECT dim, key, visitors FROM visit_stats WHERE dim IN ('city','model','isp','tz') AND visitors < 2").all();
    expect(r.results).toEqual([]);
  });
  it("server ignores DNT: 1 and Sec-GPC: 1", async () => {
    await post({ kind: "page", path: "/", vid: "d1" }, { DNT: "1" });
    await post({ kind: "page", path: "/", vid: "d2" }, { "Sec-GPC": "1" });
    expect(await count()).toBe(0);
    await post({ kind: "page", path: "/", vid: "d3" });
    expect(await count()).toBe(1);
  });
  it("track.js also honours doNotTrack yes and msDoNotTrack 1", () => {
    expect(trackJs).toContain('navigator.doNotTrack === "yes"');
    expect(trackJs).toContain('navigator.msDoNotTrack === "1"');
  });
  it("raw events older than 30 days are deleted", async () => {
    await ev(30.5 * DAY, { vid: "old", visitor: "o1" });
    await ev(29.5 * DAY, { vid: "new", visitor: "n1" });
    await runVisitorRollup(env, NOW);
    expect(await count()).toBe(1);
  });
  it("one address cannot flood /api/event (300 an hour), with or without a tab id, and stores no IP", async () => {
    for (let i = 0; i < 310; i++) await post({ kind: "page", path: "/", vid: "v" + i });
    expect(await count()).toBe(300);
    await post({ kind: "page", path: "/" }, {}, "203.0.113.1");
    expect(await count()).toBe(301);
    const k = await env.DB.prepare("SELECT key FROM event_rate").all<{ key: string }>();
    expect(JSON.stringify(k.results)).not.toContain("198.51.100.7");
  });
  it("the nightly job prunes old event_rate rows", async () => {
    await env.DB.prepare("INSERT INTO event_rate (key, hour, n) VALUES ('k', ?1, 5), ('k', ?2, 5)").bind(sqlTime(NOW - 3 * DAY).slice(0, 13), sqlTime(NOW).slice(0, 13)).run();
    await runVisitorRollup(env, NOW);
    expect((await env.DB.prepare("SELECT count(*) AS n FROM event_rate WHERE key = 'k'").first<{ n: number }>())!.n).toBe(1);
  });
  it("says 'same time yesterday' only when both sides are part-days", async () => {
    for (let i = 0; i < 6; i++) await ev(DAY + i * 1000, { vid: "y" + i, visitor: "y" + i });
    await ev(1000, { vid: "t0", visitor: "t0" });
    const custom = parseQuery(new URLSearchParams({ range: "custom", from: istDay(NOW) }), NOW)!;
    const stored = (await dashboard(env, "7", NOW, custom)).insights.map((i) => i.text).join(" | ");
    expect(stored).toMatch(/Visitors are/);
    expect(stored).not.toMatch(/same time yesterday/);
    const today = (await dashboard(env, "today", NOW)).insights.map((i) => i.text).join(" | ");
    expect(today).toMatch(/same time yesterday/);
  });
  it("classifies only the real google host as Google", () => {
    expect(sourceOf("google.evil.com", null)).not.toBe("Google");
    expect(sourceOf("google.com.evil.org", null)).not.toBe("Google");
    for (const h of ["google.com", "www.google.com", "www.google.co.in", "google.co.uk", "google.de"]) expect(sourceOf(h, null)).toBe("Google");
  });
});
