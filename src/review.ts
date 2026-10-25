import { isOwner, reviewerName } from "./access";
import { handleOwnerReview } from "./apply";
import { failingJobs } from "./export";
import { waitingCounts } from "./digest";
import { REQUIRED_REVIEWERS, decideProverbAnswer, decideProverbPair, getProverbReviewList, skipProverbSaying, undoProverbReview } from "./proverbreview";
import { saveProverbReview } from "./proverbcard";

/**
 * Two body shapes reach the saying endpoints. The older one is {id, accept},
 * which the reviewer page still posts. The newer one is {id, decision,
 * finalPaite, note} and carries a correction. Null means the body was unusable.
 */
function readProverbDecision(b: Record<string, unknown>) {
  if (!isId(b.id)) return null;
  const decision = ["accept", "reject", "variant"].includes(b.decision as string)
    ? (b.decision as "accept" | "reject" | "variant")
    : undefined;
  if (typeof b.accept !== "boolean" && !decision) return null;
  if (b.finalPaite !== undefined && typeof b.finalPaite !== "string") return null;
  if (b.note !== undefined && typeof b.note !== "string") return null;
  return {
    accept: b.accept === true,
    opts: {
      decision,
      finalPaite: b.finalPaite as string | undefined,
      note: b.note as string | undefined,
    },
  };
}
import { getGlossaryForReview } from "./glossary";
import { cap, cleanText, isId, isIdList, isPhoneId } from "./text";
import { analytics, recentErrors } from "./observability";
import { handleWords } from "./words";
import { handleRecordingReview } from "./recordings";
import { claimNext, decide, skipCard, undo, type Decision } from "./reviewdb";
import { json, type Deps, type Env } from "./types";

export async function handleReview(req: Request, env: Env, deps: Deps): Promise<Response> {
  const email = await deps.verifyAccess(req, env);
  if (!email) return json({ error: "sign_in" }, 401);
  if (!(await reviewerName(env, email))) return json({ error: "not_a_reviewer" }, 403);
  const { pathname } = new URL(req.url);
  let b: Record<string, unknown> = {};
  if (req.method === "POST") { try { b = (await req.json()) as Record<string, unknown>; } catch {} }

  const owned = await handleOwnerReview(pathname, req.method, b, env, email);
  if (owned) return owned;

  const heard = await handleRecordingReview(req, pathname, b, env, email);
  if (heard) return heard;

  const words = await handleWords(pathname, req.method, b, env, email);
  if (words) return words;

  if (pathname === "/review/api/next" && req.method === "GET") {
    const card = await claimNext(env.DB, email, deps.now());
    return card ? json(card) : new Response(null, { status: 204 });
  }
  if (pathname === "/review/api/queue" && req.method === "GET") return json({ waiting: (await waitingCounts(env.DB, email, deps.now())).answers });
  // Pass on this sentence without deciding it: it stays in the queue for others.
  if (pathname === "/review/api/skip" && req.method === "POST") {
    if (!isId(b.sentenceId)) return json({ error: "bad_request" }, 400);
    const skipped = await skipCard(env.DB, email, b.sentenceId as number, deps.now());
    return skipped ? json({ ok: true }) : json({ error: "not_found" }, 404);
  }
  if (pathname === "/review/api/glossary" && req.method === "GET") return json({ entries: await getGlossaryForReview(env) });
  if (pathname === "/review/api/glossary/hide" && req.method === "POST") {
    if (!isId(b.id) || (b.hidden !== undefined && typeof b.hidden !== "boolean")) return json({ error: "bad_request" }, 400);
    const hidden = b.hidden === false ? 0 : 1;
    const r = await env.DB.prepare("UPDATE glossary SET hidden = ?2 WHERE id = ?1").bind(b.id, hidden).run();
    return r.meta.changes ? json({ ok: true, hidden: hidden === 1 }) : json({ error: "not_found" }, 404);
  }
  // A word that is already in the list can be wrong. A reviewer fixes it here.
  if (pathname === "/review/api/glossary/edit" && req.method === "POST") {
    const paite = cleanText(b.paite, 60), english = cleanText(b.english, 120);
    const blankNote = b.note === undefined || b.note === null || (typeof b.note === "string" && !b.note.trim());
    const note = blankNote ? null : cleanText(b.note, 200);
    if (!isId(b.id) || !paite || !english || (!blankNote && !note)) return json({ error: "bad_request" }, 400);
    try {
      const r = await env.DB.prepare("UPDATE glossary SET paite = ?2, english = ?3, note = ?4, edited_by = ?5, edited_at = datetime('now') WHERE id = ?1")
        .bind(b.id, cap(paite), cap(english), note, email).run();
      return r.meta.changes ? json({ ok: true }) : json({ error: "not_found" }, 404);
    } catch (e) {
      // The unique index on (word, meaning) refuses a correction that copies an existing row.
      // D1 words it "UNIQUE constraint failed: index 'glossary_unique'", so match the short form.
      if (/UNIQUE constraint failed/i.test(String(e))) return json({ error: "duplicate", message: "That word and meaning are already in the list." }, 409);
      throw e;
    }
  }
  // Sayings: the lane that was missing. Candidates and whole submitted pairs, listed.
  if (pathname === "/review/api/proverbs" && req.method === "GET") return json(await getProverbReviewList(env, email, deps.now()));
  if (pathname === "/review/api/proverbs/answer" && req.method === "POST") {
    const d = readProverbDecision(b);
    if (d === null) return json({ error: "bad_request" }, 400);
    const r = await decideProverbAnswer(env, email, b.id as number, d.accept, d.opts);
    if (r === "not_found") return json({ error: "not_found" }, 404);
    if (r === "duplicate") return json({ error: "duplicate", message: "That Paite line already belongs to another saying." }, 409);
    return json({ ok: true, waiting: r === "waiting", required: REQUIRED_REVIEWERS });
  }
  // The contributor's choice of proverb or idiom is a guess; the reviewer may correct it.
  if (pathname === "/review/api/proverbs/kind" && req.method === "POST") {
    if (!isId(b.proverbId) || !["proverb", "idiom"].includes(b.kind as string)) return json({ error: "bad_request" }, 400);
    const r = await env.DB.prepare("UPDATE proverbs SET kind = ?2 WHERE id = ?1").bind(b.proverbId, b.kind).run();
    return r.meta.changes ? json({ ok: true }) : json({ error: "not_found" }, 404);
  }
  if (pathname === "/review/api/proverbs/undo" && req.method === "POST") {
    if (!isId(b.proverbId)) return json({ error: "bad_request" }, 400);
    const ok = await undoProverbReview(env, email, b.proverbId as number);
    return ok ? json({ ok: true }) : json({ error: "nothing_to_undo" }, 404);
  }
  if (pathname === "/review/api/proverbs/skip" && req.method === "POST") {
    if (!isId(b.proverbId)) return json({ error: "bad_request" }, 400);
    const ok = await skipProverbSaying(env, email, b.proverbId as number, deps.now());
    return ok ? json({ ok: true }) : json({ error: "not_found" }, 404);
  }
  // Whole card: accept one line (with a correction if the reviewer made one), keep
  // others as variants, reject the rest, or reject all, or retire the saying.
  if (pathname === "/review/api/proverbs/save" && req.method === "POST") {
    if (!isId(b.proverbId)) return json({ error: "bad_request" }, 400);
    if (b.acceptAnswerId !== undefined && !isId(b.acceptAnswerId)) return json({ error: "bad_request" }, 400);
    if (b.finalPaite !== undefined && typeof b.finalPaite !== "string") return json({ error: "bad_request" }, 400);
    if (b.note !== undefined && typeof b.note !== "string") return json({ error: "bad_request" }, 400);
    if (b.alsoCorrect !== undefined && !isIdList(b.alsoCorrect)) return json({ error: "bad_request" }, 400);
    const r = await saveProverbReview(env, email, {
      proverbId: b.proverbId as number,
      acceptAnswerId: b.acceptAnswerId as number | undefined,
      finalPaite: b.finalPaite as string | undefined,
      alsoCorrect: b.alsoCorrect as number[] | undefined,
      note: b.note as string | undefined,
      rejectAll: b.rejectAll === true,
      retire: b.retire === true,
      acceptPublished: b.acceptPublished === true,
    });
    if (r === "not_found") return json({ error: "not_found" }, 404);
    if (r === "bad_answer") return json({ error: "bad_answer", message: "That line is no longer open for review." }, 400);
    if (r === "duplicate") return json({ error: "duplicate", message: "That Paite line already belongs to another saying." }, 409);
    return json({ ok: true, waiting: r === "waiting", required: REQUIRED_REVIEWERS });
  }
  if (pathname === "/review/api/proverbs/pair" && req.method === "POST") {
    const d = readProverbDecision(b);
    if (d === null) return json({ error: "bad_request" }, 400);
    const r = await decideProverbPair(env, email, b.id as number, d.accept, d.opts);
    if (r === "not_found") return json({ error: "not_found" }, 404);
    return json({ ok: true, waiting: r === "waiting", required: REQUIRED_REVIEWERS });
  }
  if (pathname === "/review/api/decide" && req.method === "POST") {
    if (!isId(b.sentenceId) || !["accept", "reject", "retire", "variant"].includes(b.decision as string) || !isIdList(b.answerIds) || (b.alsoCorrect !== undefined && !isIdList(b.alsoCorrect)) || (b.decision === "accept" && !isId(b.answerId))) return json({ error: "bad_request" }, 400);
    const result = await decide(env.DB, email, deps.now(), b as unknown as Decision);
    if (result === "no_lock") return json({ error: "lock_lost" }, 409);
    if (result === "bad_answer") return json({ error: "bad_answer" }, 400);
    return json({ ok: true, reviewId: result });
  }
  if (pathname === "/review/api/undo" && req.method === "POST") {
    if (!isId(b.reviewId)) return json({ error: "bad_request" }, 400);
    const result = await undo(env.DB, b.reviewId as number, email, isOwner(env, email));
    if (result === "ok") return json({ ok: true });
    return json({ error: result, reason: result }, result === "missing" ? 404 : result === "not_yours" ? 403 : 409);
  }
  if (pathname === "/review/api/me" && req.method === "GET") {
    // The newest review by this person that is still undoable; null when none is.
    const last = await env.DB.prepare(
      `SELECT id FROM reviews WHERE reviewer_email = ?1 AND undone_at IS NULL
         AND id > (SELECT COALESCE(MAX(last_review_id), 0) FROM exports) ORDER BY id DESC LIMIT 1`).bind(email).first<{ id: number }>();
    return json({ name: await reviewerName(env, email), owner: isOwner(env, email), lastReviewId: last?.id ?? null });
  }
  if (pathname === "/review/api/link-phone" && req.method === "POST") {
    if (!isPhoneId(b.phoneId)) return json({ error: "bad_request" }, 400);
    await env.DB.prepare("INSERT INTO reviewer_phones (phone_id, reviewer_email) VALUES (?1, ?2) ON CONFLICT (phone_id) DO UPDATE SET reviewer_email = excluded.reviewer_email")
      .bind(b.phoneId.toLowerCase(), email).run();
    return json({ ok: true });
  }
  if (pathname === "/review/api/health" && req.method === "GET") {
    if (!isOwner(env, email)) return json({ error: "owner_only" }, 403);
    return json({ failing: (await failingJobs(env.DB)).map((f) => ({ job: f.job, lastAt: f.lastAt, detail: f.lastDetail })) });
  }
  if (pathname === "/review/api/errors" && req.method === "GET") {
    if (!isOwner(env, email)) return json({ error: "owner_only" }, 403);
    return json({ errors: await recentErrors(env) });
  }
  if (pathname === "/review/api/analytics" && req.method === "GET") {
    if (!isOwner(env, email)) return json({ error: "owner_only" }, 403);
    const days = Number(new URL(req.url).searchParams.get("days"));
    return json(await analytics(env, Number.isInteger(days) && days > 0 && days <= 90 ? days : 7));
  }
  return json({ error: "not_found" }, 404);
}
