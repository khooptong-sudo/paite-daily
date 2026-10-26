import { finalPaite } from "./final";
import { json, type Env } from "./types";

// Is this spelled right? Each Paite word is checked against the words people have
// already used in verified sentences and in the public word list. A word seen there
// is attested; an unseen word gets the closest attested spellings, most used first.
// Nothing is generated: an unseen word may simply be new, and the page says so.

const MAX_TEXT = 500, MAX_SUGGEST = 3, TTL = 10 * 60_000;

/** Lower-case Paite words in a line, apostrophes kept (a', ka'), numbers dropped. */
export const paiteWords = (text: string): string[] =>
  (text.toLowerCase().normalize("NFC").match(/\p{L}[\p{L}'’]*/gu) ?? []).map((w) => w.replace(/’/g, "'"));

/** Edit distance with swaps counted as one, stopping early once it passes `max`. */
export function distance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    let rowMin = Infinity;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      rowMin = Math.min(rowMin, d[i][j]);
    }
    if (rowMin > max) return max + 1;
  }
  return d[a.length][b.length];
}

let cache: { at: number; words: Map<string, number> } | null = null;
export const clearSpellingCache = () => { cache = null; };

/** Every attested word with how often it appears; rebuilt at most every ten minutes per worker. */
export async function vocabulary(env: Env, now: number): Promise<Map<string, number>> {
  if (cache && now - cache.at < TTL) return cache.words;
  const [sentences, list] = await env.DB.batch<{ p: string }>([
    // Only answers into Paite: a Paite-to-English answer is English.
    env.DB.prepare(`SELECT ${finalPaite("a")} AS p FROM answers a JOIN sentences s ON s.id = a.sentence_id WHERE a.status IN ('accepted', 'also_correct') AND s.direction = 'en2pai'`),
    env.DB.prepare("SELECT paite AS p FROM glossary WHERE hidden = 0"),
  ]);
  const words = new Map<string, number>();
  for (const r of [...sentences.results, ...list.results]) for (const w of paiteWords(r.p ?? "")) words.set(w, (words.get(w) ?? 0) + 1);
  cache = { at: now, words };
  return words;
}

export function suggest(word: string, words: Map<string, number>): { word: string; count: number }[] {
  const max = word.length <= 4 ? 1 : 2;
  const near: { word: string; count: number; d: number }[] = [];
  for (const [w, count] of words) {
    const d = distance(word, w, max);
    if (d <= max) near.push({ word: w, count, d });
  }
  return near.sort((x, y) => x.d - y.d || y.count - x.count).slice(0, MAX_SUGGEST).map(({ word, count }) => ({ word, count }));
}

/** POST /api/spelling and /review/api/spelling: { text } -> each distinct word, seen or not, with suggestions for the unseen. */
export async function checkSpelling(env: Env, b: Record<string, unknown>, now: number): Promise<Response> {
  const text = typeof b.text === "string" ? b.text.trim() : "";
  if (!text || text.length > MAX_TEXT) return json({ error: "bad_request" }, 400);
  const words = await vocabulary(env, now);
  const seen = new Set<string>();
  const out: { word: string; count: number; suggestions?: { word: string; count: number }[] }[] = [];
  for (const w of paiteWords(text)) {
    if (seen.has(w)) continue;
    seen.add(w);
    const count = words.get(w) ?? 0;
    out.push(count ? { word: w, count } : { word: w, count: 0, suggestions: suggest(w, words) });
  }
  return json({ words: out, unseen: out.filter((w) => !w.count).length });
}
