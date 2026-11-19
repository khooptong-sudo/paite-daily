import type { Env } from "./types";

const DAY = 86_400_000, IST = 19_800_000;
const sql = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace("T", " ");

// One named person whose work was verified yesterday (India time), else in the last 7 days. Same pick all day.
export async function contributorOfTheDay(env: Env, now: number): Promise<{ name: string; sentences: number; words: number; period: "day" | "week" } | null> {
  const today = new Date(now + IST).toISOString().slice(0, 10), end = Date.parse(today + "T00:00:00Z") - IST;
  for (const [days, period] of [[1, "day"], [7, "week"]] as const) {
    const from = sql(end - days * DAY), to = sql(end);
    const rows = (await env.DB.prepare(
      `SELECT * FROM (
         SELECT t.phone_id, t.sentences, t.words,
           COALESCE(
             (SELECT b.contributor_name FROM answers b WHERE b.phone_id = t.phone_id AND TRIM(COALESCE(b.contributor_name, '')) <> '' ORDER BY b.id DESC LIMIT 1),
             (SELECT w2.contributor_name FROM word_submissions w2 WHERE w2.phone_id = t.phone_id AND TRIM(COALESCE(w2.contributor_name, '')) <> '' ORDER BY w2.id DESC LIMIT 1)
           ) AS name
         FROM (
           SELECT phone_id, SUM(s) AS sentences, SUM(w) AS words FROM (
             SELECT a.phone_id, 1 AS s, 0 AS w FROM answers a WHERE a.status IN ('accepted', 'also_correct')
               AND EXISTS (SELECT 1 FROM reviews r WHERE r.decision = 'accept' AND r.undone_at IS NULL AND r.created_at >= ?1 AND r.created_at < ?2
                 AND a.id IN (SELECT value FROM json_each(COALESCE(r.answer_ids, '[]'))))
             UNION ALL
             SELECT phone_id, 0, 1 FROM word_submissions WHERE status = 'approved' AND decided_at >= ?1 AND decided_at < ?2
           ) GROUP BY phone_id
         ) t
       ) WHERE name IS NOT NULL ORDER BY phone_id`,
    ).bind(from, to).all<{ name: string; sentences: number; words: number }>()).results;
    if (!rows.length) continue;
    let h = 2166136261; // FNV-1a over the IST day
    for (const c of today) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
    const r = rows[h % rows.length];
    return { name: r.name.trim().replace(/\s+/g, " "), sentences: r.sentences, words: r.words, period };
  }
  return null;
}
