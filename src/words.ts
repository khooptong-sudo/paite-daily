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

// Reviewer routes. Returns null when the path is not a word route.
export async function handleWords(pathname: string, method: string, b: Record<string, unknown>, env: Env, email: string): Promise<Response | null> {
  if (pathname === "/review/api/words/pending" && method === "GET") {
    const { results } = await env.DB.prepare("SELECT id, paite, english, note, contributor_name AS name FROM word_submissions WHERE status = 'pending' ORDER BY id LIMIT 50").all();
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
