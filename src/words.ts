import { cap, cleanText, isId } from "./text";
import { json, type Env } from "./types";

const DAILY_LIMIT = 20;
const opt = (v: unknown, max: number) => (v === undefined || v === null || v === "" ? null : cleanText(v, max));

// POST /api/word, after the contributor session check. Duplicates answer 200 without inserting.
export async function submitWord(env: Env, phoneId: string, b: Record<string, unknown>): Promise<Response> {
  const paite = cleanText(b.paite, 60), english = cleanText(b.english, 120), note = opt(b.note, 200), name = opt(b.name, 60);
  if (!paite || !english || (b.note && !note) || (b.name && !name)) return json({ error: "bad_request" }, 400);
  const n = await env.DB.prepare("SELECT count(*) AS n FROM word_submissions WHERE phone_id = ?1 AND created_at > datetime('now', '-1 day')").bind(phoneId).first<{ n: number }>();
  if ((n?.n ?? 0) >= DAILY_LIMIT) return json({ error: "slow_down" }, 429);
  const dup = await env.DB.prepare(
    `SELECT 1 FROM glossary WHERE lower(paite) = lower(?1) AND lower(english) = lower(?2)
     UNION ALL SELECT 1 FROM word_submissions WHERE status IN ('pending', 'rejected') AND lower(paite) = lower(?1) AND lower(english) = lower(?2)`,
  ).bind(paite, english).first();
  if (!dup) await env.DB.prepare("INSERT INTO word_submissions (paite, english, note, phone_id, contributor_name) VALUES (?1, ?2, ?3, ?4, ?5)").bind(cap(paite), cap(english), note, phoneId, name).run();
  return json({ ok: true });
}

/** One word from the public list that this phone has not answered yet, or null when it has seen them all. */
export async function nextWordToTranslate(env: Env, phoneId: string): Promise<{ id: number; paite: string } | null> {
  const r = await env.DB.prepare(
    `SELECT g.id, g.paite FROM glossary g
     WHERE g.hidden = 0
       AND NOT EXISTS (SELECT 1 FROM word_submissions w WHERE w.phone_id = ?1 AND lower(w.paite) = lower(g.paite))
     ORDER BY random() LIMIT 1`,
  ).bind(phoneId).first<{ id: number; paite: string }>();
  return r ? { id: r.id, paite: cap(r.paite) } : null;
}

/** POST /api/word/meaning: the meaning the contributor gives to a word the page showed them. */
export async function submitMeaning(env: Env, phoneId: string, b: Record<string, unknown>): Promise<Response> {
  const english = cleanText(b.english, 120), note = opt(b.note, 200), name = opt(b.name, 60);
  if (!isId(b.id) || !english || (b.note && !note) || (b.name && !name)) return json({ error: "bad_request" }, 400);
  const word = await env.DB.prepare("SELECT paite FROM glossary WHERE id = ?1 AND hidden = 0").bind(b.id).first<{ paite: string }>();
  if (!word) return json({ error: "not_found" }, 404);
  const n = await env.DB.prepare("SELECT count(*) AS n FROM word_submissions WHERE phone_id = ?1 AND created_at > datetime('now', '-1 day')").bind(phoneId).first<{ n: number }>();
  if ((n?.n ?? 0) >= DAILY_LIMIT) return json({ error: "slow_down" }, 429);
  const paite = cap(word.paite);
  const dup = await env.DB.prepare(
    `SELECT 1 FROM glossary WHERE lower(paite) = lower(?1) AND lower(english) = lower(?2)
     UNION ALL SELECT 1 FROM word_submissions WHERE status IN ('pending', 'rejected') AND lower(paite) = lower(?1) AND lower(english) = lower(?2)`,
  ).bind(paite, english).first();
  if (!dup) await env.DB.prepare("INSERT INTO word_submissions (paite, english, note, phone_id, contributor_name, source) VALUES (?1, ?2, ?3, ?4, ?5, 'meaning')")
    .bind(paite, cap(english), note, phoneId, name).run();
  return json({ ok: true });
}

// Reviewer routes. Returns null when the path is not a word route.
export async function handleWords(pathname: string, method: string, b: Record<string, unknown>, env: Env, email: string): Promise<Response | null> {
  if (pathname === "/review/api/words/pending" && method === "GET") {
    const { results } = await env.DB.prepare("SELECT id, paite, english, note, contributor_name AS name, source FROM word_submissions WHERE status = 'pending' ORDER BY id LIMIT 50").all();
    return json({ words: results.map((r: any) => ({ ...r, paite: cap(r.paite), english: cap(r.english) })) });
  }
  if (pathname === "/review/api/words/decide" && method === "POST") {
    if (!isId(b.id) || !["approve", "reject"].includes(b.decision as string)) return json({ error: "bad_request" }, 400);
    const approve = b.decision === "approve";
    // Only the request that flips pending -> decided may insert, so a second decision cannot double-insert.
    const r = await env.DB.prepare("UPDATE word_submissions SET status = ?1, decided_at = datetime('now'), decided_by = ?2 WHERE id = ?3 AND status = 'pending'")
      .bind(approve ? "approved" : "rejected", email, b.id).run();
    if (!r.meta.changes) return json({ error: "already_decided" }, 409);
    if (approve) {
      await env.DB.prepare("INSERT OR IGNORE INTO glossary (paite, english, note, source, contributor_name) SELECT paite, english, note, 'contributed', contributor_name FROM word_submissions WHERE id = ?1").bind(b.id).run();
    }
    return json({ ok: true });
  }
  return null;
}
