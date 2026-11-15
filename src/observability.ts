import { json, type Env } from "./types";
import { cleanVia, placeOf, readAgent, sqlTime, visitorCode } from "./visitors";

// Error tracking and first-party visit counting. No cookie, no third party, no IP stored:
// `vid` is a random id the browser keeps for the tab, a referrer is cut down to its host, and
// people are counted with a code that changes every day (see visitors.ts).

export const KINDS = ["page", "leave", "card", "answer", "blocked", "install", "share", "chat", "ask", "play"] as const;

function digest(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}

export function fingerprint(message: string, stack: string | null): string {
  return digest(message.slice(0, 200) + "|" + (stack ?? "").split("\n").slice(0, 3).join("\n").slice(0, 300));
}

async function mail(env: Env, to: string | string[], subject: string, text: string): Promise<boolean> {
  if (!env.ALERT_EMAIL || (Array.isArray(to) && !to.length)) return false;
  try {
    await env.ALERT_EMAIL.send({ from: "alerts@alerts.lamkalabs.com", to, subject, text: text.slice(0, 4000) });
    return true;
  } catch (e) {
    console.error("alert email failed", e);
    return false;
  }
}

/** Stores one failed request and mails the owner the first time this failure appears in 6 hours. */
export async function recordError(env: Env, route: string, method: string, err: unknown): Promise<void> {
  try {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? (err.stack ?? null) : null;
    const fp = fingerprint(message, stack);
    const seen = await env.DB.prepare("SELECT count(*) AS n FROM errors WHERE fingerprint = ?1 AND at > datetime('now', '-6 hours')").bind(fp).first<{ n: number }>();
    await env.DB.prepare("INSERT INTO errors (fingerprint, route, method, message, stack) VALUES (?1, ?2, ?3, ?4, ?5)")
      .bind(fp, route.slice(0, 200), method, message.slice(0, 500), stack?.slice(0, 2000) ?? null).run();
    if ((seen?.n ?? 1) === 0) {
      const owners = (env.OWNER_EMAIL ?? "").split(",").map((o) => o.trim()).filter(Boolean);
      await mail(env, owners, `Paite Daily: ${message.slice(0, 80)}`, `${method} ${route}\n${message}\n\n${stack ?? ""}\n\nhttps://paite.lamkalabs.com/review (Errors card)`);
    }
  } catch (e) {
    console.error("recordError failed", e);
  }
}

const FALLBACK = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Paite Daily is having a moment</title></head><body style="font:17px/1.55 system-ui,sans-serif;max-width:34rem;margin:12vh auto;padding:0 1.2rem;color:#111"><h1 style="font-size:1.6rem">Something broke on our side</h1><p>The page could not load. We have the error and will fix it.</p><p>Write to <a href="mailto:theconcierge@lamkalabs.com">theconcierge@lamkalabs.com</a>.</p><p><a href="/">Try the front page</a></p></body></html>`;

/** The page a visitor sees when a request throws: HTML for a page, JSON for an API path. */
export async function errorPage(req: Request, env: Env): Promise<Response> {
  const { pathname } = new URL(req.url);
  if (pathname.startsWith("/api/") || pathname.startsWith("/review/api/")) {
    return json({ error: "server_error" }, 500);
  }
  try {
    // "/500", not "/500.html": the asset layer answers the first with the page and redirects the second.
    const r = await env.ASSETS.fetch(new Request(new URL("/500", req.url).toString()));
    if (r.ok) return new Response(r.body, { status: 500, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
  } catch {}
  return new Response(FALLBACK, { status: 500, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

// POST /api/event - public, no session. A broken or hostile body is dropped, never an error page.
// Bots are not counted. The IP is used only to make today's visitor code (visitors.ts) and is never stored.
export async function handleEvent(req: Request, env: Env, now = Date.now()): Promise<Response> {
  let b: Record<string, unknown> = {};
  try {
    const parsed = await req.json();
    if (parsed && typeof parsed === "object") b = parsed as Record<string, unknown>;
  } catch {
    return new Response(null, { status: 204 });
  }
  const kind = typeof b.kind === "string" ? b.kind : "";
  if (!(KINDS as readonly string[]).includes(kind)) return new Response(null, { status: 204 });
  const str = (v: unknown, max: number) => (typeof v === "string" && v ? v.slice(0, max) : null);
  const vid = str(b.vid, 40);
  let ref: string | null = null;
  try {
    const r = str(b.ref, 300);
    ref = r ? new URL(r).host.slice(0, 80) : null;
  } catch {}
  const ua = req.headers.get("user-agent") ?? "";
  const agent = readAgent(ua);
  if (agent.bot) return new Response(null, { status: 204 });
  // Engaged time arrives on 'leave' only, capped at 30 minutes a beacon.
  const ms = kind === "leave" && typeof b.ms === "number" && Number.isFinite(b.ms) ? Math.max(0, Math.min(Math.round(b.ms), 1_800_000)) : null;
  const returning = b.ret === 1 || b.ret === 0 ? b.ret : null;
  try {
    if (vid) {
      // One device cannot flood the table: over 60 events a minute from the same tab id, drop them.
      const hot = await env.DB.prepare("SELECT count(*) AS n FROM events WHERE vid = ?1 AND at > ?2").bind(vid, sqlTime(now - 60_000)).first<{ n: number }>();
      if ((hot?.n ?? 0) >= 60) return new Response(null, { status: 204 });
    }
    const where = placeOf(req);
    const visitor = await visitorCode(env, req.headers.get("CF-Connecting-IP") ?? "unknown", ua, now);
    await env.DB.prepare("INSERT INTO events (kind, path, vid, device, ref, visitor, via, country, region, city, browser, os, revisit, ms, at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)")
      .bind(kind, (str(b.path, 80) ?? "").replace(/[?&#].*$/, ""), vid, agent.device, ref, visitor, cleanVia(b.via), where.country, where.region, where.city, agent.browser, agent.os, returning, ms, sqlTime(now)).run();
    // Old events are removed by the nightly visitors job, after their day's totals are kept.
  } catch (e) {
    console.error("event insert failed", e);
  }
  return new Response(null, { status: 204 });
}

// The visit funnel moved to the admin dashboard (visitors.ts).

export async function recentErrors(env: Env, limit = 20): Promise<{ fingerprint: string; route: string; message: string; last: string; count: number }[]> {
  const { results } = await env.DB.prepare(
    `SELECT fingerprint, route, message, MAX(at) AS last, count(*) AS count, MAX(stack) AS stack
     FROM errors WHERE at > datetime('now', '-7 days') GROUP BY fingerprint ORDER BY last DESC LIMIT ?1`,
  ).bind(limit).all<{ fingerprint: string; route: string; message: string; last: string; count: number }>();
  return results;
}
