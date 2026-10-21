// Reviewer lane for sayings. The sentence queue only ever looked at `answers`,
// so proverb_answers accumulated at status 'new' with no way for a reviewer to
// see them. This file is the missing other half: a list, and two decisions.
//
// No locks. The sentence lane locks a card so two reviewers do not collide, but
// this lane is a list a reviewer works down, like the glossary lane.
import type { Env } from "./types";

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
};

/** Everything waiting on a reviewer: candidate Paite lines first, then whole sayings. */
export async function getProverbReviewList(env: Env): Promise<{ answers: ProverbAnswerRow[]; pairs: ProverbPairRow[] }> {
  const answers = await env.DB.prepare(
    `SELECT a.id, a.proverb_id, a.paite, a.explainer, a.explainer_en, a.contributor_name, a.created_at,
            p.english, p.kind, p.paite AS current_paite
       FROM proverb_answers a
       JOIN proverbs p ON p.id = a.proverb_id
      WHERE a.status = 'new' AND p.status IN ('open', 'pending')
      ORDER BY a.created_at, a.id
      LIMIT 200`,
  ).all<ProverbAnswerRow>();
  const pairs = await env.DB.prepare(
    `SELECT id, kind, paite, english, explainer, explainer_en, contributor_name, created_at
       FROM proverbs WHERE status = 'pending'
      ORDER BY created_at, id
      LIMIT 200`,
  ).all<ProverbPairRow>();
  return { answers: answers.results ?? [], pairs: pairs.results ?? [] };
}

/**
 * Accept or reject one candidate Paite line. Accepting publishes the saying:
 * the rendering becomes the Paite line, the saying goes live, the reviewer is
 * recorded, and every other pending rendering for it is rejected. One native
 * speaker is enough here, because a saying arrives as one submission rather
 * than as competing answers to a prompt.
 */
export async function decideProverbAnswer(
  env: Env,
  email: string,
  id: number,
  accept: boolean,
): Promise<"ok" | "not_found" | "duplicate"> {
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
    await env.DB.prepare("UPDATE proverb_answers SET status = 'rejected' WHERE id = ?1 AND status = 'new'").bind(id).run();
    return "ok";
  }

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

/** Accept or reject a whole saying that was submitted from the front page. */
export async function decideProverbPair(
  env: Env,
  email: string,
  id: number,
  accept: boolean,
): Promise<"ok" | "not_found"> {
  const r = await env.DB.prepare(
    `UPDATE proverbs
        SET status = ?2,
            reviewed_by = CASE WHEN ?2 = 'live' THEN ?3 ELSE reviewed_by END,
            reviewed_at = CASE WHEN ?2 = 'live' THEN datetime('now') ELSE reviewed_at END
      WHERE id = ?1 AND status = 'pending'`,
  )
    .bind(id, accept ? "live" : "hidden", email)
    .run();
  return r.meta.changes ? "ok" : "not_found";
}
