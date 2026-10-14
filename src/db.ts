export async function nextSentence(db: D1Database, phoneId: string, now: number): Promise<{ id: number; english: string } | null> {
  return db
    .prepare(
      `SELECT s.id, s.english FROM sentences s
       WHERE s.status = 'open' AND s.answer_count < 2
         AND NOT EXISTS (SELECT 1 FROM seen WHERE seen.phone_id = ?1 AND seen.sentence_id = s.id)
         AND NOT EXISTS (SELECT 1 FROM locks WHERE sentence_id = s.id AND expires_at > ?2)
       ORDER BY random() LIMIT 1`,
    )
    .bind(phoneId, now)
    .first<{ id: number; english: string }>();
}

export async function skipSentence(db: D1Database, phoneId: string, sentenceId: number): Promise<void> {
  await db.prepare("INSERT OR IGNORE INTO seen (phone_id, sentence_id, action) SELECT ?1, id, 'skipped' FROM sentences WHERE id = ?2").bind(phoneId, sentenceId).run();
}

export type Register = "spoken" | "written" | "both";

export async function answersInLastMinute(db: D1Database, phoneId: string): Promise<number> {
  const r = await db
    .prepare("SELECT count(*) AS n FROM answers WHERE phone_id = ?1 AND created_at > datetime('now', '-60 seconds')")
    .bind(phoneId)
    .first<{ n: number }>();
  return r?.n ?? 0;
}

/**
 * Claims a slot with one conditional UPDATE, so two simultaneous second answers
 * cannot both succeed. Only the winner inserts its answer.
 */
export async function recordAnswer(
  db: D1Database,
  a: { phoneId: string; sentenceId: number; paite: string; register: Register; name: string | null },
  now: number,
): Promise<"ok" | "closed"> {
  const claim = await db
    .prepare(
      `UPDATE sentences
         SET answer_count = answer_count + 1,
             status = CASE WHEN answer_count + 1 >= 2 THEN 'full' ELSE status END
       WHERE id = ?1 AND status = 'open' AND answer_count < 2
         AND NOT EXISTS (SELECT 1 FROM seen WHERE phone_id = ?2 AND sentence_id = ?1)
         AND NOT EXISTS (SELECT 1 FROM locks WHERE sentence_id = ?1 AND expires_at > ?3)`,
    )
    .bind(a.sentenceId, a.phoneId, now)
    .run();
  if (claim.meta.changes !== 1) return "closed";
  try {
    await db.batch([
      db.prepare("INSERT INTO answers (sentence_id, paite, register, phone_id, contributor_name) VALUES (?1, ?2, ?3, ?4, ?5)")
        .bind(a.sentenceId, a.paite, a.register, a.phoneId, a.name),
      db.prepare("INSERT INTO seen (phone_id, sentence_id, action) VALUES (?1, ?2, 'answered')").bind(a.phoneId, a.sentenceId),
    ]);
  } catch (e) {
    await db
      .prepare("UPDATE sentences SET answer_count = answer_count - 1, status = 'open' WHERE id = ?1 AND status IN ('open', 'full')")
      .bind(a.sentenceId)
      .run();
    throw e;
  }
  return "ok";
}

export type FeedbackItem = { reviewId: number; english: string; yours: string; result: "correct" | "fixed" | "other" | "retry"; corrected: string | null; note: string | null };

// Latest not-undone review per sentence that covered one of this phone's answers; retired sentences are left out.
export async function feedbackFor(db: D1Database, phoneId: string, after: number): Promise<FeedbackItem[]> {
  const rows = await db
    .prepare(
      `SELECT r.id AS reviewId, s.english, a.paite AS yours, r.decision, r.accepted_answer_id AS acc, r.final_paite AS fin, a.id AS aid, a.status, r.note
       FROM reviews r
       JOIN sentences s ON s.id = r.sentence_id AND s.status <> 'retired'
       JOIN answers a ON a.sentence_id = r.sentence_id AND a.phone_id = ?1
         AND a.id IN (SELECT value FROM json_each(COALESCE(r.answer_ids, '[]')))
       WHERE r.id > ?2 AND r.undone_at IS NULL AND r.decision <> 'retire'
         AND r.id = (SELECT MAX(id) FROM reviews WHERE sentence_id = r.sentence_id AND undone_at IS NULL)
       ORDER BY r.id DESC, a.id LIMIT 20`,
    )
    .bind(phoneId, after)
    .all<{ reviewId: number; english: string; yours: string; decision: string; acc: number | null; fin: string | null; aid: number; status: string; note: string | null }>();
  return rows.results.map((x) => {
    const mine = x.decision === "accept" && x.acc === x.aid;
    const result = x.decision === "reject" ? "retry" : mine ? (x.fin === x.yours ? "correct" : "fixed") : x.status === "also_correct" ? "correct" : "other";
    return { reviewId: x.reviewId, english: x.english, yours: x.yours, result, corrected: result === "fixed" || result === "other" ? x.fin : null, note: x.note };
  });
}
