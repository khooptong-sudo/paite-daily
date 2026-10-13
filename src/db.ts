export async function nextSentence(db: D1Database, phoneId: string): Promise<{ id: number; english: string } | null> {
  return db
    .prepare(
      `SELECT s.id, s.english FROM sentences s
       WHERE s.status = 'open' AND s.answer_count < 2
         AND NOT EXISTS (SELECT 1 FROM seen WHERE seen.phone_id = ?1 AND seen.sentence_id = s.id)
       ORDER BY random() LIMIT 1`,
    )
    .bind(phoneId)
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
): Promise<"ok" | "closed"> {
  const claim = await db
    .prepare(
      `UPDATE sentences
         SET answer_count = answer_count + 1,
             status = CASE WHEN answer_count + 1 >= 2 THEN 'full' ELSE status END
       WHERE id = ?1 AND status = 'open' AND answer_count < 2
         AND NOT EXISTS (SELECT 1 FROM seen WHERE phone_id = ?2 AND sentence_id = ?1)`,
    )
    .bind(a.sentenceId, a.phoneId)
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
