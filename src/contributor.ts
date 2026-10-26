import { buildScenes, matchChat, recordWant } from "./chat";
import { handleApply } from "./apply";
import { getGoal } from "./goal";
import { badgeFor, getContributors } from "./contributors";
import { answersInLastMinute, feedbackFor, nextSentence, recordAnswer, sharedSentence, skipSentence, type Register } from "./db";
import { readSession, signSession } from "./session";
import { cleanText, isId, isPhoneId } from "./text";
import { refillOnDemand } from "./refill";
import { nextWordToTranslate, submitMeaning, submitWord } from "./words";
import { submitProverbAnswer, submitProverbPair } from "./proverbs";
import { nextLine, submitRecording, verifiedCount } from "./recordings";
import { checkGrammar } from "./grammar";
import { checkSpelling } from "./spelling";
import { cleanPlace } from "./places";
import { weekFor } from "./week";
import { streakFor } from "./streak";
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

  // The chat demo is for visitors: no session, no Turnstile. The only write is a
  // line somebody asked for and we could not answer, which is deduped by wording.
  if (pathname === "/api/chat/scenes" && req.method === "GET") return json({ scenes: await buildScenes(env) }, 200, "public, max-age=120");
  if (pathname === "/api/chat/match" && req.method === "GET") {
    const q = new URL(req.url).searchParams.get("q") ?? "";
    return json({ match: await matchChat(env, q.slice(0, 200)) }, 200, "public, max-age=60");
  }
  if (pathname === "/api/chat/want" && req.method === "POST") {
    const b = await body(req);
    return (await recordWant(env, b.q)) ? json({ ok: true }) : json({ error: "bad_request" }, 400);
  }

  const phoneId = await readSession(req.headers.get("X-Session"), deps.now(), env.SESSION_SECRET);
  if (!phoneId) return json({ error: "no_session" }, 401);

  if (pathname === "/api/next" && req.method === "GET") {
    // ?s=<id>: a sentence shared by Ask a relative. Served when this phone may answer it;
    // otherwise the usual next one, marked so the page can say why.
    const shared = Number(new URL(req.url).searchParams.get("s"));
    if (isId(shared)) {
      const one = await sharedSentence(env.DB, phoneId, shared, deps.now());
      if (one) return json({ ...one, shared: true });
    }
    const s = await nextSentence(env.DB, phoneId, deps.now());
    if (s) return json(isId(shared) ? { ...s, sharedGone: true } : s);
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
              (SELECT count(*) FROM word_submissions WHERE phone_id = ?1 AND source = 'word') AS words,
              (SELECT count(*) FROM word_submissions WHERE phone_id = ?1 AND source = 'meaning') AS meanings,
              (SELECT count(*) FROM proverb_answers WHERE phone_id = ?1) + (SELECT count(*) FROM proverbs WHERE submitted_by = ?1) AS sayings,
              (SELECT count(*) FROM recordings WHERE phone_id = ?1) AS recordings`,
    ).bind(phoneId).first<{ total: number; verified: number; words: number; meanings: number; sayings: number; recordings: number }>();
    // One count per section: the puan's share card and each box's "You: N" read these.
    return json({ total: r!.total, verified: r!.verified, words: r!.words, meanings: r!.meanings, sayings: r!.sayings, recordings: r!.recordings, badge: badgeFor(r!.verified), streak: await streakFor(env.DB, phoneId, deps.now()) });
  }

  if (pathname === "/api/week" && req.method === "GET") return json(await weekFor(env, phoneId, deps.now()));

  // Hear it: only a phone with a verified sentence gets a line to read aloud.
  if (pathname === "/api/record/next" && req.method === "GET") {
    if ((await verifiedCount(env, phoneId)) < 1) return json({ error: "not_eligible" }, 403);
    const line = await nextLine(env, phoneId);
    return line ? json(line) : new Response(null, { status: 204 });
  }
  if (pathname === "/api/record" && req.method === "POST") return submitRecording(req, env, phoneId, deps.now());

  if (pathname === "/api/spelling" && req.method === "POST") return checkSpelling(env, await body(req), deps.now());
  if (pathname === "/api/grammar" && req.method === "POST") return checkGrammar(env, phoneId, await body(req), deps.now(), deps.fetch ?? ((u, i) => fetch(u, i)));

  if (pathname === "/api/word" && req.method === "POST") return submitWord(env, phoneId, await body(req));

  if (pathname === "/api/proverb/answer" && req.method === "POST") return submitProverbAnswer(env, phoneId, await body(req));

  if (pathname === "/api/proverb/submit" && req.method === "POST") return submitProverbPair(env, phoneId, await body(req));

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
    const place = cleanPlace(b.place);
    if (!isId(b.sentenceId) || !paite || (!blank && !explanation) || place === undefined || !["spoken", "written", "both"].includes(register) || (b.name && !name)) {
      return json({ error: "bad_request" }, 400);
    }
    if ((await answersInLastMinute(env.DB, phoneId)) >= 10) return json({ error: "slow_down" }, 429);
    const result = await recordAnswer(env.DB, { phoneId, sentenceId: b.sentenceId as number, paite, register, name, explanation, place }, deps.now());
    return result === "ok" ? json({ ok: true }) : json({ error: "closed" }, 409);
  }

  return json({ error: "not_found" }, 404);
}
