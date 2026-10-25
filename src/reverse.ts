import { finalPaite } from "./final";
import type { Env } from "./types";

// Only for accepts that are already exported (undo is blocked after export). One Paite -> English prompt per accepted answer (not also_correct) of an en2pai sentence. The unique index on source_answer_id makes this idempotent.
// The prompt shows the reviewer's final text when there is one. sentences.english keeps the original English for the round-trip check.
export async function runReverse(env: Env): Promise<{ created: number } | null> {
  const r = await env.DB.prepare(
    `INSERT OR IGNORE INTO sentences (english, english_key, source, direction, source_answer_id, paite_prompt)
     SELECT s.english, 'rev:' || a.id, 'reverse', 'pai2en', a.id,
       ${finalPaite("a")}
     FROM answers a JOIN sentences s ON s.id = a.sentence_id
     WHERE a.status = 'accepted' AND s.direction = 'en2pai'
       AND EXISTS (SELECT 1 FROM reviews r WHERE r.accepted_answer_id = a.id AND r.decision = 'accept' AND r.undone_at IS NULL
         AND r.id <= (SELECT COALESCE(MAX(last_review_id), 0) FROM exports))
       AND NOT EXISTS (SELECT 1 FROM sentences x WHERE x.source_answer_id = a.id)`,
  ).run();
  return r.meta.changes ? { created: r.meta.changes } : null;
}
