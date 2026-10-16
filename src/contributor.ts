import { handleApply } from "./apply";
import { getGoal } from "./goal";
import { badgeFor, getContributors } from "./contributors";
import { answersInLastMinute, feedbackFor, nextSentence, recordAnswer, skipSentence, type Register } from "./db";
import { readSession, signSession } from "./session";
import { cleanText, isId, isPhoneId } from "./text";
import { refillOnDemand } from "./refill";
import { nextWordToTranslate, submitMeaning, submitWord } from "./words";
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

/** The contributor gave their name after their first entry: name the rows this phone left unnamed. */
async function setName(env: Env, phoneId: string, b: Record<string, unknown>): Promise<Response> {
  const name = cleanText(b.name, 60);
  if (!name) return json({ error: "bad_request" }, 400);
  let stamped = 0;
  for (const table of ["answers", "word_submissions"]) {
    const r = await env.DB.prepare(
      `UPDATE ${table} SET contributor_name = ?1 WHERE phone_id = ?2 AND (contributor_name IS NULL OR contributor_name = '')`,
    ).bind(name, phoneId).run();
    stamped += r.meta.changes ?? 0;
  }
  return json({ ok: true, stamped });
}

export async function handleContributor(req: Request, env: Env, deps: Deps, ctx?: ExecutionContext): Promise<Response> {
  const { pathname } = new URL(req.url);

  if (pathname === "/api/session" && req.method === "POST") {
    const b = await body(req);
    if (!isPhoneId(b.phoneId) || typeof b.turnstileToken !== "string" || b.turnstileToken.length > 4096) return json({ error: "bad_request" }, 400);
    const ok = await deps.verifyTurnstile(b.turnstileToken, req.headers.get("CF-Connecting-IP"), env);
    if (!ok) return json({ error: "turnstile_failed" }, 403);
    return json({ session: await signSession(b.phoneId, deps.now() + DAY_MS, env.SESSION_SECRET) });
  }

  if (pathname === "/api/apply" && req.method === "POST") return handleApply(req, env, deps, ctx);
  if (pathname === "/api/contributors" && req.method === "GET") return json(await getContributors(env), 200, "public, max-age=300");
  if (pathname === "/api/goal" && req.method === "GET") return json(await getGoal(env), 200, "public, max-age=300");

  const phoneId = await readSession(req.headers.get("X-Session"), deps.now(), env.SESSION_SECRET);
  if (!phoneId) return json({ error: "no_session" }, 401);

  if (pathname === "/api/next" && req.method === "GET") {
    const s = await nextSentence(env.DB, phoneId, deps.now());
    if (s) return json(s);
    return (await refillOnDemand(env, deps.now(), ctx)) ? json({ refilling: true }, 202) : new Response(null, { status: 204 });
  }

  if (pathname === "/api/feedback" && req.method === "GET") {
    const after = Number(new URL(req.url).searchParams.get("after"));
    return json({ items: await feedbackFor(env.DB, phoneId, Number.isInteger(after) && after > 0 ? after : 0) });
  }

  if (pathname === "/api/me" && req.method === "GET") {
    const r = await env.DB.prepare(
      `SELECT (SELECT count(*) FROM answers WHERE phone_id = ?1) AS total,
              (SELECT COALESCE(SUM(status IN ('accepted', 'also_correct')), 0) FROM answers WHERE phone_id = ?1) AS verified,
              (SELECT count(*) FROM word_submissions WHERE phone_id = ?1) AS words`,
    ).bind(phoneId).first<{ total: number; verified: number; words: number }>();
    return json({ total: r!.total, verified: r!.verified, words: r!.words, badge: badgeFor(r!.verified) });
  }

  if (pathname === "/api/word" && req.method === "POST") return submitWord(env, phoneId, await body(req));

  if (pathname === "/api/name" && req.method === "POST") return setName(env, phoneId, await body(req));

  if (pathname === "/api/word/next" && req.method === "GET") {
    const w = await nextWordToTranslate(env, phoneId);
    return w ? json(w) : new Response(null, { status: 204 });
  }
  if (pathname === "/api/word/meaning" && req.method === "POST") return submitMeaning(env, phoneId, await body(req));

  if (pathname === "/api/skip" && req.method === "POST") {
    const b = await body(req);
    if (!isId(b.sentenceId)) return json({ error: "bad_request" }, 400);
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
    if (!isId(b.sentenceId) || !paite || (!blank && !explanation) || !["spoken", "written", "both"].includes(register) || (b.name && !name)) {
      return json({ error: "bad_request" }, 400);
    }
    if ((await answersInLastMinute(env.DB, phoneId)) >= 10) return json({ error: "slow_down" }, 429);
    const result = await recordAnswer(env.DB, { phoneId, sentenceId: b.sentenceId as number, paite, register, name, explanation }, deps.now());
    return result === "ok" ? json({ ok: true }) : json({ error: "closed" }, 409);
  }

  return json({ error: "not_found" }, 404);
}
