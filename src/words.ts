import { cap, cleanText, isId } from "./text";
import { json, type Env } from "./types";
import { ownBinds, ownSql, type Me } from "./own";

const opt = (v: unknown, max: number) => (v === undefined || v === null || v === "" ? null : cleanText(v, max));

// Case-insensitive for every letter, not just ASCII: SQLite's lower() leaves Ṭ, É and the like alone.
const fold = (s: string) => s.trim().normalize("NFC").toLowerCase();
const len = (s: string) => [...s].length;

/** True when this word and meaning are already in the list or waiting/rejected as a submission. */
async function wordExists(env: Env, paite: string, english: string): Promise<boolean> {
  const { results } = await env.DB.prepare(
    `SELECT paite, english FROM glossary WHERE length(paite) BETWEEN ?1 AND ?2
     UNION ALL SELECT paite, english FROM word_submissions WHERE status IN ('pending', 'rejected') AND length(paite) BETWEEN ?1 AND ?2`,
  ).bind(len(paite) - 1, len(paite) + 1).all<{ paite: string; english: string }>();
  return results.some((r) => fold(r.paite) === fold(paite) && fold(r.english) === fold(english));
}

// POST /api/word, after the contributor session check. Duplicates answer 200 without inserting.
export async function submitWord(env: Env, phoneId: string, b: Record<string, unknown>): Promise<Response> {
  const paite = cleanText(b.paite, 60), english = cleanText(b.english, 120), note = opt(b.note, 200), name = opt(b.name, 60);
  if (!paite || !english || (b.note && !note) || (b.name && !name)) return json({ error: "bad_request" }, 400);
  const dup = await wordExists(env, paite, english);
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
  const paite = cap(word.paite);
  const dup = await wordExists(env, paite, english);
  if (!dup) await env.DB.prepare("INSERT INTO word_submissions (paite, english, note, phone_id, contributor_name, source) VALUES (?1, ?2, ?3, ?4, ?5, 'meaning')")
    .bind(paite, cap(english), note, phoneId, name).run();
  return json({ ok: true });
}

/** One listed word this phone has not linked yet, or null when it has done them all. */
export async function nextLinkWord(env: Env, phoneId: string): Promise<{ id: number; paite: string } | null> {
  const r = await env.DB.prepare(
    `SELECT g.id, g.paite FROM glossary g
     WHERE g.hidden = 0
       AND NOT EXISTS (SELECT 1 FROM word_links l WHERE l.phone_id = ?1 AND lower(l.paite) = lower(g.paite))
     ORDER BY random() LIMIT 1`,
  ).bind(phoneId).first<{ id: number; paite: string }>();
  return r ? { id: r.id, paite: cap(r.paite) } : null;
}

/** One pending link, unless the words are equal or the pair is already there in either direction. */
async function insertLink(env: Env, phoneId: string, paite: string, other: string | null, kind: "same" | "opposite", name: string | null): Promise<void> {
  if (!other || fold(other) === fold(paite)) return;
  // Links from before pair_key existed have no key: look at those the slow way.
  const { results } = await env.DB.prepare("SELECT paite, other FROM word_links WHERE kind = ?1 AND pair_key IS NULL").bind(kind).all<{ paite: string; other: string }>();
  const a = fold(paite), b = fold(other);
  if (results.some((r) => (fold(r.paite) === a && fold(r.other) === b) || (fold(r.paite) === b && fold(r.other) === a))) return;
  // The unique key makes a second request at the same moment insert nothing.
  await env.DB.prepare("INSERT OR IGNORE INTO word_links (paite, other, kind, phone_id, contributor_name, pair_key) VALUES (?1, ?2, ?3, ?4, ?5, ?6)")
    .bind(paite, cap(other), kind, phoneId, name, [a, b].sort().join("\u0001")).run();
}

/** POST /api/link: a word with the same or the opposite meaning. Waits for a reviewer. Duplicates answer 200 without inserting. */
export async function submitLink(env: Env, phoneId: string, b: Record<string, unknown>): Promise<Response> {
  const given = { same: opt(b.same, 60), opposite: opt(b.opposite, 60) }, name = opt(b.name, 60);
  if (!isId(b.id) || (b.same && !given.same) || (b.opposite && !given.opposite) || (!given.same && !given.opposite) || (b.name && !name)) return json({ error: "bad_request" }, 400);
  const word = await env.DB.prepare("SELECT paite FROM glossary WHERE id = ?1 AND hidden = 0").bind(b.id).first<{ paite: string }>();
  if (!word) return json({ error: "not_found" }, 404);
  const paite = cap(word.paite);
  for (const kind of ["same", "opposite"] as const) await insertLink(env, phoneId, paite, given[kind], kind, name);
  return json({ ok: true });
}

/** POST /api/link/pair: any two words and how they relate, from the Same & Opposite page. Waits for a reviewer. */
export async function submitPair(env: Env, phoneId: string, b: Record<string, unknown>): Promise<Response> {
  const paite = cleanText(b.paite, 60), other = cleanText(b.other, 60), name = opt(b.name, 60);
  if (!paite || !other || (b.kind !== "same" && b.kind !== "opposite") || (b.name && !name) || paite.trim().toLowerCase() === other.trim().toLowerCase()) return json({ error: "bad_request" }, 400);
  await insertLink(env, phoneId, cap(paite), other, b.kind, name);
  return json({ ok: true });
}

// A reviewer may correct a submission before approving it: both fields must be
// given together, and the corrected text is what enters the glossary.
// undefined: no correction sent. null: one was sent but is partial or invalid.
const corrections = (b: Record<string, unknown>): { paite: string; english: string; note: string | null } | null | undefined => {
  if (b.paite === undefined && b.english === undefined && b.note === undefined) return undefined;
  const paite = cleanText(b.paite, 60), english = cleanText(b.english, 120);
  const blankNote = b.note === undefined || b.note === null || (typeof b.note === "string" && !b.note.trim());
  const note = blankNote ? null : cleanText(b.note, 200);
  if (!paite || !english || (!blankNote && !note)) return null;
  return { paite, english, note };
};

// Reviewer routes. Returns null when the path is not a word route.
export async function handleWords(pathname: string, method: string, b: Record<string, unknown>, env: Env, email: string, me?: Me): Promise<Response | null> {
  // A reviewer's own fresh words go to the other reviewers (own.ts). Slots ?1-?4.
  const notOwn = me ? ` AND NOT ${ownSql("phone_id", "contributor_name", "created_at", { e: 1, n: 2, o: 3, t: 4 })}` : "";
  const binds = me ? ownBinds(me) : [];
  if (pathname === "/review/api/words/pending" && method === "GET") {
    const { results } = await env.DB.prepare(`SELECT id, paite, english, note, contributor_name AS name, source FROM word_submissions WHERE status = 'pending'${notOwn} ORDER BY id LIMIT 50`).bind(...binds).all();
    return json({ words: results.map((r: any) => ({ ...r, paite: cap(r.paite), english: cap(r.english) })) });
  }
  if (pathname === "/review/api/words/decide" && method === "POST") {
    if (!isId(b.id) || !["approve", "reject"].includes(b.decision as string)) return json({ error: "bad_request" }, 400);
    const fix = corrections(b);
    const approve = b.decision === "approve";
    if (approve && fix === null) return json({ error: "bad_correction" }, 400);
    // Only the request that flips pending -> decided may insert, so a second decision cannot double-insert.
    if (me && !me.owner) {
      const own = await env.DB.prepare(`SELECT 1 AS ok FROM word_submissions WHERE id = ?5 AND status = 'pending' AND ${ownSql("phone_id", "contributor_name", "created_at", { e: 1, n: 2, o: 3, t: 4 })}`)
        .bind(...binds, b.id).first();
      if (own) return json({ error: "own_submission", message: "This is your own submission. Another reviewer will check it." }, 409);
    }
    const r = await env.DB.prepare("UPDATE word_submissions SET status = ?1, decided_at = datetime('now'), decided_by = ?2 WHERE id = ?3 AND status = 'pending'")
      .bind(approve ? "approved" : "rejected", email, b.id).run();
    if (!r.meta.changes) return json({ error: "already_decided" }, 409);
    if (approve) {
      // Credit the reviewer by name, the same way a saying is credited.
      const rv = await env.DB.prepare("SELECT name FROM reviewers WHERE lower(email) = lower(?1) LIMIT 1").bind(email).first<{ name: string }>();
      const by = rv?.name ?? email;
      if (fix) {
        await env.DB.prepare("INSERT OR IGNORE INTO glossary (paite, english, note, source, contributor_name, reviewed_by) SELECT ?1, ?2, ?3, 'contributed', contributor_name, ?5 FROM word_submissions WHERE id = ?4")
          .bind(cap(fix.paite), cap(fix.english), fix.note, b.id, by).run();
      } else {
        await env.DB.prepare("INSERT OR IGNORE INTO glossary (paite, english, note, source, contributor_name, reviewed_by) SELECT paite, english, note, 'contributed', contributor_name, ?2 FROM word_submissions WHERE id = ?1").bind(b.id, by).run();
      }
    }
    return json({ ok: true });
  }
  if (pathname === "/review/api/links/pending" && method === "GET") {
    const { results } = await env.DB.prepare(`SELECT id, paite, other, kind, contributor_name AS name FROM word_links WHERE status = 'pending'${notOwn} ORDER BY id LIMIT 50`).bind(...binds).all();
    return json({ links: results });
  }
  if (pathname === "/review/api/links/decide" && method === "POST") {
    if (!isId(b.id) || !["approve", "reject"].includes(b.decision as string)) return json({ error: "bad_request" }, 400);
    const fix = b.other === undefined || b.other === null || b.other === "" ? null : cleanText(b.other, 60);
    if (b.other && !fix) return json({ error: "bad_request" }, 400);
    const approve = b.decision === "approve";
    if (me && !me.owner) {
      const own = await env.DB.prepare(`SELECT 1 AS ok FROM word_links WHERE id = ?5 AND status = 'pending' AND ${ownSql("phone_id", "contributor_name", "created_at", { e: 1, n: 2, o: 3, t: 4 })}`)
        .bind(...binds, b.id).first();
      if (own) return json({ error: "own_submission", message: "This is your own submission. Another reviewer will check it." }, 409);
    }
    if (approve && fix) {
      const cur = await env.DB.prepare("SELECT paite, kind FROM word_links WHERE id = ?1 AND status = 'pending'").bind(b.id).first<{ paite: string; kind: string }>();
      if (cur) {
        if (fix.toLowerCase() === cur.paite.trim().toLowerCase()) return json({ error: "bad_correction" }, 400);
        const dup = await env.DB.prepare(
          `SELECT 1 FROM word_links WHERE status = 'approved' AND kind = ?3 AND ((lower(paite) = lower(?1) AND lower(other) = lower(?2)) OR (lower(paite) = lower(?2) AND lower(other) = lower(?1)))`,
        ).bind(cur.paite, fix, cur.kind).first();
        if (dup) return json({ error: "duplicate" }, 409);
      }
    }
    const rv = approve ? await env.DB.prepare("SELECT name FROM reviewers WHERE lower(email) = lower(?1) LIMIT 1").bind(email).first<{ name: string }>() : null;
    const r = await env.DB.prepare("UPDATE word_links SET status = ?1, decided_at = datetime('now'), decided_by = ?2, reviewed_by = ?3, other = COALESCE(?4, other) WHERE id = ?5 AND status = 'pending'")
      .bind(approve ? "approved" : "rejected", email, approve ? (rv?.name ?? email) : null, approve && fix ? cap(fix) : null, b.id).run();
    if (!r.meta.changes) return json({ error: "already_decided" }, 409);
    return json({ ok: true });
  }
  return null;
}
