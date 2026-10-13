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
  await db.prepare("INSERT OR IGNORE INTO seen (phone_id, sentence_id, action) VALUES (?1, ?2, 'skipped')").bind(phoneId, sentenceId).run();
}
