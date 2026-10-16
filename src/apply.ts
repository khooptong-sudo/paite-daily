import { activeReviewers, isOwner } from "./access";
import { cleanText, isId } from "./text";
import { json, type Deps, type Env } from "./types";

const LIMIT_PER_DAY = 5;
const OK = () => json({ ok: true });
const owners = (env: Env) => (env.OWNER_EMAIL ?? "").split(",").map((o) => o.trim()).filter(Boolean);
const oneLine = (s: string) => s.replace(/\s+/g, " ");

async function hashIp(ip: string, secret: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${secret}:${ip}`));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function mail(env: Env, to: string | string[], subject: string, text: string): Promise<boolean> {
  if (!env.ALERT_EMAIL || (Array.isArray(to) && !to.length)) return false;
  try {
    await env.ALERT_EMAIL.send({ from: "alerts@alerts.lamkalabs.com", to, subject: oneLine(subject), text });
    return true;
  } catch (e) {
    console.error("apply email", e);
    return false;
  }
}

// POST /api/apply (public). Every success path returns the same body so status is never revealed.
export async function handleApply(req: Request, env: Env, deps: Deps, ctx?: ExecutionContext): Promise<Response> {
  let b: Record<string, unknown> = {};
  try { b = (await req.json()) as Record<string, unknown>; } catch {}
  if (!b || typeof b !== "object" || typeof b.turnstileToken !== "string") return json({ error: "bad_request" }, 400);
  const ip = req.headers.get("CF-Connecting-IP");
  if (!(await deps.verifyTurnstile(b.turnstileToken, ip, env))) return json({ error: "turnstile_failed" }, 403);
  const name = cleanText(b.name, 80);
  const email = cleanText(b.email, 120)?.toLowerCase();
  const blankNote = b.note === undefined || b.note === null || (typeof b.note === "string" && !b.note.trim());
  const note = blankNote ? null : cleanText(b.note, 300);
  if (!name || !email || !/^[^\s@<>,;"']+@[^\s@<>,;"']+\.[^\s@<>,;"']+$/.test(email) || (!blankNote && !note)) return json({ error: "bad_request" }, 400);

  const ipHash = await hashIp(ip ?? "unknown", env.SESSION_SECRET);
  const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM reviewer_applications WHERE ip_hash = ?1 AND created_at >= datetime('now', '-1 day')").bind(ipHash).first<{ n: number }>();
  if ((recent?.n ?? 0) >= LIMIT_PER_DAY) return json({ error: "slow_down" }, 429);

  if ((await activeReviewers(env)).some((r) => r.email === email)) return OK();
  const ins = await env.DB.prepare("INSERT OR IGNORE INTO reviewer_applications (name, email, note, ip_hash) VALUES (?1, ?2, ?3, ?4)").bind(name, email, note, ipHash).run();
  if (!ins.meta.changes) return OK();
  const sent = mail(env, owners(env), `Paite Daily: reviewer application from ${name}`, `Name: ${name}\nEmail: ${email}\nNote: ${note ?? ""}\n\nhttps://paite.lamkalabs.com/review`);
  if (ctx) ctx.waitUntil(sent); else await sent;
  return OK();
}

const APPROVED_TEXT = `You are now a Paite Daily reviewer. How to start:

1. Open https://paite.lamkalabs.com/review
2. Enter this email address.
3. Enter the 6-digit code that Cloudflare Access sends you (check your spam folder).

What the buttons do:
- Accept: keep this answer as the right translation.
- Also correct: keep another answer as a variant.
- Reject all: none of the answers is right.
- Retire: remove a bad sentence from the list.
- Undo: take back your last decision.

On a laptop, press A (accept), R (reject all), U (undo) and ? (help).
The sign-in lasts about a day.
Open /review once on the phone you use to translate, to get the Endiktu badge.
A daily email tells you how many answers wait.
`;

// Owner-only application and reviewer management. The caller has already checked the reviewer; this checks owner.
export async function handleOwnerReview(pathname: string, method: string, b: Record<string, unknown>, env: Env, email: string): Promise<Response | null> {
  const mine = ["/review/api/applications", "/review/api/applications/decide", "/review/api/reviewers", "/review/api/reviewers/remove"];
  if (!mine.includes(pathname)) return null;
  if (!isOwner(env, email)) return json({ error: "owner_only" }, 403);

  if (pathname === "/review/api/applications" && method === "GET") {
    const { results } = await env.DB.prepare("SELECT id, name, email, note, created_at FROM reviewer_applications WHERE status = 'pending' ORDER BY id").all();
    return json({ applications: results });
  }
  if (pathname === "/review/api/applications/decide" && method === "POST") {
    if (!isId(b.id) || (b.decision !== "approve" && b.decision !== "decline")) return json({ error: "bad_request" }, 400);
    const app = await env.DB.prepare("SELECT name, email FROM reviewer_applications WHERE id = ?1 AND status = 'pending'").bind(b.id).first<{ name: string; email: string }>();
    if (!app) return json({ error: "not_found" }, 404);
    const approve = b.decision === "approve";
    const mark = env.DB.prepare("UPDATE reviewer_applications SET status = ?2, decided_at = datetime('now'), decided_by = ?3 WHERE id = ?1 AND status = 'pending'").bind(b.id, approve ? "approved" : "declined", email);
    if (!approve) { await mark.run(); return json({ ok: true }); }
    const to = app.email.toLowerCase();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO reviewers (email, name, added_by) VALUES (?1, ?2, ?3) ON CONFLICT (email) DO UPDATE SET name = excluded.name, removed_at = NULL, added_by = excluded.added_by").bind(to, app.name, email),
      mark,
    ]);
    return json({ ok: true, emailed: await mail(env, to, "You are now a Paite Daily reviewer", APPROVED_TEXT) });
  }
  if (pathname === "/review/api/reviewers" && method === "GET") {
    const rs = await activeReviewers(env);
    return json({ reviewers: rs.sort((a, c) => a.name.localeCompare(c.name)) });
  }
  if (pathname === "/review/api/reviewers/remove" && method === "POST") {
    if (typeof b.email !== "string" || !b.email.trim()) return json({ error: "bad_request" }, 400);
    const target = b.email.trim().toLowerCase();
    if (isOwner(env, target)) return json({ error: "cannot_remove_owner", message: "Owners cannot be removed." }, 400);
    const r = (await activeReviewers(env)).find((x) => x.email === target);
    if (!r) return json({ error: "not_found" }, 404);
    if (r.source !== "db") return json({ error: "secret_only", message: "This reviewer is set in the REVIEWERS secret. Remove them there." }, 400);
    await env.DB.prepare("UPDATE reviewers SET removed_at = datetime('now') WHERE email = ?1 AND removed_at IS NULL").bind(target).run();
    return json({ ok: true });
  }
  return json({ error: "not_found" }, 404);
}
