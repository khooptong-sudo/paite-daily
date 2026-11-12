import { aiConfig, askJSON } from "./ai";
import { cleanText } from "./text";
import { json, type Env } from "./types";

// Check English: a suggestion only. Nothing is changed until the person taps Use this,
// and a reviewer's correction still has the final word.
export const PER_MINUTE = 10;
export const PER_DAY = 200;

const SYSTEM = `You fix the English grammar, spelling and punctuation of one short line.
The line is a translation in a Paite-English language dataset, so its meaning must not change.
Rules:
- Fix only grammar, spelling, capitalisation and punctuation.
- Never change the meaning, never add or remove information, never swap words for synonyms.
- Keep names, places and any Paite words exactly as written.
- Never translate. If the line is not English, return it unchanged.
- If the line is already correct, return it unchanged.
Reply with JSON only: {"fixed": "<the line>"}`;

/** The model's corrected line, or null when it gave nothing usable. */
export async function fixEnglish(env: Env, text: string, fetcher: typeof fetch): Promise<string | null> {
  let fixed: unknown;
  try { fixed = (await askJSON(env, fetcher, { system: SYSTEM, user: text, timeoutMs: 15_000, exact: true }))?.fixed; } catch { return null; }
  const out = cleanText(fixed, 600);
  // A "fix" far longer than the line rewrote it rather than corrected it.
  return out && out.length <= text.length * 1.5 + 20 ? out : null;
}

/** POST body {text}; `who` is the phone id or reviewer email the limit is counted against. */
export async function checkGrammar(env: Env, who: string, b: Record<string, unknown>, now: number, fetcher: typeof fetch): Promise<Response> {
  const text = cleanText(b.text, 500);
  if (!text) return json({ error: "bad_request" }, 400);
  if (!(await aiConfig(env))) return json({ error: "unavailable" }, 503);
  const used = await env.DB.prepare("SELECT SUM(at > ?2 - 60000) AS m, count(*) AS d FROM grammar_checks WHERE who = ?1 AND at > ?2 - 86400000")
    .bind(who, now).first<{ m: number | null; d: number }>();
  if ((used!.m ?? 0) >= PER_MINUTE || used!.d >= PER_DAY) return json({ error: "slow_down" }, 429);
  await env.DB.batch([
    env.DB.prepare("INSERT INTO grammar_checks (who, at) VALUES (?1, ?2)").bind(who, now),
    env.DB.prepare("DELETE FROM grammar_checks WHERE at < ?1").bind(now - 86400000),
  ]);
  let fixed: string | null;
  try { fixed = await fixEnglish(env, text, fetcher); } catch { fixed = null; }
  if (!fixed) return json({ error: "unavailable" }, 503);
  return json({ suggestion: fixed, changed: fixed !== text });
}
