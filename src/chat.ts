import { finalPaite } from "./final";
import { cap, cleanText, normaliseEnglish } from "./text";
import type { Env } from "./types";

/**
 * Sample conversations for the front page.
 *
 * The English lines are curated here; every Paite line is looked up in the corpus
 * at request time. A scene can therefore never show a rendering that has not been
 * reviewed, and it heals itself when a pair is corrected or retired.
 */

export type Turn = { side: "they" | "me"; paite: string; english: string };
export type Scene = { key: string; label: string; turns: Turn[] };

const SCENES: { key: string; label: string; lines: string[] }[] = [
  { key: "greet", label: "Greetings", lines: ["Good morning.", "How are you?", "I am fine, thank you.", "What is your name?", "My name is Lalmuan."] },
  { key: "table", label: "At the table", lines: ["Have you eaten?", "I have already eaten.", "Come and eat with us.", "The rice is ready.", "This food is very tasty."] },
  { key: "village", label: "The village", lines: ["Our village is far from here.", "How far is the town?", "It takes one hour by bus.", "The bus is late again.", "Wait for me here."] },
  { key: "market", label: "At the market", lines: ["How much does this cost?", "It is too expensive.", "Give me a lower price.", "I will buy two.", "Do you have change?"] },
  { key: "learn", label: "Learning Paite", lines: ["I am learning Paite.", "Teach me one new word.", "Please say it again.", "I understand a little.", "How do you say this in Paite?"] },
];

/** Compared without case, punctuation or doubled spaces. */
const key = (s: string) => normaliseEnglish(s).replace(/[^\p{L}\p{N}'\s]/gu, " ").replace(/\s+/g, " ").trim();

// Words that carry no meaning on their own; matching on them produces noise.
// Question words stay in: "how much is this" must not collapse to nothing.
const STOP = new Set(
  "a an the is are am was were be been being do does did done to of in on at for from by with and or but if i you he she it we they me him her us them my your his its our their this that these those have has had not no yes can could will would should shall may might must please there here".split(" "),
);

const tokens = (s: string) => key(s).split(" ").filter((w) => w && !STOP.has(w));

/**
 * The reviewed pairs a visitor may see: an accepted answer on a verified sentence,
 * no untranslated leftovers, no "either/or" strings.
 */
const PAIRS = `SELECT s.english, ${finalPaite("a")} AS paite FROM sentences s
  JOIN answers a ON a.id = (SELECT r.accepted_answer_id FROM reviews r
                              WHERE r.sentence_id = s.id AND r.undone_at IS NULL AND r.accepted_answer_id IS NOT NULL
                              ORDER BY r.id DESC LIMIT 1)
  WHERE s.status = 'verified'`;

type Pair = { english: string; paite: string };

async function pairs(env: Env): Promise<Pair[]> {
  const { results } = await env.DB.prepare(PAIRS).all<Pair>();
  // A rendering that repeats the English was never translated; two question marks
  // means two alternatives were accepted at once. Neither belongs in a demo.
  return (results ?? [])
    .filter((p) => key(p.paite) !== key(p.english) && !p.paite.includes("/") && (p.paite.match(/\?/g) ?? []).length <= 1)
    .map((p) => ({ english: cap(p.english), paite: cap(p.paite) }));
}

export async function buildScenes(env: Env): Promise<Scene[]> {
  const have = new Map((await pairs(env)).map((p) => [key(p.english), p.paite]));
  return SCENES.map((s) => {
    const turns: Turn[] = [];
    for (const line of s.lines) {
      const paite = have.get(key(line));
      if (paite) turns.push({ side: turns.length % 2 === 0 ? "they" : "me", paite, english: line });
    }
    return { key: s.key, label: s.label, turns };
  }).filter((s) => s.turns.length >= 3);
}

export type Match = { english: string; paite: string; score: number };

/**
 * Answer a typed line from the corpus, or nothing. Deliberately no generation:
 * a wrong Paite sentence taught to a visitor costs more than a missing one.
 */
export async function matchChat(env: Env, q: string): Promise<Match | null> {
  const want = tokens(q);
  if (!want.length) return null;
  const asked = key(q);
  let best: Match | null = null;
  for (const p of await pairs(env)) {
    const have = tokens(p.english);
    const shared = want.filter((w) => have.includes(w)).length;
    // F1 over the words that matter: a line with three extra words is a different
    // sentence, however many words it shares.
    const score = key(p.english) === asked ? 1 : (2 * shared) / (want.length + have.length);
    if (score > (best?.score ?? 0)) best = { english: p.english, paite: p.paite, score };
  }
  return best && best.score >= 0.7 ? best : null;
}

/** Remember a line somebody wanted that we could not answer. Deduped by wording. */
export async function recordWant(env: Env, raw: unknown): Promise<boolean> {
  const q = cleanText(raw, 120);
  if (!q || !/\p{L}/u.test(q)) return false;
  await env.DB.prepare(
    "INSERT INTO chat_wants (english, english_key) VALUES (?1, ?2) ON CONFLICT(english_key) DO UPDATE SET ask_count = ask_count + 1, last_at = datetime('now')",
  ).bind(q, normaliseEnglish(q)).run();
  return true;
}

/** The lines most wanted and not yet covered — the refill queue, in order. */
export async function wantedLines(env: Env, limit = 20): Promise<{ english: string; ask_count: number }[]> {
  const { results } = await env.DB.prepare(
    `SELECT w.english, w.ask_count FROM chat_wants w
      WHERE NOT EXISTS (SELECT 1 FROM sentences s WHERE s.english_key = w.english_key)
      ORDER BY w.ask_count DESC, w.last_at DESC LIMIT ?1`,
  ).bind(limit).all<{ english: string; ask_count: number }>();
  return results ?? [];
}
