import type { Env } from "./types";

export type Week = { sent: number; verified: number; words: number; rank: number | null };

/** One phone's last seven days: what it sent, what a reviewer accepted in that time, words, and its place by sent. */
export async function weekFor(env: Env, phoneId: string, now: number): Promise<Week> {
  const r = await env.DB.prepare(
    `WITH since(t) AS (SELECT datetime(?2 / 1000, 'unixepoch', '-7 days')),
          mine AS (SELECT count(*) AS n FROM answers, since WHERE phone_id = ?1 AND created_at >= t)
     SELECT (SELECT n FROM mine) AS sent,
            (SELECT count(*) FROM answers a, since WHERE a.phone_id = ?1 AND a.status IN ('accepted', 'also_correct')
               AND EXISTS (SELECT 1 FROM reviews v WHERE v.accepted_answer_id = a.id AND v.undone_at IS NULL AND v.created_at >= t)) AS verified,
            (SELECT count(*) FROM word_submissions, since WHERE phone_id = ?1 AND created_at >= t) AS words,
            (SELECT count(*) FROM (SELECT phone_id, count(*) AS c FROM answers, since WHERE created_at >= t GROUP BY phone_id)
               WHERE c > (SELECT n FROM mine)) AS ahead`,
  ).bind(phoneId, now).first<{ sent: number; verified: number; words: number; ahead: number }>();
  return { sent: r!.sent, verified: r!.verified, words: r!.words, rank: r!.sent > 0 ? r!.ahead + 1 : null };
}
