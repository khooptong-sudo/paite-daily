import { badgeFor, getContributors } from "./contributors";
import { answersInLastMinute, feedbackFor, nextSentence, recordAnswer, skipSentence, type Register } from "./db";
import { readSession, signSession } from "./session";
import { cleanText, isPhoneId } from "./text";
import { json, type Deps, type Env } from "./types";

const DAY_MS = 86_400_000;

async function body(req: Request): Promise<Record<string, unknown>> {
  try {
    const b = await req.json();
    return b && typeof b === "object" ? (b as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export async function handleContributor(req: Request, env: Env, deps: Deps): Promise<Response> {
  const { pathname } = new URL(req.url);

  if (pathname === "/api/session" && req.method === "POST") {
    const b = await body(req);
    if (!isPhoneId(b.phoneId) || typeof b.turnstileToken !== "string") return json({ error: "bad_request" }, 400);
    const ok = await deps.verifyTurnstile(b.turnstileToken, req.headers.get("CF-Connecting-IP"), env);
    if (!ok) return json({ error: "turnstile_failed" }, 403);
    return json({ session: await signSession(b.phoneId, deps.now() + DAY_MS, env.SESSION_SECRET) });
  }

  if (pathname === "/api/contributors" && req.method === "GET") return json(await getContributors(env));

  const phoneId = await readSession(req.headers.get("X-Session"), deps.now(), env.SESSION_SECRET);
  if (!phoneId) return json({ error: "no_session" }, 401);

  if (pathname === "/api/next" && req.method === "GET") {
    const s = await nextSentence(env.DB, phoneId, deps.now());
    return s ? json(s) : new Response(null, { status: 204 });
  }

  if (pathname === "/api/feedback" && req.method === "GET") {
    const after = Number(new URL(req.url).searchParams.get("after"));
    return json({ items: await feedbackFor(env.DB, phoneId, Number.isInteger(after) && after > 0 ? after : 0) });
  }

  if (pathname === "/api/me" && req.method === "GET") {
    const r = await env.DB.prepare("SELECT count(*) AS total, COALESCE(SUM(status IN ('accepted', 'also_correct')), 0) AS verified FROM answers WHERE phone_id = ?1")
      .bind(phoneId).first<{ total: number; verified: number }>();
    return json({ total: r!.total, verified: r!.verified, badge: badgeFor(r!.verified) });
  }

  if (pathname === "/api/skip" && req.method === "POST") {
    const b = await body(req);
    if (!Number.isInteger(b.sentenceId)) return json({ error: "bad_request" }, 400);
    await skipSentence(env.DB, phoneId, b.sentenceId as number);
    return json({ ok: true });
  }

  if (pathname === "/api/answer" && req.method === "POST") {
    const b = await body(req);
    const paite = cleanText(b.paite, 300);
    const register = (b.register ?? "both") as Register;
    const name = b.name === undefined || b.name === "" ? null : cleanText(b.name, 60);
    const blank = b.explanation === undefined || b.explanation === null || (typeof b.explanation === "string" && !b.explanation.trim());
    const explanation = blank ? null : cleanText(b.explanation, 500);
    if (!Number.isInteger(b.sentenceId) || !paite || (!blank && !explanation) || !["spoken", "written", "both"].includes(register) || (b.name && !name)) {
      return json({ error: "bad_request" }, 400);
    }
    if ((await answersInLastMinute(env.DB, phoneId)) >= 10) return json({ error: "slow_down" }, 429);
    const result = await recordAnswer(env.DB, { phoneId, sentenceId: b.sentenceId as number, paite, register, name, explanation }, deps.now());
    return result === "ok" ? json({ ok: true }) : json({ error: "closed" }, 409);
  }

  return json({ error: "not_found" }, 404);
}
