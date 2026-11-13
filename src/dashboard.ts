import { waitingCounts } from "./digest";
import { ownBinds, ownSql, ownWaiting, type Me } from "./own";

type Queue = { waiting: number; oldest: string | null };
type Row = { n: number; oldest: string | null };

/**
 * Every review queue in one place: how many wait, and since when. With me, the counts leave out
 * this reviewer's own submissions, and `own` says how many of those wait for another reviewer.
 */
export async function reviewDashboard(
  db: D1Database,
  email: string,
  now: number,
  me?: Me,
): Promise<{ sentences: Queue; words: Queue; pauUpa: Queue; recordings: Queue; own?: number }> {
  const S = { e: 1, n: 2, o: 3, t: 4 };
  // not(...) adds "AND NOT <own-submission SQL>" when me is given, and nothing otherwise.
  const not = (phone: string, name: string, created: string) => (me ? ` AND NOT ${ownSql(phone, name, created, S)}` : "");
  const one = async (sql: string): Promise<Queue> => {
    const q = db.prepare(sql);
    const r = await (me && sql.includes("?1") ? q.bind(...ownBinds(me)) : q).first<Row>();
    return { waiting: r?.n ?? 0, oldest: r?.oldest ?? null };
  };
  // Sentences: the same count the queue badge shows (answers this reviewer can still pick up).
  // The oldest date ignores locks and skips, so it is the oldest in the whole queue.
  const sentences = await one(
    `SELECT 0 AS n, min(a.created_at) AS oldest FROM answers a
     JOIN sentences s ON s.id = a.sentence_id WHERE a.status = 'new' AND s.status IN ('open', 'full')`,
  );
  sentences.waiting = (await waitingCounts(db, email, now, me)).answers;
  // Pau Upa: new answers on sayings that are collecting, plus whole sayings waiting to be checked.
  // A saying holding one of this reviewer's own fresh lines is left out whole, as in the list.
  const ownLine = me
    ? ` AND NOT EXISTS (SELECT 1 FROM proverb_answers o WHERE o.proverb_id = p.id AND o.status = 'new' AND ${ownSql("o.phone_id", "o.contributor_name", "o.created_at", S)})`
    : "";
  const [a, p] = await Promise.all([
    one(
      `SELECT count(*) AS n, min(a.created_at) AS oldest FROM proverb_answers a JOIN proverbs p ON p.id = a.proverb_id
        WHERE a.status = 'new' AND (p.status IN ('open', 'pending') OR (p.status = 'live' AND p.accepting_more = 1))${ownLine}`,
    ),
    one(`SELECT count(*) AS n, min(p.created_at) AS oldest FROM proverbs p WHERE p.status = 'pending'${not("p.submitted_by", "p.contributor_name", "p.created_at")}`),
  ]);
  const pauUpa: Queue = {
    waiting: a.waiting + p.waiting,
    oldest: [a.oldest, p.oldest].filter((x): x is string => !!x).sort()[0] ?? null,
  };
  const out = {
    sentences,
    words: await one(`SELECT count(*) AS n, min(w.created_at) AS oldest FROM word_submissions w WHERE w.status = 'pending'${not("w.phone_id", "w.contributor_name", "w.created_at")}`),
    pauUpa,
    recordings: await one(`SELECT count(*) AS n, min(r.created_at) AS oldest FROM recordings r WHERE r.status = 'pending'${not("r.phone_id", "r.contributor_name", "r.created_at")}`),
  };
  return me ? { ...out, own: await ownWaiting(db, me) } : out;
}
