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

export type Agent = { bot: boolean; device: "phone" | "tablet" | "desktop"; browser: string; os: string; inApp: string | null };

/** Device, browser and system from a user agent; bots are flagged so they are never counted. */
export function readAgent(ua: string): Agent {
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
  return { bot, device, browser, os, inApp };
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
};
const COLS = "id, at, kind, path, vid, visitor, device, ref, via, country, region, city, browser, os, revisit, ms";

export type Visit = {
  key: string; visitor: string; source: string; country: string; region: string; city: string;
  device: string; browser: string; os: string; returning: number | null;
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
        t0: t, t1: t, pages: [], kinds: new Map(), leaveMs: new Map(), ms: 0, bounce: true, events: [],
      };
      by.set(key, v);
    }
    v.t1 = Math.max(v.t1, t);
    v.events.push(e);
    if (e.kind === "page") v.pages.push(e.path || "/");
    else if (e.kind === "leave") {
      const ms = Math.max(0, Math.min(e.ms ?? 0, 30 * 60_000));
      v.ms += ms;
      v.leaveMs.set(e.path || "/", (v.leaveMs.get(e.path || "/") ?? 0) + ms);
    } else v.kinds.set(e.kind, (v.kinds.get(e.kind) ?? 0) + 1);
  }
  for (const v of by.values()) {
    if (!v.ms) v.ms = Math.min(v.t1 - v.t0, 30 * 60_000);
    v.bounce = v.pages.length <= 1 && !ACTIONS.some((a) => v.kinds.has(a));
  }
  return [...by.values()];
}

export type Row = { dim: string; key: string; visitors: number; visits: number; hits: number; bounces: number; ms: number };

/** Every dimension's totals for a set of visits. Visitors are distinct codes within the set. */
export function summarise(visits: Visit[]): Row[] {
  const acc = new Map<string, { dim: string; key: string; who: Set<string>; visits: number; hits: number; bounces: number; ms: number }>();
  const add = (dim: string, key: string, v: Visit, hits: number, ms: number, bounce = v.bounce) => {
    const k = `${dim}\u0000${key}`;
    let a = acc.get(k);
    if (!a) acc.set(k, (a = { dim, key, who: new Set(), visits: 0, hits: 0, bounces: 0, ms: 0 }));
    a.who.add(v.visitor); a.visits++; a.hits += hits; a.ms += ms; if (bounce) a.bounces++;
  };
  for (const v of visits) {
    const views = v.pages.length;
    add("all", "", v, views, v.ms);
    add("source", v.source, v, views, v.ms);
    add("country", v.country, v, views, v.ms);
    if (v.region) add("region", `${v.country}|${v.region}`, v, views, v.ms);
    if (v.city) add("city", `${v.country}|${v.region}|${v.city}`, v, views, v.ms);
    add("device", v.device, v, views, v.ms);
    add("browser", v.browser, v, views, v.ms);
    add("os", v.os, v, views, v.ms);
    add("returning", v.returning === null ? "?" : String(v.returning), v, views, v.ms);
    add("hour", String(new Date(v.t0 + IST).getUTCHours()).padStart(2, "0"), v, views, v.ms);
    if (views) {
      add("entry", v.pages[0], v, 1, 0);
      add("exit", v.pages[views - 1], v, 1, 0);
      const seen = new Map<string, number>();
      for (const p of v.pages) seen.set(p, (seen.get(p) ?? 0) + 1);
      for (const [p, n] of seen) add("page", p, v, n, v.leaveMs.get(p) ?? 0, v.bounce && v.pages[0] === p);
    }
    for (const [k, n] of v.kinds) add("kind", k, v, n, 0, false);
  }
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

/** Cities with fewer than CITY_MIN visitors are folded into one unnamed row. */
function cities(m: Map<string, Row>): Item[] {
  const all = list(m, "city", "visitors", 1000);
  const named = all.filter((c) => c.visitors >= CITY_MIN).slice(0, 12);
  const rest = all.filter((c) => !named.includes(c));
  if (rest.length) {
    const r = rest.reduce((s, c) => ({ visitors: s.visitors + c.visitors, visits: s.visits + c.visits, hits: s.hits + c.hits, share: s.share + c.share }), { visitors: 0, visits: 0, hits: 0, share: 0 });
    named.push({ key: "", visitors: r.visitors, visits: r.visits, hits: r.hits, share: Math.round(r.share * 10) / 10, bounceRate: 0, avgMs: 0 });
  }
  return named;
}

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const fmtDay = (d: string) => `${WEEKDAY[new Date(`${d}T00:00:00Z`).getUTCDay()]} ${Number(d.slice(8))} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(d.slice(5, 7)) - 1]}`;
const PAGE_NAMES: Record<string, string> = { "/": "the front page", "/proverbs": "Pau Upa", "/glossary": "the word list", "/contributors": "Panlate", "/about": "About", "/rules": "the spelling rules", "/places": "Places", "/wiki": "the Paite Wiki" };
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

export type Range = "today" | "7" | "30" | "90";

/** Everything the dashboard shows for one range, with the period before for comparison. */
export async function dashboard(env: Env, range: Range, now: number) {
  const today = istDay(now);
  let rows: Row[], prevRows: Row[] | null, series: Point[], prevSeries: Point[], heat: number[][] | null = null, label: string;
  if (range === "today") {
    const start = dayStart(today);
    rows = await windowRows(env, start, now + 1);
    prevRows = await windowRows(env, start - DAY, now + 1 - DAY);
    const yday = await windowRows(env, start - DAY, start);
    const hourPoint = (rs: Row[], h: string): Point => {
      const r = rs.find((x) => x.dim === "hour" && x.key === h);
      return { key: h, visitors: r?.visitors ?? 0, visits: r?.visits ?? 0, pageviews: r?.hits ?? 0, actions: 0, bounceRate: r ? pct(r.bounces, r.visits) : 0, avgMs: r?.visits ? Math.round(r.ms / r.visits) : 0 };
    };
    const hours = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
    const nowHour = new Date(now + IST).getUTCHours();
    series = hours.slice(0, nowHour + 1).map((h) => hourPoint(rows, h));
    prevSeries = hours.map((h) => hourPoint(yday, h));
    label = "same time yesterday";
  } else {
    const n = Number(range);
    await ensureRolled(env, now);
    const from = addDays(today, -(n - 1)), prevFrom = addDays(from, -n);
    const stored = (await env.DB.prepare("SELECT day, dim, key, visitors, visits, hits, bounces, ms FROM visit_stats WHERE day >= ?1 AND day < ?2")
      .bind(from, today).all<Row & { day: string }>()).results;
    const live = await windowRows(env, dayStart(today), now + 1);
    const prev = (await env.DB.prepare("SELECT day, dim, key, visitors, visits, hits, bounces, ms FROM visit_stats WHERE day >= ?1 AND day < ?2 AND dim IN ('all', 'kind')")
      .bind(prevFrom, from).all<Row & { day: string }>()).results;
    rows = [...stored, ...live];
    prevRows = prev.some((r) => r.dim === "all" && r.visits > 0) ? prev : null;
    const byDay = new Map<string, Row[]>();
    for (const r of stored) (byDay.get(r.day) ?? byDay.set(r.day, []).get(r.day)!).push(r);
    byDay.set(today, live);
    const prevByDay = new Map<string, Row[]>();
    for (const r of prev) (prevByDay.get(r.day) ?? prevByDay.set(r.day, []).get(r.day)!).push(r);
    series = []; prevSeries = [];
    for (let i = 0; i < n; i++) {
      const d = addDays(from, i), p = addDays(prevFrom, i);
      series.push(pointOf(d, byDay.get(d) ?? []));
      prevSeries.push(pointOf(p, prevByDay.get(p) ?? []));
    }
    // Rhythm: visits by weekday (0 = Monday) and IST hour of the start.
    heat = Array.from({ length: 7 }, () => Array(24).fill(0));
    for (const [d, rs] of byDay) {
      const wd = (new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7;
      for (const r of rs) if (r.dim === "hour") heat[wd][Number(r.key)] += r.visits;
    }
    label = n === 7 ? "7 days" : `${n} days`;
  }
  const m = merge(rows);
  const totals = totalsOf(m);
  const previous = prevRows ? totalsOf(merge(prevRows)) : null;
  const visits = totals.visits;
  const step = (k: string) => m.get(`kind\u0000${k}`)?.visits ?? 0;
  return {
    range, today, generated: now, totals, previous, series, prevSeries, heatmap: heat,
    sources: list(m, "source", "visits"),
    countries: list(m, "country"), regions: list(m, "region"), cities: cities(m),
    pages: list(m, "page", "hits"), entries: list(m, "entry", "visits"), exits: list(m, "exit", "visits"),
    devices: list(m, "device"), browsers: list(m, "browser"), systems: list(m, "os"),
    returning: { new: m.get("returning\u00000")?.visits ?? 0, returning: m.get("returning\u00001")?.visits ?? 0, unknown: m.get("returning\u0000?")?.visits ?? 0 },
    actions: list(m, "kind", "hits", 20).filter((a) => a.key !== "card"),
    funnel: [{ step: "Arrived", visits }, { step: "Saw a sentence", visits: step("card") }, { step: "Sent an answer", visits: step("answer") }],
    insights: insights(totals, previous, m, series, range !== "today", label),
  };
}

/** Cities that may be named in single-visit views: two or more visitors in the raw window. */
async function namedCities(env: Env, now: number): Promise<Set<string>> {
  const { results } = await env.DB.prepare(
    "SELECT country, region, city, count(DISTINCT COALESCE(visitor, vid)) AS n FROM events WHERE city IS NOT NULL AND at >= ?1 GROUP BY country, region, city",
  ).bind(sqlTime(now - RAW_DAYS * DAY)).all<{ country: string; region: string; city: string; n: number }>();
  return new Set(results.filter((r) => r.n >= CITY_MIN).map((r) => `${r.country}|${r.region}|${r.city}`));
}

const visitView = (v: Visit, named: Set<string>) => ({
  id: v.events[v.events.length - 1].id, source: v.source, country: v.country, region: v.region,
  city: named.has(`${v.country}|${v.region}|${v.city}`) ? v.city : "",
  device: v.device, browser: v.browser, os: v.os, returning: v.returning, start: v.t0, end: v.t1, ms: v.ms,
  pages: v.pages.length, bounce: v.bounce,
  steps: v.events.slice(0, 60).map((e) => ({ at: parseAt(e.at), kind: e.kind, path: e.path, ...(e.ms ? { ms: e.ms } : {}) })),
});

/** Visits with an event in the last five minutes, newest first. */
export async function liveNow(env: Env, now: number) {
  const { results } = await env.DB.prepare(
    `SELECT ${COLS} FROM events WHERE vid IN (SELECT DISTINCT vid FROM events WHERE vid IS NOT NULL AND at >= ?1) AND at >= ?2 ORDER BY id`,
  ).bind(sqlTime(now - 5 * 60_000), sqlTime(now - 6 * 3_600_000)).all<Ev>();
  const named = await namedCities(env, now);
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
  const named = await namedCities(env, now);
  const order = new Map(keys.map((k, i) => [k.vid, i]));
  const visits = toVisits(results).sort((a, b) => (order.get(a.key) ?? 0) - (order.get(b.key) ?? 0)).map((v) => visitView(v, named));
  return { visits, more: keys.length === 20 };
}

/** GET .../visitors, .../visitors/live, .../visitors/visits; `sub` is the path after "visitors". The caller has checked the owner. */
export async function handleVisitorsApi(env: Env, req: Request, sub: string, now: number): Promise<Response | null> {
  if (req.method !== "GET") return null;
  const q = new URL(req.url).searchParams;
  if (sub === "") {
    const r = q.get("range") ?? "7";
    if (!["today", "7", "30", "90"].includes(r)) return json({ error: "bad_request" }, 400);
    return json(await dashboard(env, r as Range, now));
  }
  if (sub === "/live") return json(await liveNow(env, now));
  if (sub === "/visits") {
    const b = q.get("before");
    const before = b === null ? null : Number(b);
    if (before !== null && (!Number.isInteger(before) || before < 1)) return json({ error: "bad_request" }, 400);
    return json(await recentVisits(env, now, before));
  }
  return null;
}
