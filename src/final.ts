/**
 * The Paite a reader may see for an answer row: the reviewer's correction when one
 * accepted this answer, otherwise the answer as the contributor wrote it (an also-correct
 * variant keeps its own words). `a` is the SQL alias of the answers table.
 * A reviewer's correction always stands over the submission.
 */
export const finalPaite = (a: string) =>
  `COALESCE((SELECT r.final_paite FROM reviews r WHERE r.accepted_answer_id = ${a}.id AND r.decision = 'accept' AND r.undone_at IS NULL ORDER BY r.id DESC LIMIT 1), ${a}.paite)`;
