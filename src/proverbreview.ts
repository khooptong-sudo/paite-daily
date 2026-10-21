// Reviewer lane for sayings, built to match the sentence lane.
//
// The sentence lane works like this: a contributor submits an answer, a
// reviewer accepts one answer (optionally supplying final_paite, a corrected
// text that sits beside the original), marks others as also_correct or
// rejected, and the prompt becomes verified. This file does the same for
// sayings, with one addition: two different reviewers must accept before the
// saying publishes, because a saying is reference text rather than an exercise.
//
// Decisions are recorded in proverb_reviews, which mirrors `reviews`:
//   accept  with final_paite  the line as it should read, corrected or not
//   variant                   keep it as an accepted alternative
//   reject                    throw it away
//
// No locks. The sentence lane locks a card so two reviewers do not collide;
// this lane is a list a reviewer works down, like the glossary lane.
import type { Env } from "./types";

// One reviewer publishes. The second submission is a comparison, not a second
// signature: it arrives later, beside the line that already published.
export const REQUIRED_REVIEWERS = 1;

export type ProverbAnswerRow = {
  id: number;
  proverb_id: number;
  paite: string;
  explainer: string | null;
  explainer_en: string | null;
  contributor_name: string | null;
  created_at: string;
  english: string | null;
  kind: string;
  current_paite: string | null;
  accepts: number;
  mine: number;
};

export type ProverbPairRow = {
  id: number;
  kind: string;
  paite: string;
  english: string;
  explainer: string | null;
  explainer_en: string | null;
  contributor_name: string | null;
  created_at: string;
  accepts: number;
  mine: number;
};

export type ProverbDecision = "accept" | "reject" | "variant";

const clip = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");
const cleanText = (v: unknown, n: number) => clip(v, n).replace(/\s+/g, " ");

/** Everything waiting on a reviewer: candidate Paite lines first, then whole sayings. */
export async function getProverbReviewList(
  env: Env,
  email: string,
  now = Date.now(),
): Promise<{ answers: ProverbAnswerRow[]; pairs: ProverbPairRow[]; required: number }> {
  const answers = await env.DB.prepare(
    `SELECT a.id, a.proverb_id, a.paite, a.explainer, a.explainer_en, a.contributor_name, a.created_at,
            p.english, p.kind, p.paite AS current_paite,
            (SELECT count(DISTINCT lower(r.reviewer_email)) FROM proverb_reviews r
              WHERE r.answer_id = a.id AND r.decision = 'accept' AND r.undone_at IS NULL) AS accepts,
            (SELECT count(*) FROM proverb_reviews r
              WHERE r.answer_id = a.id AND r.decision = 'accept' AND r.undone_at IS NULL
                AND lower(r.reviewer_email) = lower(?1)) AS mine
       FROM proverb_answers a
       JOIN proverbs p ON p.id = a.proverb_id
      WHERE a.status = 'new'
        AND (p.status IN ('open', 'pending') OR (p.status = 'live' AND p.accepting_more = 1))
        AND NOT EXISTS (SELECT 1 FROM proverb_skips k
                         WHERE k.proverb_id = p.id AND k.until > ?2 AND lower(k.reviewer_email) = lower(?1))
      ORDER BY a.created_at, a.id
      LIMIT 200`,
  )
    .bind(email, now)
    .all<ProverbAnswerRow>();
  const pairs = await env.DB.prepare(
    `SELECT p.id, p.kind, p.paite, p.english, p.explainer, p.explainer_en, p.contributor_name, p.created_at,
            (SELECT count(DISTINCT lower(r.reviewer_email)) FROM proverb_reviews r
              WHERE r.proverb_id = p.id AND r.answer_id IS NULL AND r.decision = 'accept' AND r.undone_at IS NULL) AS accepts,
            (SELECT count(*) FROM proverb_reviews r
              WHERE r.proverb_id = p.id AND r.answer_id IS NULL AND r.decision = 'accept' AND r.undone_at IS NULL
                AND lower(r.reviewer_email) = lower(?1)) AS mine
       FROM proverbs p
      WHERE p.status = 'pending'
        AND NOT EXISTS (SELECT 1 FROM proverb_skips k
                         WHERE k.proverb_id = p.id AND k.until > ?2 AND lower(k.reviewer_email) = lower(?1))
      ORDER BY p.created_at, p.id
      LIMIT 200`,
  )
    .bind(email, now)
    .all<ProverbPairRow>();
  return {
    answers: answers.results ?? [],
    pairs: pairs.results ?? [],
    required: REQUIRED_REVIEWERS,
  };
}

/**
 * Withdraw this reviewer's most recent decision on a saying. Every answer the
 * review touched goes back to 'new', and if that review is what published the
 * saying, the saying goes back to waiting with no Paite line.
 */
export async function undoProverbReview(env: Env, email: string, proverbId: number): Promise<boolean> {
  const r = await env.DB.prepare(
    `SELECT id, answer_id, answer_ids, published FROM proverb_reviews
      WHERE proverb_id = ?1 AND lower(reviewer_email) = lower(?2) AND undone_at IS NULL
      ORDER BY id DESC LIMIT 1`,
  )
    .bind(proverbId, email)
    .first<{ id: number; answer_id: number | null; answer_ids: string | null; published: number }>();
  if (!r) return false;

  let ids: number[] = [];
  if (r.answer_ids) {
    try {
      ids = JSON.parse(r.answer_ids);
    } catch {
      ids = [];
    }
  } else if (r.answer_id != null) {
    ids = [r.answer_id];
  }

  const stmts = [env.DB.prepare("UPDATE proverb_reviews SET undone_at = datetime('now') WHERE id = ?1").bind(r.id)];
  if (ids.length) {
    stmts.push(
      env.DB.prepare(
        `UPDATE proverb_answers SET status = 'new'
          WHERE proverb_id = ?1 AND id IN (SELECT value FROM json_each(?2))
            AND status IN ('accepted', 'also_correct', 'rejected')`,
      ).bind(proverbId, JSON.stringify(ids)),
    );
  }
  if (r.published) {
    stmts.push(
      env.DB.prepare(
        `UPDATE proverbs SET status = 'open', paite = NULL, accepting_more = 0,
                reviewed_by = NULL, reviewed_at = NULL WHERE id = ?1`,
      ).bind(proverbId),
    );
  }
  await env.DB.batch(stmts);
  return true;
}

/**
 * Pass on a saying for two hours. It stays in everyone else's queue.
 * Returns false when the saying is gone or already settled.
 */
export async function skipProverbSaying(env: Env, email: string, proverbId: number, now: number): Promise<boolean> {
  const p = await env.DB.prepare(
    "SELECT 1 AS ok FROM proverbs WHERE id = ?1 AND (status IN ('open', 'pending') OR (status = 'live' AND accepting_more = 1))",
  )
    .bind(proverbId)
    .first<{ ok: number }>();
  if (!p) return false;
  await env.DB.batch([
    env.DB.prepare("DELETE FROM proverb_skips WHERE proverb_id = ?1 AND lower(reviewer_email) = lower(?2)").bind(proverbId, email),
    env.DB.prepare("INSERT INTO proverb_skips (proverb_id, reviewer_email, until) VALUES (?1, ?2, ?3)").bind(
      proverbId,
      email,
      now + 2 * 60 * 60 * 1000,
    ),
  ]);
  return true;
}

/**
 * One reviewer's decision on one candidate line.
 *
 * accept   record an accept, with the text they settled on. The first accept
 *          holds the line; the second, from a different reviewer, publishes it.
 * variant  keep the line as an accepted alternative. It leaves the queue and
 *          does not count towards publishing.
 * reject   throw it away. One rejection is final.
 */
export async function decideProverbAnswer(
  env: Env,
  email: string,
  id: number,
  accept: boolean,
  opts: { decision?: ProverbDecision; finalPaite?: string; note?: string } = {},
): Promise<"ok" | "waiting" | "not_found" | "duplicate"> {
  const decision: ProverbDecision = opts.decision ?? (accept ? "accept" : "reject");
  const note = opts.note ? cleanText(opts.note, 300) : null;

  const a = await env.DB.prepare(
    `SELECT a.proverb_id, a.paite, a.explainer, a.explainer_en
       FROM proverb_answers a
       JOIN proverbs p ON p.id = a.proverb_id
      WHERE a.id = ?1 AND a.status = 'new' AND p.status IN ('open', 'pending')`,
  )
    .bind(id)
    .first<{ proverb_id: number; paite: string; explainer: string | null; explainer_en: string | null }>();
  if (!a) return "not_found";

  if (decision === "reject") {
    await env.DB.batch([
      env.DB.prepare("UPDATE proverb_answers SET status = 'rejected' WHERE id = ?1 AND status = 'new'").bind(id),
      env.DB.prepare("DELETE FROM proverb_reviews WHERE answer_id = ?1").bind(id),
    ]);
    return "ok";
  }

  if (decision === "variant") {
    await env.DB.batch([
      env.DB.prepare(
        "INSERT OR IGNORE INTO proverb_reviews (proverb_id, answer_id, reviewer_email, decision, note) VALUES (?1, ?2, ?3, 'variant', ?4)",
      ).bind(a.proverb_id, id, email, note),
      env.DB.prepare("UPDATE proverb_answers SET status = 'also_correct' WHERE id = ?1 AND status = 'new'").bind(id),
    ]);
    return "ok";
  }

  // A correction is the reviewer's text, kept beside the contributor's original.
  // Accepting without one leaves it NULL, so an earlier correction still wins.
  const finalPaite = opts.finalPaite !== undefined ? cleanText(opts.finalPaite, 300) : null;
  if (opts.finalPaite !== undefined && !finalPaite) return "not_found";

  await env.DB.prepare(
    `INSERT OR IGNORE INTO proverb_reviews (proverb_id, answer_id, reviewer_email, decision, final_paite, note)
     VALUES (?1, ?2, ?3, 'accept', ?4, ?5)`,
  )
    .bind(a.proverb_id, id, email, finalPaite, note)
    .run();

  const n = await env.DB.prepare(
    `SELECT count(DISTINCT lower(reviewer_email)) AS n FROM proverb_reviews
      WHERE answer_id = ?1 AND decision = 'accept' AND undone_at IS NULL`,
  )
    .bind(id)
    .first<{ n: number }>();
  if ((n?.n ?? 0) < REQUIRED_REVIEWERS) return "waiting";

  // Publish with the most recently settled text, which is the second reviewer's
  // correction when they made one and the first reviewer's otherwise.
  const settled = await env.DB.prepare(
    `SELECT final_paite FROM proverb_reviews
      WHERE answer_id = ?1 AND decision = 'accept' AND undone_at IS NULL AND final_paite IS NOT NULL
      ORDER BY id DESC LIMIT 1`,
  )
    .bind(id)
    .first<{ final_paite: string | null }>();

  try {
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE proverbs
            SET paite = ?2,
                explainer = COALESCE(?3, explainer),
                explainer_en = COALESCE(?4, explainer_en),
                status = 'live',
                accepting_more = 1,
                reviewed_by = ?5,
                reviewed_at = datetime('now')
          WHERE id = ?1`,
      ).bind(a.proverb_id, settled?.final_paite || a.paite, a.explainer, a.explainer_en, email),
      env.DB.prepare("UPDATE proverb_answers SET status = 'accepted' WHERE id = ?1").bind(id),
    ]);
  } catch (e) {
    // proverbs_paite_unique refuses a Paite line that already belongs to another saying.
    if (/UNIQUE constraint failed/i.test(String(e))) return "duplicate";
    throw e;
  }
  return "ok";
}

/** Accept, correct or reject a whole saying submitted from the front page. */
export async function decideProverbPair(
  env: Env,
  email: string,
  id: number,
  accept: boolean,
  opts: { decision?: ProverbDecision; finalPaite?: string; note?: string } = {},
): Promise<"ok" | "waiting" | "not_found"> {
  const decision: ProverbDecision = opts.decision ?? (accept ? "accept" : "reject");
  const note = opts.note ? cleanText(opts.note, 300) : null;

  const p = await env.DB.prepare("SELECT paite FROM proverbs WHERE id = ?1 AND status = 'pending'")
    .bind(id)
    .first<{ paite: string | null }>();
  if (!p) return "not_found";

  if (decision === "reject") {
    await env.DB.batch([
      env.DB.prepare("UPDATE proverbs SET status = 'hidden' WHERE id = ?1 AND status = 'pending'").bind(id),
      env.DB.prepare("DELETE FROM proverb_reviews WHERE proverb_id = ?1 AND answer_id IS NULL").bind(id),
    ]);
    return "ok";
  }

  if (decision === "variant") {
    await env.DB.prepare(
      "INSERT OR IGNORE INTO proverb_reviews (proverb_id, answer_id, reviewer_email, decision, note) VALUES (?1, NULL, ?2, 'variant', ?3)",
    )
      .bind(id, email, note)
      .run();
    return "ok";
  }

  const finalPaite = opts.finalPaite !== undefined ? cleanText(opts.finalPaite, 300) : null;
  await env.DB.prepare(
    `INSERT OR IGNORE INTO proverb_reviews (proverb_id, answer_id, reviewer_email, decision, final_paite, note)
     VALUES (?1, NULL, ?2, 'accept', ?3, ?4)`,
  )
    .bind(id, email, finalPaite, note)
    .run();

  const n = await env.DB.prepare(
    `SELECT count(DISTINCT lower(reviewer_email)) AS n FROM proverb_reviews
      WHERE proverb_id = ?1 AND answer_id IS NULL AND decision = 'accept' AND undone_at IS NULL`,
  )
    .bind(id)
    .first<{ n: number }>();
  if ((n?.n ?? 0) < REQUIRED_REVIEWERS) return "waiting";

  const settled = await env.DB.prepare(
    `SELECT final_paite FROM proverb_reviews
      WHERE proverb_id = ?1 AND answer_id IS NULL AND decision = 'accept' AND undone_at IS NULL AND final_paite IS NOT NULL
      ORDER BY id DESC LIMIT 1`,
  )
    .bind(id)
    .first<{ final_paite: string | null }>();

  await env.DB.prepare(
    `UPDATE proverbs SET status = 'live', accepting_more = 1, paite = COALESCE(?2, paite),
            reviewed_by = ?3, reviewed_at = datetime('now')
      WHERE id = ?1 AND status = 'pending'`,
  )
    .bind(id, settled?.final_paite || p.paite, email)
    .run();
  return "ok";
}
