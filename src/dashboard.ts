import { waitingCounts } from "./digest";

type Queue = { waiting: number; oldest: string | null };
type Row = { n: number; oldest: string | null };

/** Every review queue in one place: how many wait, and since when. */
export async function reviewDashboard(
  db: D1Database,
  email: string,
  now: number,
): Promise<{ sentences: Queue; words: Queue; pauUpa: Queue; recordings: Queue }> {
  const one = async (sql: string): Promise<Queue> => {
    const r = await db.prepare(sql).first<Row>();
    return { waiting: r?.n ?? 0, oldest: r?.oldest ?? null };
  };
  // Sentences: the same count the queue badge shows (answers this reviewer can still pick up).
  // The oldest date ignores locks and skips, so it is the oldest in the whole queue.
  const sentences = await one(
    `SELECT 0 AS n, min(a.created_at) AS oldest FROM answers a
     JOIN sentences s ON s.id = a.sentence_id WHERE a.status = 'new' AND s.status IN ('open', 'full')`,
  );
  sentences.waiting = (await waitingCounts(db, email, now)).answers;
  // Pau Upa: new answers on sayings that are collecting, plus whole sayings waiting to be checked.
  const [a, p] = await Promise.all([
    one(
      `SELECT count(*) AS n, min(a.created_at) AS oldest FROM proverb_answers a JOIN proverbs p ON p.id = a.proverb_id
        WHERE a.status = 'new' AND (p.status IN ('open', 'pending') OR (p.status = 'live' AND p.accepting_more = 1))`,
    ),
    one("SELECT count(*) AS n, min(created_at) AS oldest FROM proverbs WHERE status = 'pending'"),
  ]);
  const pauUpa: Queue = {
    waiting: a.waiting + p.waiting,
    oldest: [a.oldest, p.oldest].filter((x): x is string => !!x).sort()[0] ?? null,
  };
  return {
    sentences,
    words: await one("SELECT count(*) AS n, min(created_at) AS oldest FROM word_submissions WHERE status = 'pending'"),
    pauUpa,
    recordings: await one("SELECT count(*) AS n, min(created_at) AS oldest FROM recordings WHERE status = 'pending'"),
  };
}
