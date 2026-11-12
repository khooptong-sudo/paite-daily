import { aiConfig, AIHttpError, askJSON } from "./ai";
import type { Env } from "./types";

const FLAGS = ["ok", "tedim_style", "english", "junk"];

const SYSTEM = `You check Paite (Zomi, ISO 639-3 pck) translations of an English sentence for human reviewers. You never decide correctness; a human decides.
Reply with JSON only: {"answers":[{"id":<int>,"note":"<max 140 chars, English>","flag":"ok|tedim_style|english|junk"}],"agree":true|false}
flag "tedim_style": the answer uses Tedim/Bible-style markers: nong, hiam (question), zong (even), or a final hi on a statement. Modern Paite uses hia, le, and often no final hi.
flag "english": the answer is English instead of Paite.
flag "junk": gibberish, spam or unrelated text.
flag "ok": none of the above.
"agree": true when the answers mean the same thing.`;

const SYSTEM_REV = `You check English translations of a Paite (Zomi, ISO 639-3 pck) sentence for human reviewers. You never decide correctness; a human decides. You are given the Paite sentence, the original English it was translated from, and answers written by contributors.
Reply with JSON only: {"answers":[{"id":<int>,"note":"<max 140 chars, English, say whether the meaning matches the original English>","flag":"ok|english|junk"}],"agree":true|false}
flag "ok": the answer is English and its meaning matches the original English.
flag "english": the answer is not English (for example it is Paite).
flag "junk": gibberish, spam or unrelated text.
"agree": true when the answers mean the same thing.`;

type Row = { id: number; sentence_id: number; english: string; direction: string; paite_prompt: string | null; paite: string; ai_note: string | null };

async function noteSentence(env: Env, fetcher: typeof fetch, rows: Row[]): Promise<number> {
  const attempts = rows.filter((r) => r.ai_note === null).map((r) => env.DB.prepare("UPDATE answers SET ai_attempts = ai_attempts + 1 WHERE id = ?1").bind(r.id));
  // A thrown fetch counts as an attempt (so it cannot retry forever); an HTTP error does not.
  let out: any;
  try {
    out = await askJSON(env, fetcher, {
      system: rows[0].direction === "pai2en" ? SYSTEM_REV : SYSTEM,
      user: `${rows[0].direction === "pai2en" ? `Paite: ${rows[0].paite_prompt}\nOriginal English: ${rows[0].english}` : `English: ${rows[0].english}`}\nAnswers: ${JSON.stringify(rows.map((r) => ({ id: r.id, paite: r.paite })))}`,
      timeoutMs: 20_000,
      exact: true,
    });
  } catch (e) {
    // A provider's HTTP error is retried as is; a network failure or unreadable reply counts as an attempt.
    if (!(e instanceof AIHttpError)) await env.DB.batch(attempts);
    throw e;
  }
  const sent = new Set(rows.map((r) => r.id));
  const stmts: D1PreparedStatement[] = [];
  for (const a of Array.isArray(out.answers) ? out.answers : []) {
    if (!sent.has(a?.id) || rows.find((r) => r.id === a.id)!.ai_note !== null || typeof a.note !== "string" || !FLAGS.includes(a.flag)) continue;
    stmts.push(env.DB.prepare("UPDATE answers SET ai_note = ?1, ai_flag = ?2 WHERE id = ?3 AND ai_note IS NULL").bind(a.note.trim().slice(0, 140), a.flag, a.id));
  }
  if (!stmts.length) { await env.DB.batch(attempts); throw new Error("no valid answers"); }
  const written = stmts.length;
  if (typeof out.agree === "boolean") stmts.push(env.DB.prepare("UPDATE sentences SET ai_agree = ?1 WHERE id = ?2").bind(out.agree ? 1 : 0, rows[0].sentence_id));
  await env.DB.batch([...attempts, ...stmts]);
  return written;
}

export async function runPrereview(env: Env, fetcher: typeof fetch): Promise<{ noted: number; failed: number } | null> {
  if (!(await aiConfig(env))) return null;
  const ids = (await env.DB.prepare(
    "SELECT sentence_id FROM answers WHERE ai_note IS NULL AND status = 'new' AND ai_attempts < 3 GROUP BY sentence_id ORDER BY min(ai_attempts), min(id) LIMIT 20",
  ).all<{ sentence_id: number }>()).results.map((r) => r.sentence_id);
  if (!ids.length) return null;
  const { results } = await env.DB.prepare(
    `SELECT a.id, a.sentence_id, s.english, s.direction, s.paite_prompt, a.paite, a.ai_note FROM answers a JOIN sentences s ON s.id = a.sentence_id
     WHERE a.status IN ('new', 'accepted') AND a.sentence_id IN (${ids.map(() => "?").join(",")}) ORDER BY a.id`,
  ).bind(...ids).all<Row>();
  if (!results.some((r) => r.ai_note === null)) return null;
  const bySentence = new Map<number, Row[]>(ids.map((i) => [i, []]));
  for (const r of results) bySentence.get(r.sentence_id)!.push(r);
  let noted = 0, failed = 0;
  for (const rows of bySentence.values()) {
    try { noted += await noteSentence(env, fetcher, rows); } catch (e) { console.error("prereview", String(e)); failed += rows.filter((r) => r.ai_note === null).length; }
  }
  return { noted, failed };
}
