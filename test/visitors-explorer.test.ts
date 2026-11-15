import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { handleEvent } from "../src/observability";
import { brandOf, dashboard, ispOf, p75, parseQuery, readAgent, sqlTime, summarise, toVisits, vitalBucket, vitalRating } from "../src/visitors";
import { call, fakeDeps, NOW } from "./helpers";

const OWNER = "owner@example.org";
const MIN = 60_000, DAY = 86_400_000;
const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";
const WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/** Put an event straight into the table, `ago` milliseconds before NOW; any column can be set. */
async function ev(ago: number, e: Record<string, string | number | null>) {
  const row: Record<string, string | number | null> = { kind: "page", path: "/", device: "phone", browser: "Chrome", os: "Android", ...e, at: sqlTime(NOW - ago) };
  if (row.visitor === undefined) row.visitor = row.vid ?? null;
  const cols = Object.keys(row);
  await env.DB.prepare(`INSERT INTO events (${cols.map((c) => `"${c}"`).join(", ")}) VALUES (${cols.map((_, i) => `?${i + 1}`).join(", ")})`).bind(...Object.values(row)).run();
}
const as = (email: string | null, path: string) => call(path, {}, fakeDeps({ verifyReviewer: async () => email }));

describe("reading versions", () => {
  it("gives the system and browser to the major version", () => {
    expect(readAgent(ANDROID)).toMatchObject({ osv: "Android 14", bv: "Chrome 131" });
    expect(readAgent(IPHONE)).toMatchObject({ osv: "iOS 18", bv: "Safari 18" });
    expect(readAgent(WINDOWS, { pv: "15.0.0" })).toMatchObject({ osv: "Windows 11", bv: "Chrome 131" });
    expect(readAgent(WINDOWS, { pv: "10.0.0" }).osv).toBe("Windows 10");
    expect(readAgent(WINDOWS).osv).toBe("Windows 10/11");
    // A reduced user agent says Android 10; the browser's own hint wins.
    expect(readAgent("Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 Chrome/131.0.0.0 Mobile Safari/537.36", { pv: "14.0.0", bvh: 132 })).toMatchObject({ osv: "Android 14", bv: "Chrome 132" });
  });
  it("names phone makers from model codes, and tidies network names", () => {
    const cases: [string, string][] = [["SM-A146B", "Samsung"], ["Pixel 8", "Google"], ["Redmi Note 11", "Xiaomi"], ["2201116SI", "Xiaomi"], ["CPH2487", "Oppo"],
      ["RMX3363", "Realme"], ["V2250", "Vivo"], ["KB2001", "OnePlus"], ["moto g54", "Motorola"], ["Infinix X6525", "Infinix"], ["TECNO KI5k", "Tecno"], ["Zzz-1", "Other"]];
    for (const [model, brand] of cases) expect(brandOf(model, "Android"), model).toBe(brand);
    expect(brandOf(null, "iOS")).toBe("Apple");
    expect(brandOf(null, "Android")).toBeNull();
    expect(ispOf("Reliance Jio Infocomm Limited")).toBe("Reliance Jio");
    expect(ispOf("Bharti Airtel Ltd.")).toBe("Bharti Airtel");
    expect(ispOf("Bharat Sanchar Nigam Limited")).toBe("BSNL");
    expect(ispOf("Vodafone Idea Ltd")).toBe("Vodafone Idea");
    expect(ispOf("Example Broadband Pvt Ltd")).toBe("Example Broadband");
    expect(ispOf("")).toBeNull();
    expect(ispOf(undefined)).toBeNull();
  });
});

describe("the collector, new fields", () => {
  const send = (body: unknown, ua = ANDROID, cf: object = { asOrganization: "Reliance Jio Infocomm Limited" }) =>
    handleEvent(new Request("https://paite.lamkalabs.com/api/event", { method: "POST", body: JSON.stringify(body), headers: { "user-agent": ua, "CF-Connecting-IP": "198.51.100.5" }, cf } as RequestInit), env, NOW);
  const rows = async () => (await env.DB.prepare("SELECT * FROM events ORDER BY id").all<Record<string, unknown>>()).results;

  it("stores checked values and turns bad ones into null", async () => {
    await send({ kind: "page", vid: "p1", model: "SM-A146B", pv: "14.0.0", bvh: 131, lang: "en-IN", tz: "Asia/Kolkata", vw: "360-389", dpr: 2.75, net: "4g", theme: "dark", scheme: "light", pwa: 1, ttfb: 5, scroll: 40 });
    await send({ kind: "page", vid: "p2", model: "<script>", pv: "x", lang: "not a lang!", tz: "bad tz<>", vw: "huge", dpr: "9x", net: "5g", theme: "red", scheme: 3, pwa: 7 });
    const [a, b] = await rows();
    expect(a).toMatchObject({ osv: "Android 14", bv: "Chrome 131", brand: "Samsung", model: "SM-A146B", isp: "Reliance Jio", lang: "en-IN", tz: "Asia/Kolkata", vw: "360-389", dpr: "3x", net: "4g", theme: "dark", scheme: "light", pwa: 1 });
    // Speed and scroll belong to 'leave' only.
    expect(a).toMatchObject({ ttfb: null, scroll: null });
    expect(b).toMatchObject({ model: null, brand: null, lang: null, tz: null, vw: null, dpr: null, net: null, theme: null, scheme: null, pwa: null });
    expect(b.osv).toBe("Android 14");
  });
  it("ignores an implausible browser major (a grease brand such as 8)", async () => {
    await send({ kind: "page", vid: "g1", bvh: 8 });
    expect((await rows())[0].bv).toBe("Chrome 131");
  });
  it("clamps speed numbers on leave, and keeps outbound hosts and cut error text", async () => {
    await send({ kind: "leave", vid: "p3", ms: 5000, ttfb: 999999, load: -4, lcp: 1234.6, inp: 80, cls: 99999, scroll: 250 });
    await send({ kind: "out", vid: "p3", target: "WA.me" });
    await send({ kind: "out", vid: "p3", target: "bad host/with slash" });
    await send({ kind: "jserror", vid: "p3", target: "x".repeat(400) + "\n" });
    await send({ kind: "nonsense", vid: "p3" });
    const r = await rows();
    expect(r).toHaveLength(4);
    expect(r[0]).toMatchObject({ ttfb: 60000, load: 0, lcp: 1235, inp: 80, cls: 10000, scroll: 100 });
    expect(r[1].target).toBe("wa.me");
    expect(r[2].target).toBeNull();
    expect((r[3].target as string).length).toBe(120);
  });
});

describe("totals for the new dimensions", () => {
  it("buckets speed by Google's limits and finds the 75th percentile", () => {
    expect(vitalRating("lcp", vitalBucket("lcp", 2500))).toBe("good");
    expect(vitalRating("lcp", vitalBucket("lcp", 2501))).toBe("needs");
    expect(vitalRating("lcp", vitalBucket("lcp", 4000))).toBe("needs");
    expect(vitalRating("lcp", vitalBucket("lcp", 4001))).toBe("poor");
    expect(vitalRating("inp", vitalBucket("inp", 200))).toBe("good");
    expect(vitalRating("inp", vitalBucket("inp", 500))).toBe("needs");
    expect(vitalRating("inp", vitalBucket("inp", 501))).toBe("poor");
    expect(vitalRating("cls", vitalBucket("cls", 100))).toBe("good");
    expect(vitalRating("cls", vitalBucket("cls", 250))).toBe("needs");
    expect(vitalRating("cls", vitalBucket("cls", 251))).toBe("poor");
    expect(vitalRating("ttfb", vitalBucket("ttfb", 800))).toBe("good");
    expect(vitalRating("ttfb", vitalBucket("ttfb", 1800))).toBe("needs");
    expect(vitalRating("ttfb", vitalBucket("ttfb", 1801))).toBe("poor");
    expect(vitalBucket("lcp", 99999)).toBe("10000+");
    const hist = [{ key: vitalBucket("lcp", 1800), n: 6 }, { key: vitalBucket("lcp", 3500), n: 2 }, { key: vitalBucket("lcp", 5000), n: 2 }];
    expect(p75("lcp", hist)).toBe(4000);
    expect(p75("lcp", [])).toBeNull();
  });
  it("adds every new dimension to the daily rows", () => {
    const e = (id: number, o: Record<string, unknown>) => ({ id, at: sqlTime(NOW - 5 * MIN + id * 1000), kind: "page", path: "/", vid: "a", visitor: "A", device: "phone", ref: null, via: null, country: "IN", region: null, city: null, browser: "Chrome", os: "Android", revisit: 0, ms: null,
      osv: "Android 14", bv: "Chrome 131", brand: "Samsung", model: "SM-A146B", isp: "Reliance Jio", lang: "en-IN", tz: "Asia/Kolkata", vw: "360-389", dpr: "3x", net: "4g", theme: "dark", scheme: "light", pwa: 1,
      ttfb: null, load: null, lcp: null, inp: null, cls: null, scroll: null, target: null, ...o });
    const visits = toVisits([
      e(1, {}), e(2, { path: "/proverbs" }), e(3, { path: "/proverbs" }),
      e(4, { kind: "leave", path: "/proverbs", ms: 20_000, lcp: 2400, inp: 250, cls: 90, ttfb: 1000, load: 2500, scroll: 80 }),
      e(5, { kind: "out", target: "wa.me" }), e(6, { kind: "jserror", path: "/proverbs", target: "boom" }),
    ]);
    const rows = summarise(visits);
    const get = (dim: string, key: string) => rows.find((r) => r.dim === dim && r.key === key);
    expect(get("osv", "Android 14")).toMatchObject({ visitors: 1, visits: 1, hits: 3 });
    for (const [dim, key] of [["bv", "Chrome 131"], ["brand", "Samsung"], ["model", "SM-A146B"], ["isp", "Reliance Jio"], ["lang", "en-IN"], ["tz", "Asia/Kolkata"], ["vw", "360-389"], ["dpr", "3x"], ["net", "4g"], ["theme", "dark"], ["scheme", "light"], ["pwa", "1"], ["tzcheck", "same"]]) expect(get(dim, key), `${dim}=${key}`).toBeTruthy();
    expect(get("depth", "3")).toBeTruthy();
    expect(get("dwell", "10-30s")).toBeTruthy();
    expect(get("scroll", "75-99")).toBeTruthy();
    expect(get("lcp", "2000-2500")).toBeTruthy();
    expect(get("inp", "200-350")).toBeTruthy();
    expect(get("cls", "50-100")).toBeTruthy();
    expect(get("ttfb", "800-1200")).toBeTruthy();
    expect(get("load", "2000-3000")).toBeTruthy();
    expect(get("out", "wa.me")).toBeTruthy();
    expect(get("jserror", "/proverbs|boom")).toBeTruthy();
    expect(get("flow", "/>/proverbs")).toBeTruthy();
    expect(get("vitals_page", "/proverbs|lcp|2000-2500")).toBeTruthy();
    expect(get("vitals_dev", "phone|lcp|2000-2500")).toBeTruthy();
    // 'out' and 'jserror' are not actions.
    expect(get("kind", "out")).toBeUndefined();
    expect(visits[0].bounce).toBe(false);
  });
});

describe("filters", () => {
  async function seed() {
    // a: Jio phone, front page only. b: Airtel phone, front page and proverbs. c: Jio desktop, glossary.
    await ev(30 * MIN, { vid: "a", country: "IN", brand: "Samsung", model: "SM-A1", isp: "Reliance Jio", tz: "Asia/Kolkata", osv: "Android 14", device: "phone" });
    await ev(20 * MIN, { vid: "b", country: "IN", brand: "Samsung", model: "SM-A1", isp: "Bharti Airtel", tz: "Asia/Kolkata", osv: "Android 14", device: "phone" });
    await ev(19 * MIN, { vid: "b", path: "/proverbs", device: "phone" });
    await ev(10 * MIN, { vid: "c", path: "/glossary", country: "US", brand: "Apple", model: "Lone", isp: "Reliance Jio", tz: "America/Chicago", osv: "macOS", device: "desktop", os: "macOS" });
  }
  const view = async (qs: string) => (await (await as(OWNER, `/review/api/visitors?range=7&${qs}`)).json()) as Awaited<ReturnType<typeof dashboard>>;

  it("parses the query and refuses unknown dimensions", () => {
    expect(parseQuery(new URLSearchParams("range=7&f=country:IN&f=bogus:x"), NOW)).toBeNull();
    expect(parseQuery(new URLSearchParams("range=custom&from=2026-11-01&to=2026-11-05"), NOW)).toMatchObject({ range: "custom", from: "2026-11-01", to: "2026-11-05", g: "day" });
    expect(parseQuery(new URLSearchParams("range=custom&from=2020-01-01&to=2026-11-05"), NOW)).toBeNull();
    expect(parseQuery(new URLSearchParams("range=30&g=hour"), NOW)).toBeNull();
    expect(parseQuery(new URLSearchParams("range=today"), NOW)).toMatchObject({ g: "hour" });
  });
  it("keeps visits that match every dimension, and either value within one", async () => {
    await seed();
    expect((await view("")).totals.visits).toBe(3);
    expect((await view("f=isp:Reliance Jio")).totals.visits).toBe(2);
    expect((await view("f=isp:Reliance Jio&f=device:phone")).totals.visits).toBe(1);
    expect((await view("f=isp:Reliance Jio&f=isp:Bharti Airtel")).totals.visits).toBe(3);
    expect((await view("f=isp:Reliance Jio&f=isp:Bharti Airtel&f=country:US")).totals.visits).toBe(1);
    expect((await view("f=country:IN&f=device:desktop")).totals.visits).toBe(0);
  });
  it("matches 'page' on any page of the visit", async () => {
    await seed();
    const d = await view("f=page:/proverbs");
    expect(d.totals).toMatchObject({ visits: 1, pageviews: 2 });
    expect(d.entries.map((e) => e.key)).toEqual(["/"]);
  });
  it("needs raw events: a window past 30 days is a 400", async () => {
    const old = istDay40();
    expect((await as(OWNER, `/review/api/visitors?range=custom&from=${old}&to=${old}&f=country:IN`)).status).toBe(400);
    const body = await (await as(OWNER, `/review/api/visitors?range=custom&from=${old}&to=${old}&f=country:IN`)).json();
    expect(body).toEqual({ error: "filters_need_raw" });
    // Without filters an old window reads the stored totals.
    expect((await as(OWNER, `/review/api/visitors?range=custom&from=${old}&to=${old}`)).status).toBe(200);
  });
});
const istDay40 = () => new Date(NOW + 330 * MIN - 40 * DAY).toISOString().slice(0, 10);

describe("the two-visitor rule and the CSV", () => {
  async function seed() {
    await ev(30 * MIN, { vid: "a", country: "IN", region: "Manipur", city: "Lamka", model: "SM-A1", isp: "Reliance Jio", tz: "Asia/Kolkata" });
    await ev(20 * MIN, { vid: "b", country: "IN", region: "Manipur", city: "Lamka", model: "SM-A1", isp: "Reliance Jio", tz: "Asia/Kolkata" });
    await ev(10 * MIN, { vid: "c", country: "IN", region: "Delhi", city: "New Delhi", model: "Lone, \"Quoted\"", isp: "=Evil()", tz: "Pacific/Honolulu" });
  }
  it("folds phone models, networks and time zones with one visitor into Other", async () => {
    await seed();
    const d = (await (await as(OWNER, "/review/api/visitors?range=7")).json()) as Awaited<ReturnType<typeof dashboard>>;
    expect(d.cards.model.map((i) => i.key)).toEqual(["SM-A1", ""]);
    expect(d.cards.isp.map((i) => i.key)).toEqual(["Reliance Jio", ""]);
    expect(d.cards.tz.map((i) => i.key)).toEqual(["Asia/Kolkata", ""]);
    expect(d.cards.tzcheck.map((i) => i.key).sort()).toEqual(["differs", "same"]);
    const det = await (await as(OWNER, "/review/api/visitors?range=7&part=detail")).json<{ dims: Record<string, { key: string }[]>; speed: Record<string, unknown> }>();
    expect(det.dims.model.map((i) => i.key)).toEqual(["SM-A1", ""]);
    expect(Object.keys(det.speed)).toEqual(["lcp", "inp", "cls", "ttfb", "load"]);
  });
  it("exports a table with the same rule, escaped, as text/csv", async () => {
    await seed();
    const r = await as(OWNER, "/review/api/visitors/export?range=7&what=table&dim=model");
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("text/csv");
    expect(r.headers.get("content-disposition")).toContain("attachment");
    const lines = (await r.text()).trim().split("\r\n");
    expect(lines[0]).toBe("model,visitors,visits,views,left_at_once_percent,average_seconds,share_percent");
    expect(lines.slice(1)).toEqual(["SM-A1,2,2,2,100,0,66.7", "Other,1,1,1,,,33.3"]);
    expect((await as(OWNER, "/review/api/visitors/export?range=7&what=table&dim=bogus")).status).toBe(400);
  });
  it("exports visits one per row, hiding rare values and defusing formulas", async () => {
    await seed();
    const text = await (await as(OWNER, "/review/api/visitors/export?range=7&what=visits")).text();
    const lines = text.trim().split("\r\n");
    expect(lines[0].startsWith("start_utc,source,country,region,city,")).toBe(true);
    expect(lines).toHaveLength(4);
    expect(text).not.toContain("Lone");
    expect(text).not.toContain("Evil");
    expect(text).not.toContain("Honolulu");
    expect(text).toContain("Lamka");
    expect(text).not.toContain("New Delhi");
  });
  it("is for the owner only", async () => {
    expect((await as("rev@example.org", "/review/api/visitors/export?range=7&what=table&dim=model")).status).toBe(403);
    expect((await as(null, "/review/api/visitors/export?range=7&what=table&dim=model")).status).toBe(401);
  });
  it("pivots two dimensions over the raw window", async () => {
    await seed();
    const p = await (await as(OWNER, "/review/api/visitors?range=7&part=pivot&dim=country&dim2=model")).json<{ rows: string[]; cols: string[]; cells: { r: string; c: string; visitors: number }[] }>();
    expect(p.rows).toEqual(["IN"]);
    expect(p.cols).toEqual(["SM-A1", ""]);
    expect(p.cells.find((c) => c.c === "SM-A1")!.visitors).toBe(2);
    expect((await as(OWNER, "/review/api/visitors?range=7&part=pivot&dim=country&dim2=country")).status).toBe(400);
  });
});

describe("the migration", () => {
  it("adds the new columns to events", async () => {
    const cols = (await env.DB.prepare("PRAGMA table_info(events)").all<{ name: string }>()).results.map((c) => c.name);
    for (const c of ["osv", "bv", "brand", "model", "isp", "lang", "tz", "vw", "dpr", "net", "theme", "scheme", "pwa", "ttfb", "load", "lcp", "inp", "cls", "scroll", "target"]) expect(cols).toContain(c);
  });
});
