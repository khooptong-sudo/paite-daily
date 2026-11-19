import { json, type Env } from "./types";

/**
 * The Visitors dashboard on /review (owner only): where people come from and what they do.
 *
 * Privacy, by design: no cookie, no third party, no IP address stored. A person is counted once a
 * day by a code made from the IP, the browser and a salt that changes every IST day and is deleted
 * after two, so nobody can be followed from one day to the next. A city is named only once two or
 * more visitors came from it; a lone visitor is shown by region. Raw events are kept 30 days, daily
 * totals (visit_stats) for good. Nothing here is ever joined to a contributor's phone id.
 */

export const IST = 330 * 60_000;
const DAY = 86_400_000;
const RAW_DAYS = 30;
export const CITY_MIN = 2;
const OWN_HOST = "paite.lamkalabs.com";
/** Things a visitor does, beyond reading. "card" (a sentence shown) is a funnel step, not an action. */
export const ACTIONS = ["answer", "chat", "ask", "play", "share", "install"] as const;

// ---------- small helpers ----------

export const istDay = (ms: number) => new Date(ms + IST).toISOString().slice(0, 10);
export const dayStart = (day: string) => Date.parse(`${day}T00:00:00Z`) - IST;
export const sqlTime = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace("T", " ");
const parseAt = (at: string) => Date.parse(at.replace(" ", "T") + "Z");
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------- reading a request ----------

export type Agent = { bot: boolean; device: "phone" | "tablet" | "desktop"; browser: string; os: string; inApp: string | null; osv: string; bv: string };

/** Hints a browser may send beyond its user agent, already checked: platform version and browser major. */
export type Hints = { pv?: string | null; bvh?: number | null };

/** Phone make from the model code a Chromium browser reports; iPhones are Apple, unknown codes are "Other". */
export function brandOf(model: string | null, os: string): string | null {
  if (os === "iOS") return "Apple";
  if (!model) return null;
  const m = model.trim();
  const table: [RegExp, string][] = [
    [/^(SM-|GT-|SC-|SCV|SGH|Galaxy)/i, "Samsung"], [/^(Pixel|Nexus)/i, "Google"],
    [/^(Redmi|POCO|Mi\b|M\d{4}[A-Z]\d|\d{5,7}[A-Z])/i, "Xiaomi"], [/^(CPH|OPPO|PG[A-Z]M|PH[A-Z]M)/i, "Oppo"],
    [/^(RMX|realme)/i, "Realme"], [/^(vivo|V\d{4}|I\d{4})/i, "Vivo"], [/^(ONEPLUS|(IN|KB|LE|NE|GM|HD)\d{4}$)/i, "OnePlus"],
    [/^(moto|XT\d)/i, "Motorola"], [/^(Nokia|TA-)/i, "Nokia"], [/^(HUAWEI|HONOR|[A-Z]{3}-[A-Z]{1,2}\d{2})/i, "Huawei"],
    [/^(Infinix|X\d{3,4}[A-Z]?$)/i, "Infinix"], [/^(TECNO|K[A-Z]\d|C[A-Z]\d)/i, "Tecno"], [/^(itel|Lava)/i, "Itel / Lava"],
  ];
  return table.find(([re]) => re.test(m))?.[1] ?? "Other";
}

/** A network's short name from Cloudflare's organisation string; names we do not know are tidied, never guessed. */
export function ispOf(org: unknown): string | null {
  if (typeof org !== "string") return null;
  const o = org.trim();
  if (!o) return null;
  if (/jio|reliance/i.test(o)) return "Reliance Jio";
  if (/airtel|bharti/i.test(o)) return "Bharti Airtel";
  if (/bsnl|bharat sanchar/i.test(o)) return "BSNL";
  if (/vodafone|idea cellular|\bvi\b/i.test(o)) return "Vodafone Idea";
  if (/act fibernet|atria convergence/i.test(o)) return "ACT Fibernet";
  const t = o.replace(/^AS\d+\s+/i, "").replace(/[,.]?\s+(pvt\.?|private|ltd\.?|limited|inc\.?|llc|corp(oration)?\.?|co\.?|gmbh)(\s+.*)?$/i, "").replace(/[^A-Za-z0-9 ._&+-]/g, "").trim().slice(0, 40);
  return t || null;
}

/** Device, browser and system (with major versions) from a user agent; bots are flagged so they are never counted. */
export function readAgent(ua: string, hints: Hints = {}): Agent {
  const bot = !ua || /bot|crawl|spider|slurp|headless|lighthouse|pagespeed|preview|facebookexternalhit|whatsapp\/|curl|wget|python|node-fetch|axios|go-http/i.test(ua);
  const tablet = /ipad|tablet/i.test(ua) || (/android/i.test(ua) && !/mobile/i.test(ua));
  const device = tablet ? "tablet" : /mobi|iphone|ipod|android/i.test(ua) ? "phone" : "desktop";
  const inApp = /FBAN|FBAV|FB_IAB|FBIOS/.test(ua) ? "Facebook" : /Instagram/.test(ua) ? "Instagram" : null;
  const browser = inApp ? `${inApp} app`
    : /Edg(e|A|iOS)?\//.test(ua) ? "Edge"
    : /SamsungBrowser/.test(ua) ? "Samsung Internet"
    : /OPR\/|Opera/.test(ua) ? "Opera"
    : /Firefox|FxiOS/.test(ua) ? "Firefox"
    : /CriOS|Chrome\//.test(ua) ? "Chrome"
    : /Safari\//.test(ua) ? "Safari" : "Other";
  const os = /android/i.test(ua) ? "Android" : /iphone|ipad|ipod/i.test(ua) ? "iOS" : /windows/i.test(ua) ? "Windows"
    : /CrOS/.test(ua) ? "ChromeOS" : /mac os x|macintosh/i.test(ua) ? "macOS" : /linux/i.test(ua) ? "Linux" : "Other";
  const major = (re: RegExp) => ua.match(re)?.[1] ?? null;
  const pv = hints.pv ? hints.pv.split(".")[0] : null;
  // A reduced user agent hides the real system version; the browser's own hint wins when it came.
  const sysV = os === "Android" ? (pv ?? major(/Android (\d+)/i))
    : os === "iOS" ? major(/OS (\d+)[_.]/)
    : os === "macOS" ? pv
    : os === "Windows" ? (pv ? (Number(pv) >= 13 ? "11" : "10") : null)
    : null;
  const osv = os === "Windows" && !pv ? (/Windows NT 10/.test(ua) ? "Windows 10/11" : "Windows") : sysV ? `${os} ${sysV}` : os;
  const bMajor = inApp ? null
    : browser === "Edge" ? major(/Edg(?:e|A|iOS)?\/(\d+)/) : browser === "Samsung Internet" ? major(/SamsungBrowser\/(\d+)/)
    : browser === "Opera" ? major(/OPR\/(\d+)/) : browser === "Firefox" ? major(/(?:Firefox|FxiOS)\/(\d+)/)
    : browser === "Chrome" ? major(/(?:Chrome|CriOS)\/(\d+)/) : browser === "Safari" ? major(/Version\/(\d+)/) : null;
  const bver = hints.bvh && ["Chrome", "Edge", "Opera", "Samsung Internet"].includes(browser) ? String(hints.bvh) : bMajor;
  return { bot, device, browser, os, inApp, osv, bv: bver ? `${browser} ${bver}` : browser };
}

const VIA: Record<string, string> = {
  wa: "WhatsApp", whatsapp: "WhatsApp", fb: "Facebook", facebook: "Facebook", ig: "Instagram", instagram: "Instagram",
  share: "Shared link", tg: "Telegram", telegram: "Telegram", yt: "YouTube", youtube: "YouTube", x: "X", twitter: "X",
  email: "Email", mail: "Email", qr: "QR code", app: "Paite Daily app",
};

/** A shared-link tag as stored: lower case, letters, digits, - and _, at most 24 characters. */
export function cleanVia(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase().slice(0, 24);
  return /^[a-z0-9_-]+$/.test(s) ? s : null;
}

/**
 * Where a visit came from. A link tag wins; then the referrer's host; a Facebook or Instagram
 * in-app browser with no referrer still counts as that app. null means the site itself (a move
 * between pages), which is never a source.
 */
export function sourceOf(ref: string | null, via: string | null, inApp: string | null = null): string | null {
  if (via) return VIA[via] ?? via.charAt(0).toUpperCase() + via.slice(1);
  const h = (ref ?? "").toLowerCase().replace(/^www\./, "");
  if (!h) return inApp ?? "Direct";
  if (h === OWN_HOST) return null;
  if (h === "com.lamkalabs.paitedaily") return "Paite Daily app";
  if (/(^|\.)whatsapp\.(com|net)$|^wa\.me$/.test(h)) return "WhatsApp";
  if (/(^|\.)facebook\.com$|^fb\.(com|me)$|^com\.facebook\./.test(h)) return "Facebook";
  if (/(^|\.)instagram\.com$|^com\.instagram\./.test(h)) return "Instagram";
  if (h === "gemini.google.com") return "Gemini";
  if (h === "com.google.android.gm" || /(^|\.)mail\.google\.com$/.test(h)) return "Email";
  if (/(^|\.)google\.[a-z.]+$|^com\.google\.android\.googlequicksearchbox$/.test(h)) return "Google";
  if (/(^|\.)bing\.com$/.test(h)) return "Bing";
  if (/(^|\.)duckduckgo\.com$/.test(h)) return "DuckDuckGo";
  if (/^(t\.co|twitter\.com|x\.com)$/.test(h)) return "X";
  if (/(^|\.)youtube\.com$|^youtu\.be$/.test(h)) return "YouTube";
  if (/^t\.me$|(^|\.)telegram\.org$/.test(h)) return "Telegram";
  if (/(^|\.)chatgpt\.com$|^chat\.openai\.com$/.test(h)) return "ChatGPT";
  if (/(^|\.)perplexity\.ai$/.test(h)) return "Perplexity";
  if (h === "claude.ai") return "Claude";
  if (h === "github.com") return "GitHub";
  if (h === "huggingface.co") return "Hugging Face";
  if (/(^|\.)zenodo\.org$/.test(h)) return "Zenodo";
  return h;
}

// The day's salt, created on first use. Cached per isolate for the day it belongs to.
let salted: { day: string; salt: string } | null = null;
async function saltFor(env: Env, day: string): Promise<string> {
  if (salted?.day === day) return salted.salt;
  const fresh = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
  await env.DB.prepare("INSERT OR IGNORE INTO visit_salts (day, salt) VALUES (?1, ?2)").bind(day, fresh).run();
  const row = await env.DB.prepare("SELECT salt FROM visit_salts WHERE day = ?1").bind(day).first<{ salt: string }>();
  salted = { day, salt: row?.salt ?? fresh };
  return salted.salt;
}
export const forgetSalt = () => { salted = null; };

/** Today's visitor code for this request: changes every IST day, and the IP is never kept. */
export async function visitorCode(env: Env, ip: string, ua: string, now: number): Promise<string> {
  return (await sha256Hex(`${await saltFor(env, istDay(now))}|${ip}|${ua}`)).slice(0, 16);
}

/** Cloudflare's location for a request; the codes for Tor and unknown become null. */
export function placeOf(req: Request): { country: string | null; region: string | null; city: string | null } {
  const cf = (req as Request & { cf?: { country?: string; region?: string; city?: string } }).cf;
  const c = typeof cf?.country === "string" && /^[A-Z]{2}$/.test(cf.country) && cf.country !== "XX" && cf.country !== "T1" ? cf.country : null;
  const t = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 60) : null);
  return { country: c, region: c ? t(cf?.region) : null, city: c ? t(cf?.city) : null };
}

// ---------- turning events into numbers ----------

type Ev = {
  id: number; at: string; kind: string; path: string; vid: string | null; visitor: string | null; device: string | null;
  ref: string | null; via: string | null; country: string | null; region: string | null; city: string | null;
  browser: string | null; os: string | null; revisit: number | null; ms: number | null;
  osv: string | null; bv: string | null; brand: string | null; model: string | null; isp: string | null; lang: string | null; tz: string | null;
  vw: string | null; dpr: string | null; net: string | null; theme: string | null; scheme: string | null; pwa: number | null;
  ttfb: number | null; load: number | null; lcp: number | null; inp: number | null; cls: number | null; scroll: number | null; target: string | null;
};
// Text columns of a visit that come from the first page beacon, and the speed numbers of a page's 'leave'.
const TECH = ["osv", "bv", "brand", "model", "isp", "lang", "tz", "vw", "dpr", "net", "theme", "scheme"] as const;
const VITALS = ["lcp", "inp", "cls", "ttfb", "load"] as const;
const COLS = `id, at, kind, path, vid, visitor, device, ref, via, country, region, city, browser, os, revisit, ms, ${TECH.join(", ")}, pwa, ttfb, "load", lcp, inp, cls, scroll, target`;

export type Visit = {
  key: string; visitor: string; source: string; country: string; region: string; city: string;
  device: string; browser: string; os: string; returning: number | null;
  osv: string; bv: string; brand: string; model: string; isp: string; lang: string; tz: string; vw: string; dpr: string; net: string; theme: string; scheme: string; pwa: number | null;
  /** Speed and scroll depth of each page, from its 'leave'. */
  perf: { path: string; scroll: number | null; lcp: number | null; inp: number | null; cls: number | null; ttfb: number | null; load: number | null }[];
  outs: string[]; errors: { path: string; text: string }[];
  t0: number; t1: number; pages: string[]; kinds: Map<string, number>; leaveMs: Map<string, number>; ms: number; bounce: boolean; events: Ev[];
};

/** Group events (in id order) into visits: one visit is one browser tab's run of events. */
export function toVisits(events: Ev[]): Visit[] {
  const by = new Map<string, Visit>();
  for (const e of events) {
    const key = e.vid ?? `e${e.id}`;
    let v = by.get(key);
    const t = parseAt(e.at);
    if (!v) {
      // The first event of a visit carries where it came from and where it is.
      v = {
        key, visitor: e.visitor ?? e.vid ?? `e${e.id}`,
        source: sourceOf(e.ref, e.via, /app$/.test(e.browser ?? "") ? (e.browser ?? "").replace(/ app$/, "") : null) ?? "Direct",
        country: e.country ?? "", region: e.region ?? "", city: e.city ?? "",
        device: e.device ?? "Unknown", browser: e.browser ?? "Unknown", os: e.os ?? "Unknown", returning: e.revisit,
        osv: "", bv: "", brand: "", model: "", isp: "", lang: "", tz: "", vw: "", dpr: "", net: "", theme: "", scheme: "", pwa: null,
        perf: [], outs: [], errors: [],
        t0: t, t1: t, pages: [], kinds: new Map(), leaveMs: new Map(), ms: 0, bounce: true, events: [],
      };
      by.set(key, v);
    }
    // What the first beacon knew; a later page beacon fills in anything the first one lacked.
    for (const k of TECH) if (!v[k] && e[k]) v[k] = e[k]!;
    if (v.pwa === null && e.pwa !== null && e.pwa !== undefined) v.pwa = e.pwa;
    v.t1 = Math.max(v.t1, t);
    v.events.push(e);
    if (e.kind === "page") v.pages.push(e.path || "/");
    else if (e.kind === "leave") {
      const ms = Math.max(0, Math.min(e.ms ?? 0, 30 * 60_000));
      v.ms += ms;
      v.leaveMs.set(e.path || "/", (v.leaveMs.get(e.path || "/") ?? 0) + ms);
      v.perf.push({ path: e.path || "/", scroll: e.scroll, lcp: e.lcp, inp: e.inp, cls: e.cls, ttfb: e.ttfb, load: e.load });
    } else if (e.kind === "out") { if (e.target) v.outs.push(e.target); }
    else if (e.kind === "jserror") { if (e.target) v.errors.push({ path: e.path || "/", text: e.target }); }
    else v.kinds.set(e.kind, (v.kinds.get(e.kind) ?? 0) + 1);
  }
  for (const v of by.values()) {
    if (!v.ms) v.ms = Math.min(v.t1 - v.t0, 30 * 60_000);
    v.bounce = v.pages.length <= 1 && !ACTIONS.some((a) => v.kinds.has(a));
  }
  return [...by.values()];
}

export type Row = { dim: string; key: string; visitors: number; visits: number; hits: number; bounces: number; ms: number };

// ---------- buckets ----------

export type Vital = (typeof VITALS)[number];
/** Upper edges of each speed bucket (cls is x1000). Google's good / poor limits sit on edges, so a bucket is one rating. */
export const VITAL_EDGES: Record<Vital, number[]> = {
  lcp: [1000, 1500, 2000, 2500, 3000, 4000, 6000, 10000], inp: [50, 100, 200, 350, 500, 800],
  cls: [25, 50, 100, 175, 250, 500], ttfb: [200, 400, 800, 1200, 1800, 3000], load: [1000, 2000, 3000, 5000, 8000],
};
/** Good up to the first number, poor above the second (load has no Google limit; these are plain ones). */
export const VITAL_LIMITS: Record<Vital, [number, number]> = { lcp: [2500, 4000], inp: [200, 500], cls: [100, 250], ttfb: [800, 1800], load: [3000, 5000] };
/** "2000-2500" means above 2000 and up to 2500; "10000+" is anything above the last edge. */
export function vitalBucket(metric: Vital, v: number): string {
  let lo = 0;
  for (const x of VITAL_EDGES[metric]) { if (v <= x) return `${lo}-${x}`; lo = x; }
  return `${lo}+`;
}
const bucketUpper = (key: string) => (key.endsWith("+") ? Infinity : Number(key.split("-")[1]));
export function vitalRating(metric: Vital, key: string): "good" | "needs" | "poor" {
  const up = bucketUpper(key), [good, poor] = VITAL_LIMITS[metric];
  return up <= good ? "good" : up <= poor ? "needs" : "poor";
}
/** The 75th percentile, as the upper edge of the bucket that holds it. "About": the buckets are coarse. */
export function p75(metric: Vital, hist: { key: string; n: number }[]): number | null {
  const total = hist.reduce((s, h) => s + h.n, 0);
  if (!total) return null;
  const sorted = [...hist].sort((a, b) => bucketUpper(a.key) - bucketUpper(b.key));
  let cum = 0;
  for (const h of sorted) {
    cum += h.n;
    if (cum >= total * 0.75) return Number.isFinite(bucketUpper(h.key)) ? bucketUpper(h.key) : VITAL_EDGES[metric][VITAL_EDGES[metric].length - 1];
  }
  return null;
}
export const depthBucket = (n: number) => (n <= 3 ? String(n) : n <= 5 ? "4-5" : n <= 9 ? "6-9" : "10+");
export const dwellBucket = (ms: number) => (ms < 10_000 ? "<10s" : ms < 30_000 ? "10-30s" : ms < 60_000 ? "30s-1m" : ms < 180_000 ? "1-3m" : ms < 600_000 ? "3-10m" : "10m+");
export const scrollBucket = (p: number) => (p < 25 ? "0-24" : p < 50 ? "25-49" : p < 75 ? "50-74" : p < 100 ? "75-99" : "100");
export const VW_BUCKETS = ["<360", "360-389", "390-419", "420-599", "600-899", "900-1279", "1280+"];
/** The natural order of bucketed dimensions, for lists that are histograms. */
export const ORDER: Record<string, string[]> = {
  depth: ["1", "2", "3", "4-5", "6-9", "10+"], dwell: ["<10s", "10-30s", "30s-1m", "1-3m", "3-10m", "10m+"],
  scroll: ["0-24", "25-49", "50-74", "75-99", "100"], vw: VW_BUCKETS, dpr: ["1x", "2x", "3x"],
  hour: Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0")),
};
// Where a visitor's time zone is the expected one for their country; only the countries worth checking.
const TZ_OF: Record<string, RegExp> = {
  IN: /^Asia\/(Kolkata|Calcutta)$/, MM: /^Asia\/(Yangon|Rangoon)$/, BD: /^Asia\/Dhaka$/, NP: /^Asia\/(Kathmandu|Katmandu)$/,
  US: /^(America|Pacific)\//, CA: /^America\//, GB: /^Europe\/London$/, AU: /^Australia\//, SG: /^Asia\/Singapore$/, AE: /^Asia\/Dubai$/,
};

/** The keys a visit has in one dimension (the same keys the totals use). A visit may have several (pages, actions). */
export function keysOf(v: Visit, dim: string): string[] {
  const one = (x: string | number | null | undefined) => (x === null || x === undefined || x === "" ? [] : [String(x)]);
  switch (dim) {
    case "source": return [v.source];
    case "country": return [v.country];
    case "region": return v.region ? [`${v.country}|${v.region}`] : [];
    case "city": return v.city ? [`${v.country}|${v.region}|${v.city}`] : [];
    case "device": return [v.device];
    case "browser": return [v.browser];
    case "os": return [v.os];
    case "returning": return [v.returning === null ? "?" : String(v.returning)];
    case "hour": return [String(new Date(v.t0 + IST).getUTCHours()).padStart(2, "0")];
    case "entry": return v.pages.length ? [v.pages[0]] : [];
    case "exit": return v.pages.length ? [v.pages[v.pages.length - 1]] : [];
    case "page": return [...new Set(v.pages)];
    case "kind": return [...v.kinds.keys()];
    case "depth": return v.pages.length ? [depthBucket(v.pages.length)] : [];
    case "dwell": return [dwellBucket(v.ms)];
    case "pwa": return one(v.pwa);
    case "tzcheck": return v.tz && TZ_OF[v.country] ? [TZ_OF[v.country].test(v.tz) ? "same" : "differs"] : [];
    default: return (TECH as readonly string[]).includes(dim) ? one(v[dim as (typeof TECH)[number]]) : [];
  }
}
const PER_VISIT = ["source", "country", "region", "city", "device", "browser", "os", "returning", "hour", ...TECH, "pwa", "depth", "dwell", "tzcheck"];

/** Every dimension's totals for a set of visits. Visitors are distinct codes within the set. */
export function summarise(visits: Visit[]): Row[] {
  const acc = new Map<string, { dim: string; key: string; who: Set<string>; visits: number; hits: number; bounces: number; ms: number }>();
  const add = (dim: string, key: string, v: Visit, hits: number, ms: number, bounce = v.bounce) => {
    const k = `${dim}\u0000${key}`;
    let a = acc.get(k);
    if (!a) acc.set(k, (a = { dim, key, who: new Set(), visits: 0, hits: 0, bounces: 0, ms: 0 }));
    a.who.add(v.visitor); a.visits++; a.hits += hits; a.ms += ms; if (bounce) a.bounces++;
  };
  const pageViews = new Map<string, number>();
  const speed: { v: Visit; page: string; metric: Vital; bucket: string }[] = [];
  for (const v of visits) {
    const views = v.pages.length;
    add("all", "", v, views, v.ms);
    for (const dim of PER_VISIT) for (const key of keysOf(v, dim)) add(dim, key, v, views, v.ms);
    if (views) {
      add("entry", v.pages[0], v, 1, 0);
      add("exit", v.pages[views - 1], v, 1, 0);
      const seen = new Map<string, number>();
      for (const p of v.pages) { seen.set(p, (seen.get(p) ?? 0) + 1); pageViews.set(p, (pageViews.get(p) ?? 0) + 1); }
      for (const [p, n] of seen) add("page", p, v, n, v.leaveMs.get(p) ?? 0, v.bounce && v.pages[0] === p);
      for (let i = 1; i < views; i++) if (v.pages[i] !== v.pages[i - 1]) add("flow", `${v.pages[i - 1]}>${v.pages[i]}`, v, 1, 0, false);
    }
    for (const [k, n] of v.kinds) add("kind", k, v, n, 0, false);
    for (const t of v.outs) add("out", t, v, 1, 0, false);
    for (const e of v.errors) add("jserror", `${e.path}|${e.text}`, v, 1, 0, false);
    for (const p of v.perf) {
      if (p.scroll !== null) add("scroll", scrollBucket(p.scroll), v, 1, 0, false);
      for (const metric of VITALS) {
        const x = p[metric];
        if (x === null || x === undefined) continue;
        const bucket = vitalBucket(metric, x);
        add(metric, bucket, v, 1, 0, false);
        add("vitals_dev", `${v.device}|${metric}|${bucket}`, v, 1, 0, false);
        speed.push({ v, page: p.path, metric, bucket });
      }
    }
  }
  // Speed by page, for the ten most viewed pages only.
  const top = new Set([...pageViews].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 10).map((p) => p[0]));
  for (const s of speed) if (top.has(s.page)) add("vitals_page", `${s.page}|${s.metric}|${s.bucket}`, s.v, 1, 0, false);
  return [...acc.values()].map((a) => ({ dim: a.dim, key: a.key, visitors: a.who.size, visits: a.visits, hits: a.hits, bounces: a.bounces, ms: a.ms }));
}

async function eventsBetween(env: Env, from: number, to: number): Promise<Ev[]> {
  const { results } = await env.DB.prepare(`SELECT ${COLS} FROM events WHERE at >= ?1 AND at < ?2 ORDER BY id`).bind(sqlTime(from), sqlTime(to)).all<Ev>();
  return results;
}

/** Totals for a time window, straight from the raw events. */
export async function windowRows(env: Env, from: number, to: number): Promise<Row[]> {
  return summarise(toVisits(await eventsBetween(env, from, to)));
}

/** Store one complete IST day's totals. The ('all','') row is written even for an empty day. */
async function rollDay(env: Env, day: string): Promise<void> {
  const rows = await windowRows(env, dayStart(day), dayStart(day) + DAY);
  if (!rows.some((r) => r.dim === "all")) rows.push({ dim: "all", key: "", visitors: 0, visits: 0, hits: 0, bounces: 0, ms: 0 });
  const ins = env.DB.prepare("INSERT OR REPLACE INTO visit_stats (day, dim, key, visitors, visits, hits, bounces, ms) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)");
  const stmts = [env.DB.prepare("DELETE FROM visit_stats WHERE day = ?1").bind(day), ...rows.map((r) => ins.bind(day, r.dim, r.key, r.visitors, r.visits, r.hits, r.bounces, r.ms))];
  for (let i = 0; i < stmts.length; i += 100) await env.DB.batch(stmts.slice(i, i + 100));
}

/** Roll every complete day still held in raw events that has no totals yet. Returns the days rolled. */
export async function ensureRolled(env: Env, now: number): Promise<string[]> {
  const today = istDay(now), first = addDays(today, -RAW_DAYS);
  const { results } = await env.DB.prepare("SELECT day FROM visit_stats WHERE dim = 'all' AND day >= ?1").bind(first).all<{ day: string }>();
  const have = new Set(results.map((r) => r.day));
  const oldest = await env.DB.prepare("SELECT min(at) AS at FROM events").first<{ at: string | null }>();
  if (!oldest?.at) return [];
  const start = istDay(parseAt(oldest.at)) > first ? istDay(parseAt(oldest.at)) : first;
  const rolled: string[] = [];
  for (let d = start; d < today; d = addDays(d, 1)) if (!have.has(d)) { await rollDay(env, d); rolled.push(d); }
  return rolled;
}

/** Nightly: roll the finished days, then drop raw events past 30 days and salts past two. */
export async function runVisitorRollup(env: Env, now: number): Promise<{ rolled: number; deleted: number } | null> {
  const rolled = await ensureRolled(env, now);
  const del = await env.DB.prepare("DELETE FROM events WHERE at < ?1").bind(sqlTime(dayStart(addDays(istDay(now), -RAW_DAYS - 1)))).run();
  await env.DB.prepare("DELETE FROM visit_salts WHERE day < ?1").bind(addDays(istDay(now), -1)).run();
  const deleted = del.meta.changes ?? 0;
  return rolled.length || deleted ? { rolled: rolled.length, deleted } : null;
}

// ---------- the dashboard ----------

type Totals = { visitors: number; visits: number; pageviews: number; bounceRate: number; avgMs: number; actions: number };
type Point = { key: string; visitors: number; visits: number; pageviews: number; actions: number; bounceRate: number; avgMs: number };

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : 0);
function merge(rows: Row[]): Map<string, Row> {
  const m = new Map<string, Row>();
  for (const r of rows) {
    const k = `${r.dim}\u0000${r.key}`, a = m.get(k);
    if (a) { a.visitors += r.visitors; a.visits += r.visits; a.hits += r.hits; a.bounces += r.bounces; a.ms += r.ms; }
    else m.set(k, { ...r });
  }
  return m;
}
function totalsOf(m: Map<string, Row>): Totals {
  const all = m.get("all\u0000") ?? { visitors: 0, visits: 0, hits: 0, bounces: 0, ms: 0 };
  let actions = 0;
  for (const r of m.values()) if (r.dim === "kind" && (ACTIONS as readonly string[]).includes(r.key)) actions += r.hits;
  return { visitors: all.visitors, visits: all.visits, pageviews: all.hits, bounceRate: pct(all.bounces, all.visits), avgMs: all.visits ? Math.round(all.ms / all.visits) : 0, actions };
}
const pointOf = (key: string, rows: Row[]): Point => ({ key, ...totalsOf(merge(rows)) });

type Item = { key: string; visitors: number; visits: number; hits: number; share: number; bounceRate: number; avgMs: number };
function list(m: Map<string, Row>, dim: string, by: "visitors" | "visits" | "hits" = "visitors", limit = 12): Item[] {
  const rows = [...m.values()].filter((r) => r.dim === dim);
  const total = rows.reduce((s, r) => s + r[by], 0);
  return rows.sort((a, b) => b[by] - a[by] || a.key.localeCompare(b.key)).slice(0, limit).map((r) => ({
    key: r.key, visitors: r.visitors, visits: r.visits, hits: r.hits, share: pct(r[by], total),
    bounceRate: pct(r.bounces, r.visits), avgMs: dim === "page" ? (r.hits ? Math.round(r.ms / r.hits) : 0) : (r.visits ? Math.round(r.ms / r.visits) : 0),
  }));
}

/** Values shared by fewer than CITY_MIN visitors (a city, a phone model, a network, a time zone) are folded into one unnamed row. */
function foldRare(m: Map<string, Row>, dim: string, limit = 12): Item[] {
  const all = list(m, dim, "visitors", 100000);
  const named = all.filter((c) => c.visitors >= CITY_MIN).slice(0, limit);
  const rest = all.filter((c) => !named.includes(c));
  if (rest.length) {
    const r = rest.reduce((s, c) => ({ visitors: s.visitors + c.visitors, visits: s.visits + c.visits, hits: s.hits + c.hits, share: s.share + c.share }), { visitors: 0, visits: 0, hits: 0, share: 0 });
    named.push({ key: "", visitors: r.visitors, visits: r.visits, hits: r.hits, share: Math.round(r.share * 10) / 10, bounceRate: 0, avgMs: 0 });
  }
  return named;
}
const cities = (m: Map<string, Row>) => foldRare(m, "city");
/** Dimensions where a value seen by one visitor is never named. */
export const RARE = ["city", "model", "isp", "tz"];

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const fmtDay = (d: string) => `${WEEKDAY[new Date(`${d}T00:00:00Z`).getUTCDay()]} ${Number(d.slice(8))} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(d.slice(5, 7)) - 1]}`;
const PAGE_NAMES: Record<string, string> = { "/": "the front page", "/proverbs": "Pau Upa", "/same-opposite": "Same & Opposite", "/glossary": "the word list", "/contributors": "Panlate", "/about": "About", "/rules": "the spelling rules", "/places": "Places", "/wiki": "the Paite Wiki" };
const pageName = (p: string) => PAGE_NAMES[p] ?? p;

/** A few plain-English lines worked out from the numbers. No model: every figure is exact. */
export function insights(t: Totals, prev: Totals | null, m: Map<string, Row>, series: Point[], ranged: boolean, label: string): { tone: "up" | "down" | "info"; text: string }[] {
  const out: { tone: "up" | "down" | "info"; text: string }[] = [];
  if (prev && prev.visitors >= 5 && t.visitors) {
    const ch = Math.round(((t.visitors - prev.visitors) / prev.visitors) * 100);
    if (Math.abs(ch) >= 5) out.push({ tone: ch > 0 ? "up" : "down", text: `Visitors are ${ch > 0 ? "up" : "down"} ${Math.abs(ch)}% on the ${label} before (${t.visitors.toLocaleString("en-IN")} against ${prev.visitors.toLocaleString("en-IN")}).` });
    else out.push({ tone: "info", text: `Visitors are steady against the ${label} before (${t.visitors.toLocaleString("en-IN")} against ${prev.visitors.toLocaleString("en-IN")}).` });
  }
  const src = list(m, "source", "visits", 50);
  const top = src.find((s) => s.key !== "Direct");
  const direct = src.find((s) => s.key === "Direct");
  if (direct && direct.share >= 50) out.push({ tone: "info", text: `${Math.round(direct.share)}% of visits arrive with no referrer. WhatsApp and the app hide where a link was opened; links shared from the site now carry a tag, so WhatsApp shows by name.` });
  if (top && top.visits >= 3) out.push({ tone: "up", text: `${top.key} is the biggest named source: ${Math.round(top.share)}% of visits, ${top.visits.toLocaleString("en-IN")} in all.` });
  if (ranged && series.length > 2) {
    const best = series.reduce((a, b) => (b.visitors > a.visitors ? b : a));
    if (best.visitors) out.push({ tone: "info", text: `Busiest day: ${fmtDay(best.key)}, with ${best.visitors.toLocaleString("en-IN")} visitors.` });
  }
  const hours = list(m, "hour", "visits", 24);
  if (hours.length && hours[0].visits >= 5) out.push({ tone: "info", text: `Most visits start around ${hours[0].key}:00 India time.` });
  const leaky = list(m, "page", "visits", 100).filter((p) => p.visits >= 20)
    .map((p) => ({ p, exit: (m.get(`exit\u0000${p.key}`)?.visits ?? 0) / p.visits })).sort((a, b) => b.exit - a.exit)[0];
  if (leaky && leaky.exit >= 0.5) out.push({ tone: "down", text: `${Math.round(leaky.exit * 100)}% of visits that open ${pageName(leaky.p.key)} end there.` });
  const card = m.get("kind\u0000card")?.visits ?? 0, ans = m.get("kind\u0000answer")?.visits ?? 0;
  if (card >= 10) out.push({ tone: ans / card >= 0.3 ? "up" : "info", text: `${Math.round((ans / card) * 100)}% of visits that see a sentence go on to send an answer.` });
  const back = m.get("returning\u00001")?.visits ?? 0, fresh = m.get("returning\u00000")?.visits ?? 0;
  if (back + fresh >= 10) out.push({ tone: "info", text: `${Math.round((back / (back + fresh)) * 100)}% of visits are from people who have been here before.` });
  return out.slice(0, 6);
}

export type Range = "today" | "7" | "30" | "90" | "custom";
export type Gran = "hour" | "day" | "week";
export type Filter = { dim: string; key: string };
export type Query = { range: Range; from: string; to: string; filters: Filter[]; g: Gran };
/** The dimensions a view can be narrowed by (a visit matches when it has the value). */
export const FILTER_DIMS = ["source", "country", "region", "city", "device", "browser", "bv", "os", "osv", "brand", "model", "isp", "lang", "tz", "vw", "dpr", "net", "theme", "scheme", "pwa", "returning", "entry", "page", "hour", "kind"];
const PIVOT_DIMS = [...PER_VISIT, "entry", "exit", "page", "kind"];
/** Thrown when a view needs the raw events (filters, pivots, visit lists) but the window reaches past 30 days. */
export class NeedRaw extends Error {}

const HH = (i: number) => String(i).padStart(2, "0");
const isDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
const weekStart = (d: string) => addDays(d, -((new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7));
const daysIn = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY) + 1;

/** Read ?range=&from=&to=&f=dim:key&g= . null means the request is malformed. */
export function parseQuery(p: URLSearchParams, now: number): Query | null {
  const today = istDay(now);
  const r = p.get("range") ?? (p.has("from") ? "custom" : "7");
  let from: string, to: string;
  if (r === "custom") {
    from = p.get("from") ?? ""; to = p.get("to") ?? today;
    if (!isDay(from) || !isDay(to) || from < addDays(today, -365)) return null;
    if (to > today) to = today;
    if (from > to) return null;
  } else if (["today", "7", "30", "90"].includes(r)) {
    from = addDays(today, -((r === "today" ? 1 : Number(r)) - 1)); to = today;
  } else return null;
  const filters: Filter[] = [];
  for (const f of p.getAll("f")) {
    const i = f.indexOf(":"), dim = f.slice(0, i), key = f.slice(i + 1);
    if (i < 1 || !FILTER_DIMS.includes(dim) || key.length > 200) return null;
    if (key || dim === "country") filters.push({ dim, key });
  }
  if (filters.length > 20) return null;
  const n = daysIn(from, to);
  const g = p.get("g") ?? (n === 1 ? "hour" : "day");
  if (g !== "hour" && g !== "day" && g !== "week") return null;
  if (g === "hour" && n > 2) return null;
  return { range: r as Range, from, to, filters, g };
}

/** AND across dimensions, OR within one dimension. */
function matches(v: Visit, fs: Filter[]): boolean {
  const by = new Map<string, string[]>();
  for (const f of fs) (by.get(f.dim) ?? by.set(f.dim, []).get(f.dim)!).push(f.key);
  for (const [dim, keys] of by) { const have = keysOf(v, dim); if (!keys.some((k) => have.includes(k))) return false; }
  return true;
}

function bucketKeys(from: string, to: string, g: Gran, n: number, now: number | null): string[] {
  const days: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  if (g === "day") return days;
  if (g === "week") return [...new Set(days.map(weekStart))];
  const keys: string[] = [];
  for (const d of days) for (let h = 0; h < 24; h++) if (now === null || dayStart(d) + h * 3_600_000 <= now) keys.push(n === 1 ? HH(h) : `${d} ${HH(h)}`);
  return keys;
}
function keyOfTime(t: number, g: Gran, n: number): string {
  const d = istDay(t);
  return g === "day" ? d : g === "week" ? weekStart(d) : n === 1 ? HH(new Date(t + IST).getUTCHours()) : `${d} ${HH(new Date(t + IST).getUTCHours())}`;
}

type Built = {
  q: Query; n: number; today: string; m: Map<string, Row>; prevM: Map<string, Row> | null; series: Point[]; prevSeries: Point[];
  heat: number[][] | null; label: string; visits: Visit[] | null; pool: Visit[] | null;
};

/** Totals for a query. Without filters they come from the stored daily totals (and today's raw events); with filters, or when raw visits are asked for, from the raw events of the last 30 days. */
async function build(env: Env, q: Query, now: number, needRaw = false): Promise<Built> {
  const today = istDay(now), { from, to, g } = q, n = daysIn(from, to);
  const prevFrom = addDays(from, -n), prevTo = addDays(to, -n), rawStart = addDays(today, -RAW_DAYS);
  const label = n === 1 && to === today ? "same time yesterday" : n === 1 ? "day" : `${n} days`;
  const keys = bucketKeys(from, to, g, n, to === today ? now : null), prevKeys = bucketKeys(prevFrom, prevTo, g, n, null);
  if (q.filters.length || needRaw || q.range === "today") {
    if (from < rawStart) throw new NeedRaw();
    const pool = toVisits(await eventsBetween(env, dayStart(from), Math.min(dayStart(to) + DAY, now + 1)));
    const visits = q.filters.length ? pool.filter((v) => matches(v, q.filters)) : pool;
    let prevVisits: Visit[] = [];
    if (prevFrom >= rawStart) {
      const end = n === 1 && to === today ? now + 1 - DAY : dayStart(from);
      prevVisits = toVisits(await eventsBetween(env, dayStart(prevFrom), end)).filter((v) => matches(v, q.filters));
    }
    const group = (vs: Visit[]) => { const mp = new Map<string, Visit[]>(); for (const v of vs) { const k = keyOfTime(v.t0, g, n); (mp.get(k) ?? mp.set(k, []).get(k)!).push(v); } return mp; };
    const cur = group(visits), was = group(prevVisits);
    let heat: number[][] | null = null;
    if (n > 1) {
      heat = Array.from({ length: 7 }, () => Array(24).fill(0));
      for (const v of visits) { const x = new Date(v.t0 + IST); heat[(x.getUTCDay() + 6) % 7][x.getUTCHours()]++; }
    }
    return {
      q, n, today, m: merge(summarise(visits)), prevM: prevVisits.length ? merge(summarise(prevVisits)) : null, heat, label, visits, pool,
      series: keys.map((k) => pointOf(k, summarise(cur.get(k) ?? []))), prevSeries: prevKeys.map((k) => pointOf(k, summarise(was.get(k) ?? []))),
    };
  }
  await ensureRolled(env, now);
  const stored = (await env.DB.prepare("SELECT day, dim, key, visitors, visits, hits, bounces, ms FROM visit_stats WHERE day >= ?1 AND day <= ?2 AND day < ?3")
    .bind(from, to, today).all<Row & { day: string }>()).results;
  const live = to >= today ? await windowRows(env, dayStart(today), now + 1) : [];
  const prev = (await env.DB.prepare("SELECT day, dim, key, visitors, visits, hits, bounces, ms FROM visit_stats WHERE day >= ?1 AND day <= ?2 AND dim IN ('all', 'kind', 'hour')")
    .bind(prevFrom, prevTo).all<Row & { day: string }>()).results;
  const byDay = new Map<string, Row[]>(), prevByDay = new Map<string, Row[]>();
  for (const r of stored) (byDay.get(r.day) ?? byDay.set(r.day, []).get(r.day)!).push(r);
  if (live.length) byDay.set(today, live);
  for (const r of prev) (prevByDay.get(r.day) ?? prevByDay.set(r.day, []).get(r.day)!).push(r);
  const heat: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const [d, rs] of byDay) {
    const wd = (new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7;
    for (const r of rs) if (r.dim === "hour") heat[wd][Number(r.key)] += r.visits;
  }
  const seriesOf = (ks: string[], days: Map<string, Row[]>, first: string): Point[] => {
    if (g === "hour") return ks.map((k) => {
      const r = (days.get(n === 1 ? first : k.slice(0, 10)) ?? []).find((x) => x.dim === "hour" && x.key === k.slice(-2));
      return { key: k, visitors: r?.visitors ?? 0, visits: r?.visits ?? 0, pageviews: r?.hits ?? 0, actions: 0, bounceRate: r ? pct(r.bounces, r.visits) : 0, avgMs: r?.visits ? Math.round(r.ms / r.visits) : 0 };
    });
    const by = new Map<string, Row[]>();
    for (const [d, rs] of days) { const k = g === "week" ? weekStart(d) : d; const a = by.get(k) ?? by.set(k, []).get(k)!; for (const r of rs) a.push(r); }
    return ks.map((k) => pointOf(k, by.get(k) ?? []));
  };
  return {
    q, n, today, m: merge([...stored, ...live]), prevM: prev.some((r) => r.dim === "all" && r.visits > 0) ? merge(prev) : null, heat, label, visits: null, pool: null,
    series: seriesOf(keys, byDay, from), prevSeries: seriesOf(prevKeys, prevByDay, prevFrom),
  };
}

/** Dimensions shown in the Technology and Network cards, sent with the main view. */
const CARD_DIMS = ["osv", "bv", "brand", "model", "vw", "dpr", "theme", "scheme", "pwa", "net", "isp", "lang", "tz", "tzcheck"];
/** Everything the explorer can tabulate. */
const DETAIL_DIMS = ["source", "country", "region", "city", "device", "browser", "os", ...CARD_DIMS, "returning", "hour", "entry", "exit", "page", "kind", "depth", "dwell", "scroll", "lcp", "inp", "cls", "ttfb", "load", "out", "jserror", "flow"];

/** One dimension's rows: rare values folded away, histograms in their natural order. */
function detailList(m: Map<string, Row>, dim: string, limit = 60): Item[] {
  if (RARE.includes(dim)) return foldRare(m, dim, limit);
  const vital = (VITALS as readonly string[]).includes(dim);
  if (ORDER[dim] || vital) {
    const order = ORDER[dim] ?? [];
    const rank = (k: string) => (vital ? bucketUpper(k) : order.indexOf(k) < 0 ? 99 : order.indexOf(k));
    return list(m, dim, dim === "scroll" || vital ? "hits" : "visitors", 1000).sort((a, b) => rank(a.key) - rank(b.key));
  }
  return list(m, dim, ["page", "flow", "out", "jserror"].includes(dim) ? "hits" : "visitors", limit);
}

type Hist = { key: string; n: number }[];
const histOf = (m: Map<string, Row>, dim: string): Hist => [...m.values()].filter((r) => r.dim === dim).map((r) => ({ key: r.key, n: r.hits }));
/** p75 and the good / needs work / poor split for each speed measure, in all, by device and for the slowest pages. */
function speedOf(m: Map<string, Row>) {
  const split = (metric: Vital, hist: Hist) => {
    const n = hist.reduce((s, h) => s + h.n, 0);
    const part = (r: string) => pct(hist.filter((h) => vitalRating(metric, h.key) === r).reduce((s, h) => s + h.n, 0), n);
    return { n, p75: p75(metric, hist), good: part("good"), needs: part("needs"), poor: part("poor") };
  };
  const dev = histOf(m, "vitals_dev").map((h) => { const [d, metric, bucket] = h.key.split("|"); return { d, metric, key: bucket, n: h.n }; });
  const pages = histOf(m, "vitals_page").map((h) => { const [page, metric, bucket] = h.key.split("|"); return { page, metric, key: bucket, n: h.n }; });
  const out: Record<string, unknown> = {};
  for (const metric of VITALS) {
    const byDevice: Record<string, unknown> = {};
    for (const d of ["phone", "tablet", "desktop"]) {
      const hist = dev.filter((x) => x.d === d && x.metric === metric);
      if (hist.length) byDevice[d] = split(metric, hist);
    }
    out[metric] = { ...split(metric, histOf(m, metric)), byDevice };
  }
  const slow = [...new Set(pages.map((p) => p.page))].map((page) => ({ page, ...split("lcp", pages.filter((p) => p.page === page && p.metric === "lcp")) }))
    .filter((p) => p.n > 0).sort((a, b) => (b.p75 ?? 0) - (a.p75 ?? 0)).slice(0, 8);
  return { speed: out, slowPages: slow };
}

/** Everything the dashboard shows for one query, with the period before for comparison. */
export async function dashboard(env: Env, range: Range, now: number, query?: Query) {
  const q = query ?? parseQuery(new URLSearchParams({ range }), now)!;
  const b = await build(env, q, now);
  const { m, today } = b;
  const totals = totalsOf(m);
  const previous = b.prevM ? totalsOf(b.prevM) : null;
  const visits = totals.visits;
  const step = (k: string) => m.get(`kind\u0000${k}`)?.visits ?? 0;
  return {
    range: q.range, from: q.from, to: q.to, g: q.g, filters: q.filters, today, generated: now, totals, previous, series: b.series, prevSeries: b.prevSeries, heatmap: b.heat,
    sources: list(m, "source", "visits"),
    countries: list(m, "country"), regions: list(m, "region"), cities: cities(m),
    pages: list(m, "page", "hits"), entries: list(m, "entry", "visits"), exits: list(m, "exit", "visits"),
    devices: list(m, "device"), browsers: list(m, "browser"), systems: list(m, "os"),
    cards: Object.fromEntries(CARD_DIMS.map((d) => [d, detailList(m, d, 30)])),
    returning: { new: m.get("returning\u00000")?.visits ?? 0, returning: m.get("returning\u00001")?.visits ?? 0, unknown: m.get("returning\u0000?")?.visits ?? 0 },
    actions: list(m, "kind", "hits", 20).filter((a) => a.key !== "card"),
    funnel: [{ step: "Arrived", visits }, { step: "Saw a sentence", visits: step("card") }, { step: "Sent an answer", visits: step("answer") }],
    insights: insights(totals, previous, m, b.series, q.from !== q.to, b.label),
  };
}

/** The heavy part, loaded when scrolled to: every dimension's rows, and speed. */
async function detail(env: Env, q: Query, now: number) {
  const { m } = await build(env, q, now);
  return { dims: Object.fromEntries(DETAIL_DIMS.map((d) => [d, detailList(m, d, d === "page" ? 200 : 60)])), ...speedOf(m) };
}

/** Rows by columns: visits counted by two dimensions at once. Needs the raw events. */
async function pivot(env: Env, q: Query, a: string, b: string, now: number) {
  const { visits, pool } = await build(env, q, now, true);
  // A value only one visitor has is shown as "Other", as everywhere else.
  const who = (dim: string) => { const mp = new Map<string, Set<string>>(); for (const v of pool!) for (const k of keysOf(v, dim)) (mp.get(k) ?? mp.set(k, new Set()).get(k)!).add(v.visitor); return mp; };
  const seen = new Map(RARE.filter((d) => d === a || d === b).map((d) => [d, who(d)]));
  const keys = (v: Visit, dim: string) => keysOf(v, dim).map((k) => ((seen.get(dim)?.get(k)?.size ?? CITY_MIN) < CITY_MIN ? "" : k));
  const cells = new Map<string, { r: string; c: string; who: Set<string>; visits: number; hits: number }>();
  const rowN = new Map<string, number>(), colN = new Map<string, number>();
  for (const v of visits!) for (const r of new Set(keys(v, a))) for (const c of new Set(keys(v, b))) {
    const k = `${r}\u0000${c}`;
    const x = cells.get(k) ?? cells.set(k, { r, c, who: new Set(), visits: 0, hits: 0 }).get(k)!;
    x.who.add(v.visitor); x.visits++; x.hits += v.pages.length;
    rowN.set(r, (rowN.get(r) ?? 0) + 1); colN.set(c, (colN.get(c) ?? 0) + 1);
  }
  const top = (mp: Map<string, number>, k: number) => [...mp].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0])).slice(0, k).map((e) => e[0]);
  const rows = top(rowN, 15), cols = top(colN, 8);
  return { dim: a, dim2: b, rows, cols, cells: [...cells.values()].filter((x) => rows.includes(x.r) && cols.includes(x.c)).map((x) => ({ r: x.r, c: x.c, visitors: x.who.size, visits: x.visits, hits: x.hits })) };
}

// ---------- CSV ----------

/** One CSV field: quoted when needed, and a leading = + - @ is defused so a spreadsheet never runs it as a formula. */
const csvCell = (x: string | number | null | undefined): string => {
  let t = x === null || x === undefined ? "" : String(x);
  if (/^[=+\-@\t\r]/.test(t) && Number.isNaN(Number(t))) t = `'${t}`;
  return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};
const csv = (rows: (string | number | null)[][]) => rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";

async function exportCsv(env: Env, q: Query, p: URLSearchParams, now: number): Promise<Response> {
  const what = p.get("what") ?? "table", stamp = istDay(now);
  let body: string;
  if (what === "visits") {
    const { visits, pool } = await build(env, q, now, true);
    // City, phone model, network and time zone are written only when two or more visitors in the window share them.
    const named = new Map(RARE.map((d) => {
      const mp = new Map<string, Set<string>>();
      for (const v of pool!) for (const k of keysOf(v, d)) (mp.get(k) ?? mp.set(k, new Set()).get(k)!).add(v.visitor);
      return [d, new Set([...mp].filter(([, s]) => s.size >= CITY_MIN).map(([k]) => k))] as const;
    }));
    const ok = (v: Visit, d: string) => keysOf(v, d).some((k) => named.get(d)!.has(k));
    body = csv([
      ["start_utc", "source", "country", "region", "city", "device", "browser", "browser_version", "system", "system_version", "brand", "model", "network", "language", "time_zone", "screen_width", "pixel_density", "connection", "theme", "system_theme", "installed_app", "returning", "pages", "seconds", "left_at_once", "first_page", "last_page"],
      ...visits!.map((v) => [new Date(v.t0).toISOString(), v.source, v.country, v.region, ok(v, "city") ? v.city : "", v.device, v.browser, v.bv, v.os, v.osv, v.brand, ok(v, "model") ? v.model : "", ok(v, "isp") ? v.isp : "", v.lang, ok(v, "tz") ? v.tz : "", v.vw, v.dpr, v.net, v.theme, v.scheme, v.pwa, v.returning, v.pages.length, Math.round(v.ms / 1000), v.bounce ? 1 : 0, v.pages[0] ?? "", v.pages[v.pages.length - 1] ?? ""]),
    ]);
  } else if (what === "table") {
    const dim = p.get("dim") ?? "";
    if (!DETAIL_DIMS.includes(dim)) return json({ error: "bad_request" }, 400);
    const { m } = await build(env, q, now);
    const items = detailList(m, dim, 100000);
    body = csv([[dim, "visitors", "visits", "views", "left_at_once_percent", "average_seconds", "share_percent"],
      ...items.map((i) => [i.key || (RARE.includes(dim) ? "Other" : ""), i.visitors, i.visits, i.hits, i.key || !RARE.includes(dim) ? i.bounceRate : "", i.key || !RARE.includes(dim) ? Math.round(i.avgMs / 1000) : "", i.share])]);
  } else return json({ error: "bad_request" }, 400);
  return new Response(body, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="visitors-${what}-${stamp}.csv"`, "cache-control": "no-store" } });
}

/** Names that may be shown in single-visit views: a city or a network seen from two or more visitors in the raw window. */
async function namedPlaces(env: Env, now: number): Promise<{ cities: Set<string>; isps: Set<string> }> {
  const since = sqlTime(now - RAW_DAYS * DAY);
  const { results } = await env.DB.prepare(
    "SELECT country, region, city, count(DISTINCT COALESCE(visitor, vid)) AS n FROM events WHERE city IS NOT NULL AND at >= ?1 GROUP BY country, region, city",
  ).bind(since).all<{ country: string; region: string; city: string; n: number }>();
  const nets = await env.DB.prepare("SELECT isp, count(DISTINCT COALESCE(visitor, vid)) AS n FROM events WHERE isp IS NOT NULL AND at >= ?1 GROUP BY isp").bind(since).all<{ isp: string; n: number }>();
  return {
    cities: new Set(results.filter((r) => r.n >= CITY_MIN).map((r) => `${r.country}|${r.region}|${r.city}`)),
    isps: new Set(nets.results.filter((r) => r.n >= CITY_MIN).map((r) => r.isp)),
  };
}

const visitView = (v: Visit, named: { cities: Set<string>; isps: Set<string> }) => ({
  id: v.events[v.events.length - 1].id, source: v.source, country: v.country, region: v.region,
  city: named.cities.has(`${v.country}|${v.region}|${v.city}`) ? v.city : "",
  device: v.device, browser: v.browser, os: v.os, returning: v.returning, start: v.t0, end: v.t1, ms: v.ms,
  brand: v.brand, osv: v.osv, bv: v.bv, isp: named.isps.has(v.isp) ? v.isp : "", net: v.net,
  pages: v.pages.length, bounce: v.bounce,
  steps: v.events.slice(0, 60).map((e) => ({ at: parseAt(e.at), kind: e.kind, path: e.path, ...(e.ms ? { ms: e.ms } : {}) })),
});

/** Visits with an event in the last five minutes, newest first. */
export async function liveNow(env: Env, now: number) {
  const { results } = await env.DB.prepare(
    `SELECT ${COLS} FROM events WHERE vid IN (SELECT DISTINCT vid FROM events WHERE vid IS NOT NULL AND at >= ?1) AND at >= ?2 ORDER BY id`,
  ).bind(sqlTime(now - 5 * 60_000), sqlTime(now - 6 * 3_600_000)).all<Ev>();
  const named = await namedPlaces(env, now);
  const visits = toVisits(results).filter((v) => v.t1 >= now - 5 * 60_000).sort((a, b) => b.t1 - a.t1);
  return { now, count: new Set(visits.map((v) => v.visitor)).size, visits: visits.slice(0, 30).map((v) => ({ ...visitView(v, named), page: v.pages[v.pages.length - 1] ?? v.events[v.events.length - 1].path })) };
}

/** Recent visits with their steps, newest first, 20 at a time ("before" pages back by event id). */
export async function recentVisits(env: Env, now: number, before: number | null) {
  const { results: keys } = await env.DB.prepare(
    `SELECT vid, max(id) AS last FROM events WHERE vid IS NOT NULL AND at >= ?1 GROUP BY vid HAVING last < ?2 ORDER BY last DESC LIMIT 20`,
  ).bind(sqlTime(now - RAW_DAYS * DAY), before ?? 2_147_483_647).all<{ vid: string; last: number }>();
  if (!keys.length) return { visits: [], more: false };
  const marks = keys.map((_, i) => `?${i + 1}`).join(", ");
  const { results } = await env.DB.prepare(`SELECT ${COLS} FROM events WHERE vid IN (${marks}) ORDER BY id`).bind(...keys.map((k) => k.vid)).all<Ev>();
  const named = await namedPlaces(env, now);
  const order = new Map(keys.map((k, i) => [k.vid, i]));
  const visits = toVisits(results).sort((a, b) => (order.get(a.key) ?? 0) - (order.get(b.key) ?? 0)).map((v) => visitView(v, named));
  return { visits, more: keys.length === 20 };
}

/** GET .../visitors, .../visitors/export, .../visitors/live, .../visitors/visits; `sub` is the path after "visitors". The caller has checked the owner. */
export async function handleVisitorsApi(env: Env, req: Request, sub: string, now: number): Promise<Response | null> {
  if (req.method !== "GET") return null;
  const p = new URL(req.url).searchParams;
  if (sub === "" || sub === "/export") {
    const q = parseQuery(p, now);
    if (!q) return json({ error: "bad_request" }, 400);
    try {
      if (sub === "/export") return await exportCsv(env, q, p, now);
      const part = p.get("part");
      if (part === null) return json(await dashboard(env, q.range, now, q));
      if (part === "detail") return json(await detail(env, q, now));
      const [a, b] = [p.get("dim") ?? "", p.get("dim2") ?? ""];
      if (part === "pivot" && PIVOT_DIMS.includes(a) && PIVOT_DIMS.includes(b) && a !== b) return json(await pivot(env, q, a, b, now));
      return json({ error: "bad_request" }, 400);
    } catch (e) {
      if (e instanceof NeedRaw) return json({ error: "filters_need_raw" }, 400);
      throw e;
    }
  }
  if (sub === "/live") return json(await liveNow(env, now));
  if (sub === "/visits") {
    const b = p.get("before");
    const before = b === null ? null : Number(b);
    if (before !== null && (!Number.isInteger(before) || before < 1)) return json({ error: "bad_request" }, 400);
    return json(await recentVisits(env, now, before));
  }
  return null;
}
