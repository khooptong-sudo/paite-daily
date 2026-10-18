type Next = { id: number; english: string; direction?: "pai2en" };

// Every 5th card of a phone is a reverse (pai2en) prompt when one is free for it; otherwise, and when the other direction is empty, serve what exists.
// For a pai2en card, `english` holds the Paite text to translate.
export async function nextSentence(db: D1Database, phoneId: string, now: number): Promise<Next | null> {
  const forward = () => db
    .prepare(
      `SELECT s.id, s.english FROM sentences s
       WHERE s.status = 'open' AND s.answer_count < 2 AND s.direction = 'en2pai'
         AND NOT EXISTS (SELECT 1 FROM seen WHERE seen.phone_id = ?1 AND seen.sentence_id = s.id)
         AND NOT EXISTS (SELECT 1 FROM locks WHERE sentence_id = s.id AND expires_at > ?2)
       ORDER BY random() LIMIT 1`,
    )
    .bind(phoneId, now)
    .first<Next>();
  const reverse = () => db
    .prepare(
      `SELECT s.id, s.paite_prompt AS english, 'pai2en' AS direction FROM sentences s
       WHERE s.status = 'open' AND s.answer_count < 2 AND s.direction = 'pai2en'
         AND NOT EXISTS (SELECT 1 FROM seen WHERE seen.phone_id = ?1 AND seen.sentence_id = s.id)
         AND NOT EXISTS (SELECT 1 FROM locks WHERE sentence_id = s.id AND expires_at > ?2)
         AND NOT EXISTS (SELECT 1 FROM answers a JOIN seen sn ON sn.sentence_id = a.sentence_id AND sn.phone_id = ?1 WHERE a.id = s.source_answer_id)
       ORDER BY random() LIMIT 1`,
    )
    .bind(phoneId, now)
    .first<Next>();
  const n = (await db.prepare("SELECT count(*) AS n FROM seen WHERE phone_id = ?1").bind(phoneId).first<{ n: number }>())?.n ?? 0;
  for (const pick of n % 5 === 4 ? [reverse, forward] : [forward, reverse]) {
    const s = await pick();
    if (s) return s;
  }
  return null;
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
  a: { phoneId: string; sentenceId: number; paite: string; register: Register; name: string | null; explanation?: string | null },
  now: number,
): Promise<"ok" | "closed"> {
  const claim = await db
    .prepare(
      `UPDATE sentences
         SET answer_count = answer_count + 1,
             status = CASE WHEN answer_count + 1 >= 2 THEN 'full' ELSE status END
       WHERE id = ?1 AND status = 'open' AND answer_count < 2
         AND NOT EXISTS (SELECT 1 FROM seen WHERE phone_id = ?2 AND sentence_id = ?1)
         AND NOT EXISTS (SELECT 1 FROM locks WHERE sentence_id = ?1 AND expires_at > ?3)
         AND NOT EXISTS (SELECT 1 FROM answers sa JOIN seen sn ON sn.sentence_id = sa.sentence_id AND sn.phone_id = ?2 WHERE sa.id = sentences.source_answer_id)`,
    )
    .bind(a.sentenceId, a.phoneId, now)
    .run();
  if (claim.meta.changes !== 1) return "closed";
  try {
    await db.batch([
      db.prepare("INSERT INTO answers (sentence_id, paite, register, phone_id, contributor_name, explanation) VALUES (?1, ?2, ?3, ?4, ?5, ?6)")
        .bind(a.sentenceId, a.paite, a.register, a.phoneId, a.name, a.explanation ?? null),
      db.prepare("INSERT INTO seen (phone_id, sentence_id, action) VALUES (?1, ?2, 'answered')").bind(a.phoneId, a.sentenceId),
    ]);
  } catch (e) {
    await db
      .prepare("UPDATE sentences SET answer_count = answer_count - 1, status = 'open' WHERE id = ?1 AND status IN ('open', 'full')")
      .bind(a.sentenceId)
      .run()
      .catch((err) => console.error("recordAnswer compensation failed", a.sentenceId, err));
    if (/UNIQUE constraint failed: seen\./.test(String(e))) return "closed"; // same phone raced itself (double tap)
    throw e;
  }
  return "ok";
}

export type FeedbackItem = { reviewId: number; english: string; yours: string; result: "correct" | "fixed" | "other" | "retry"; corrected: string | null; note: string | null; reviewer: string | null; direction?: "pai2en" };

// Latest not-undone review per sentence that covered one of this phone's answers; retired sentences are left out.
export async function feedbackFor(db: D1Database, phoneId: string, after: number): Promise<FeedbackItem[]> {
  const rows = await db
    .prepare(
      `SELECT r.id AS reviewId, CASE WHEN s.direction = 'pai2en' THEN s.paite_prompt ELSE s.english END AS english, s.direction, a.paite AS yours, r.decision, r.accepted_answer_id AS acc, r.final_paite AS fin, a.id AS aid, a.status, r.note, rv.name AS reviewer
       FROM reviews r
       JOIN sentences s ON s.id = r.sentence_id AND s.status <> 'retired'
       JOIN answers a ON a.sentence_id = r.sentence_id AND a.phone_id = ?1
         AND a.id IN (SELECT value FROM json_each(COALESCE(r.answer_ids, '[]')))
       LEFT JOIN reviewers rv ON lower(rv.email) = lower(r.reviewer_email)
       WHERE r.id > ?2 AND r.undone_at IS NULL AND r.decision <> 'retire'
         AND r.id = (SELECT MAX(id) FROM reviews WHERE sentence_id = r.sentence_id AND undone_at IS NULL)
       ORDER BY r.id DESC, a.id LIMIT 20`,
    )
    .bind(phoneId, after)
    .all<{ reviewId: number; english: string; direction: string; yours: string; decision: string; acc: number | null; fin: string | null; aid: number; status: string; note: string | null; reviewer: string | null }>();
  return rows.results.map((x) => {
    const mine = x.decision === "accept" && x.acc === x.aid;
    const result = x.decision === "reject" ? "retry" : mine ? (x.fin === x.yours ? "correct" : "fixed") : x.status === "also_correct" ? "correct" : "other";
    return { reviewId: x.reviewId, english: x.english, yours: x.yours, result, corrected: result === "fixed" || result === "other" ? x.fin : null, note: x.note, reviewer: x.reviewer, ...(x.direction === "pai2en" && { direction: "pai2en" as const }) };
  });
}
