import { cleanText } from "./text";

const LOCK_MS = 10 * 60_000;

export type ReviewCard = {
  sentence: { id: number; english: string };
  answers: { id: number; paite: string; register: string; contributor_name: string | null; explanation: string | null; ai_note: string | null; ai_flag: string | null }[];
};

export type Decision = {
  sentenceId: number;
  decision: "accept" | "reject" | "retire";
  answerIds: number[];
  answerId?: number;
  finalPaite?: string;
  register?: string;
  note?: string;
  alsoCorrect?: number[];
};

export async function claimNext(db: D1Database, email: string, now: number): Promise<ReviewCard | null> {
  const candidates = await db
    .prepare(
      `SELECT s.id, s.english FROM sentences s
       WHERE s.status IN ('open', 'full')
         AND EXISTS (SELECT 1 FROM answers a WHERE a.sentence_id = s.id AND a.status = 'new')
         AND NOT EXISTS (SELECT 1 FROM locks l WHERE l.sentence_id = s.id AND l.expires_at > ?1 AND l.reviewer_email <> ?2)
       ORDER BY CASE
           WHEN EXISTS (SELECT 1 FROM answers a WHERE a.sentence_id = s.id AND a.status = 'new' AND a.ai_flag IN ('junk', 'english')) THEN 2
           WHEN s.ai_agree = 1 THEN 0 ELSE 1 END,
         (s.status = 'full') DESC, s.id
       LIMIT 5`,
    )
    .bind(now, email)
    .all<{ id: number; english: string }>();
  for (const s of candidates.results) {
    const lock = await db
      .prepare(
        `INSERT INTO locks (sentence_id, reviewer_email, expires_at) VALUES (?1, ?2, ?3)
         ON CONFLICT (sentence_id) DO UPDATE SET reviewer_email = excluded.reviewer_email, expires_at = excluded.expires_at
         WHERE locks.expires_at <= ?4 OR locks.reviewer_email = excluded.reviewer_email`,
      )
      .bind(s.id, email, now + LOCK_MS, now)
      .run();
    if (lock.meta.changes !== 1) continue;
    const answers = await db
      .prepare("SELECT id, paite, register, contributor_name, explanation, ai_note, ai_flag FROM answers WHERE sentence_id = ?1 AND status = 'new' ORDER BY id")
      .bind(s.id)
      .all<ReviewCard["answers"][number]>();
    return { sentence: s, answers: answers.results };
  }
  return null;
}

async function holdsLock(db: D1Database, sentenceId: number, email: string, now: number): Promise<boolean> {
  const l = await db.prepare("SELECT 1 AS ok FROM locks WHERE sentence_id = ?1 AND reviewer_email = ?2 AND expires_at > ?3")
    .bind(sentenceId, email, now).first();
  return !!l;
}

export async function decide(db: D1Database, email: string, now: number, d: Decision): Promise<number | "no_lock" | "bad_answer"> {
  if (!(await holdsLock(db, d.sentenceId, email, now))) return "no_lock";
  const note = d.note ? cleanText(d.note, 300) : null;
  const register = ["spoken", "written", "both"].includes(d.register ?? "") ? d.register! : null;
  const ids = JSON.stringify(d.answerIds);
  // every id served by the card must still be a new answer of this sentence
  const ok = await db.prepare("SELECT count(*) AS n FROM answers WHERE sentence_id = ?1 AND status = 'new' AND id IN (SELECT value FROM json_each(?2))")
    .bind(d.sentenceId, ids).first<{ n: number }>();
  if (!d.answerIds.length || ok?.n !== new Set(d.answerIds).size) return "bad_answer";
  // Every write is guarded by the caller's live lock; the lock is deleted last, so a second submit writes nothing.
  const G = "EXISTS (SELECT 1 FROM locks WHERE sentence_id = ?1 AND reviewer_email = ?2 AND expires_at > ?3)";
  const stmts: D1PreparedStatement[] = [];

  if (d.decision === "accept") {
    if (!d.answerIds.includes(d.answerId as number)) return "bad_answer";
    const chosen = await db.prepare("SELECT paite, register FROM answers WHERE id = ?1").bind(d.answerId).first<{ paite: string; register: string }>();
    if (!chosen) return "bad_answer";
    const finalPaite = d.finalPaite !== undefined ? cleanText(d.finalPaite, 300) : chosen.paite;
    if (!finalPaite) return "bad_answer";
    const also = (d.alsoCorrect ?? []).filter((x) => x !== d.answerId && d.answerIds.includes(x));
    stmts.push(
      db.prepare(`INSERT INTO reviews (sentence_id, reviewer_email, decision, accepted_answer_id, final_paite, register, note, answer_ids)
        SELECT ?1, ?2, 'accept', ?4, ?5, ?6, ?7, ?8 WHERE ${G}`).bind(d.sentenceId, email, now, d.answerId, finalPaite, register ?? chosen.register, note, ids),
      db.prepare(`UPDATE answers SET status = 'also_correct' WHERE sentence_id = ?1 AND status = 'new' AND id IN (SELECT value FROM json_each(?4)) AND ${G}`)
        .bind(d.sentenceId, email, now, JSON.stringify(also)),
      db.prepare(`UPDATE answers SET status = 'accepted' WHERE id = ?4 AND status = 'new' AND ${G}`).bind(d.sentenceId, email, now, d.answerId),
      db.prepare(`UPDATE answers SET status = 'rejected' WHERE sentence_id = ?1 AND status = 'new' AND id IN (SELECT value FROM json_each(?4)) AND ${G}`)
        .bind(d.sentenceId, email, now, ids),
      db.prepare(`UPDATE sentences SET status = 'verified' WHERE id = ?1 AND ${G}`).bind(d.sentenceId, email, now),
    );
  } else {
    stmts.push(
      db.prepare(`INSERT INTO reviews (sentence_id, reviewer_email, decision, note, answer_ids) SELECT ?1, ?2, ?4, ?5, ?6 WHERE ${G}`)
        .bind(d.sentenceId, email, now, d.decision, note, ids),
      db.prepare(`UPDATE answers SET status = 'rejected' WHERE sentence_id = ?1 AND status = 'new' AND id IN (SELECT value FROM json_each(?4)) AND ${G}`)
        .bind(d.sentenceId, email, now, ids),
      d.decision === "reject"
        ? db.prepare(`UPDATE sentences SET answer_count = (SELECT min(count(*), 2) FROM answers WHERE sentence_id = ?1 AND status = 'new'),
            status = CASE WHEN (SELECT count(*) FROM answers WHERE sentence_id = ?1 AND status = 'new') >= 2 THEN 'full' ELSE 'open' END WHERE id = ?1 AND ${G}`).bind(d.sentenceId, email, now)
        : db.prepare(`UPDATE sentences SET status = 'retired' WHERE id = ?1 AND ${G}`).bind(d.sentenceId, email, now),
    );
  }
  stmts.push(db.prepare("DELETE FROM locks WHERE sentence_id = ?1 AND reviewer_email = ?2").bind(d.sentenceId, email));
  const res = await db.batch(stmts);
  return res[0].meta.changes === 1 ? res[0].meta.last_row_id : "no_lock";
}

export async function undo(db: D1Database, reviewId: number): Promise<"ok" | "exported" | "missing" | "not_latest"> {
  const r = await db.prepare("SELECT sentence_id FROM reviews WHERE id = ?1 AND undone_at IS NULL").bind(reviewId).first<{ sentence_id: number }>();
  if (!r) return "missing";
  const last = await db.prepare("SELECT COALESCE(MAX(last_review_id), 0) AS n FROM exports").first<{ n: number }>();
  if (reviewId <= (last?.n ?? 0)) return "exported";
  const latest = await db.prepare("SELECT MAX(id) AS n FROM reviews WHERE sentence_id = ?1 AND undone_at IS NULL").bind(r.sentence_id).first<{ n: number }>();
  if (latest?.n !== reviewId) return "not_latest";
  await db.batch([
    db.prepare("UPDATE reviews SET undone_at = datetime('now') WHERE id = ?1").bind(reviewId),
    db.prepare("UPDATE answers SET status = 'new' WHERE sentence_id = ?2 AND id IN (SELECT value FROM json_each((SELECT COALESCE(answer_ids, '[]') FROM reviews WHERE id = ?1)))").bind(reviewId, r.sentence_id),
    db.prepare(`UPDATE sentences SET answer_count = (SELECT min(count(*), 2) FROM answers WHERE sentence_id = ?1 AND status = 'new'),
        status = CASE WHEN (SELECT count(*) FROM answers WHERE sentence_id = ?1 AND status = 'new') >= 2 THEN 'full' ELSE 'open' END WHERE id = ?1`).bind(r.sentence_id),
  ]);
  return "ok";
}
