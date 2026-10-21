// Reviewer lane for sayings. The sentence queue only ever looked at `answers`,
// so proverb_answers accumulated at status 'new' with no way for a reviewer to
// see them. This file is the missing other half: a list, and two decisions.
//
// Two reviewers are needed before a saying goes live, the same rule the
// sentence lane applies. A candidate stays 'new' until the second acceptance,
// so a half-reviewed saying can never reach the public page.
//
// No locks. The sentence lane locks a card so two reviewers do not collide, but
// this lane is a list a reviewer works down, like the glossary lane.
import type { Env } from "./types";

export const REQUIRED_REVIEWERS = 2;

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

/** Everything waiting on a reviewer: candidate Paite lines first, then whole sayings. */
export async function getProverbReviewList(
  env: Env,
  email: string,
): Promise<{ answers: ProverbAnswerRow[]; pairs: ProverbPairRow[]; required: number }> {
  const answers = await env.DB.prepare(
    `SELECT a.id, a.proverb_id, a.paite, a.explainer, a.explainer_en, a.contributor_name, a.created_at,
            p.english, p.kind, p.paite AS current_paite,
            (SELECT count(DISTINCT lower(v.reviewer_email)) FROM proverb_votes v
              WHERE v.answer_id = a.id AND v.decision = 'accept') AS accepts,
            (SELECT count(*) FROM proverb_votes v
              WHERE v.answer_id = a.id AND v.decision = 'accept'
                AND lower(v.reviewer_email) = lower(?1)) AS mine
       FROM proverb_answers a
       JOIN proverbs p ON p.id = a.proverb_id
      WHERE a.status = 'new' AND p.status IN ('open', 'pending')
      ORDER BY a.created_at, a.id
      LIMIT 200`,
  )
    .bind(email)
    .all<ProverbAnswerRow>();
  const pairs = await env.DB.prepare(
    `SELECT p.id, p.kind, p.paite, p.english, p.explainer, p.explainer_en, p.contributor_name, p.created_at,
            (SELECT count(DISTINCT lower(v.reviewer_email)) FROM proverb_votes v
              WHERE v.proverb_id = p.id AND v.answer_id IS NULL AND v.decision = 'accept') AS accepts,
            (SELECT count(*) FROM proverb_votes v
              WHERE v.proverb_id = p.id AND v.answer_id IS NULL AND v.decision = 'accept'
                AND lower(v.reviewer_email) = lower(?1)) AS mine
       FROM proverbs p
      WHERE p.status = 'pending'
      ORDER BY p.created_at, p.id
      LIMIT 200`,
  )
    .bind(email)
    .all<ProverbPairRow>();
  return {
    answers: answers.results ?? [],
    pairs: pairs.results ?? [],
    required: REQUIRED_REVIEWERS,
  };
}

/**
 * Accept or reject one candidate Paite line. Accepting counts as one of the two
 * reviews needed; the second acceptance publishes the saying, records the
 * reviewers, and rejects the other candidates for it. A rejection is final on
 * its own, because one native speaker saying a rendering is wrong is enough.
 */
export async function decideProverbAnswer(
  env: Env,
  email: string,
  id: number,
  accept: boolean,
): Promise<"ok" | "waiting" | "not_found" | "duplicate"> {
  const a = await env.DB.prepare(
    `SELECT a.proverb_id, a.paite, a.explainer, a.explainer_en
       FROM proverb_answers a
       JOIN proverbs p ON p.id = a.proverb_id
      WHERE a.id = ?1 AND a.status = 'new' AND p.status IN ('open', 'pending')`,
  )
    .bind(id)
    .first<{ proverb_id: number; paite: string; explainer: string | null; explainer_en: string | null }>();
  if (!a) return "not_found";

  if (!accept) {
    await env.DB.batch([
      env.DB.prepare("UPDATE proverb_answers SET status = 'rejected' WHERE id = ?1 AND status = 'new'").bind(id),
      env.DB.prepare("DELETE FROM proverb_votes WHERE answer_id = ?1").bind(id),
    ]);
    return "ok";
  }

  await env.DB.prepare(
    "INSERT OR IGNORE INTO proverb_votes (proverb_id, answer_id, reviewer_email, decision) VALUES (?1, ?2, ?3, 'accept')",
  )
    .bind(a.proverb_id, id, email)
    .run();

  const n = await env.DB.prepare(
    "SELECT count(DISTINCT lower(reviewer_email)) AS n FROM proverb_votes WHERE answer_id = ?1 AND decision = 'accept'",
  )
    .bind(id)
    .first<{ n: number }>();
  if ((n?.n ?? 0) < REQUIRED_REVIEWERS) return "waiting";

  try {
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE proverbs
            SET paite = ?2,
                explainer = COALESCE(?3, explainer),
                explainer_en = COALESCE(?4, explainer_en),
                status = 'live',
                reviewed_by = ?5,
                reviewed_at = datetime('now')
          WHERE id = ?1`,
      ).bind(a.proverb_id, a.paite, a.explainer, a.explainer_en, email),
      env.DB.prepare("UPDATE proverb_answers SET status = 'accepted' WHERE id = ?1").bind(id),
      env.DB.prepare("UPDATE proverb_answers SET status = 'rejected' WHERE proverb_id = ?1 AND id <> ?2 AND status = 'new'")
        .bind(a.proverb_id, id),
    ]);
  } catch (e) {
    // proverbs_paite_unique refuses a Paite line that already belongs to another saying.
    if (/UNIQUE constraint failed/i.test(String(e))) return "duplicate";
    throw e;
  }
  return "ok";
}

/** Accept or reject a whole saying submitted from the front page. Same two-reviewer rule. */
export async function decideProverbPair(
  env: Env,
  email: string,
  id: number,
  accept: boolean,
): Promise<"ok" | "waiting" | "not_found"> {
  const p = await env.DB.prepare("SELECT 1 AS ok FROM proverbs WHERE id = ?1 AND status = 'pending'")
    .bind(id)
    .first<{ ok: number }>();
  if (!p) return "not_found";

  if (!accept) {
    await env.DB.batch([
      env.DB.prepare("UPDATE proverbs SET status = 'hidden' WHERE id = ?1 AND status = 'pending'").bind(id),
      env.DB.prepare("DELETE FROM proverb_votes WHERE proverb_id = ?1 AND answer_id IS NULL").bind(id),
    ]);
    return "ok";
  }

  await env.DB.prepare(
    "INSERT OR IGNORE INTO proverb_votes (proverb_id, answer_id, reviewer_email, decision) VALUES (?1, NULL, ?2, 'accept')",
  )
    .bind(id, email)
    .run();

  const n = await env.DB.prepare(
    "SELECT count(DISTINCT lower(reviewer_email)) AS n FROM proverb_votes WHERE proverb_id = ?1 AND answer_id IS NULL AND decision = 'accept'",
  )
    .bind(id)
    .first<{ n: number }>();
  if ((n?.n ?? 0) < REQUIRED_REVIEWERS) return "waiting";

  await env.DB.prepare(
    "UPDATE proverbs SET status = 'live', reviewed_by = ?2, reviewed_at = datetime('now') WHERE id = ?1 AND status = 'pending'",
  )
    .bind(id, email)
    .run();
  return "ok";
}
