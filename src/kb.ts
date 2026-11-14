import { cleanText } from "./text";
import type { Env } from "./types";
/**
 * The Paite Wiki's data layer. It only ever touches env.WIKI and env.WIKI_FILES, never the main
 * database. The rule that matters most: a source is searchable only once someone other than the
 * person who added it (the owner is exempt) has approved it.
 */
export type Rights = "open" | "permission" | "quote-only" | "index-only";
export type Kind = "site" | "book" | "article" | "web" | "other";
export type SourceStatus = "pending" | "approved" | "rejected" | "withdrawn";
const RIGHTS: readonly Rights[] = ["open", "permission", "quote-only", "index-only"];
const NEW_KINDS: readonly Exclude<Kind, "site">[] = ["book", "article", "web", "other"];
const LANGUAGES = ["pck", "en", "mixed"] as const;
export const STATUSES: readonly SourceStatus[] = ["pending", "approved", "rejected", "withdrawn"];
// The site's own reviewed data is trusted most; published print next; the open web least.
export const TRUST: Record<Kind, 1 | 2 | 3> = { site: 1, book: 2, article: 2, web: 3, other: 3 };
// Only sources whose rights allow it may ever leave for the open dataset.
export const exportableFor = (rights: Rights) => (rights === "open" || rights === "permission" ? 1 : 0);
const MAX_CHUNK = 4000;
const MAX_CHUNKS_PER_CALL = 2000;
const BATCH = 100;
// Control characters, except the newline that separates paragraphs inside a passage.
const CONTROL_BUT_NEWLINE = /[\u0000-\u0009\u000B-\u001F\u007F]/;
/** Split one over-long piece at spaces, packing words up to max. A word longer than max stands alone. */
function splitWords(s: string, max: number): string[] {
  const out: string[] = [];
  let cur = "";
  for (const w of s.split(" ")) {
    if (!w) continue;
    if (!cur) cur = w;
    else if (cur.length + 1 + w.length <= max) cur += " " + w;
    else { out.push(cur); cur = w; }
  }
  if (cur) out.push(cur);
  return out;
}
/** A paragraph longer than max: cut at sentence ends first, and only cut inside a sentence at a space. */
function splitParagraph(p: string, max: number): string[] {
  const out: string[] = [];
  let cur = "";
  // The lookbehind keeps the full stop, question or exclamation mark with its sentence.
  for (const s of p.split(/(?<=[.?!]) /)) {
    if (!s) continue;
    if (s.length > max) {
      if (cur) { out.push(cur); cur = ""; }
      out.push(...splitWords(s, max));
    } else if (!cur) cur = s;
    else if (cur.length + 1 + s.length <= max) cur += " " + s;
    else { out.push(cur); cur = s; }
  }
  if (cur) out.push(cur);
  return out;
}
/** Cut a source's text into passages of at most max characters, keeping paragraphs together where they fit. */
export function chunkText(text: string, max = 1200): string[] {
  const paras = text.normalize("NFC").replace(/\r\n/g, "\n").split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, " ").trim()).filter((p) => p.length > 0);
  const out: string[] = [];
  let cur = "";
  for (const p of paras) {
    if (p.length > max) {
      if (cur) { out.push(cur); cur = ""; }
      out.push(...splitParagraph(p, max));
    } else if (!cur) cur = p;
    else if (cur.length + 2 + p.length <= max) cur += "\n\n" + p;
    else { out.push(cur); cur = p; }
  }
  if (cur) out.push(cur);
  return out.filter((c) => c.length > 0);
}
export async function sha256Hex(data: string | ArrayBuffer): Promise<string> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
}
export type NewSource = {
  kind: Exclude<Kind, "site">;
  title: string;
  author?: string | null;
  publisher?: string | null;
  year?: string | null;
  url?: string | null;
  language: "pck" | "en" | "mixed";
  rights: Rights;
  rightsNote?: string | null;
};
// An optional field left out, null or blank counts as not given; anything else must be valid.
const absent = (v: unknown) => v === undefined || v === null || (typeof v === "string" && v.trim() === "");
function optText(v: unknown, max: number): string | null | undefined {
  if (absent(v)) return null;
  return cleanText(v, max) ?? undefined;
}
function readUrl(v: unknown): string | null | undefined {
  if (absent(v)) return null;
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  if (s.length > 2000) return undefined;
  try {
    const u = new URL(s);
    return u.protocol === "https:" || u.protocol === "http:" ? s : undefined;
  } catch {
    return undefined;
  }
}
/** Validate a request body describing a new source. Null if any field is invalid. */
export function readNewSource(b: Record<string, unknown>): NewSource | null {
  if (!b || typeof b !== "object") return null;
  if (!NEW_KINDS.includes(b.kind as Exclude<Kind, "site">)) return null;
  const title = cleanText(b.title, 300);
  if (!title) return null;
  const author = optText(b.author, 200);
  const publisher = optText(b.publisher, 200);
  if (author === undefined || publisher === undefined) return null;
  let year: string | null | undefined;
  if (absent(b.year)) year = null;
  else if (typeof b.year === "string" && /^\d{3,4}(-\d{3,4})?$/.test(b.year.trim())) year = b.year.trim();
  else year = cleanText(b.year, 20) ?? undefined;
  if (year === undefined) return null;
  const url = readUrl(b.url);
  if (url === undefined) return null;
  const language = absent(b.language) ? "mixed" : b.language;
  if (!LANGUAGES.includes(language as (typeof LANGUAGES)[number])) return null;
  if (!RIGHTS.includes(b.rights as Rights)) return null;
  const rightsNote = optText(b.rightsNote, 1000);
  if (rightsNote === undefined) return null;
  return {
    kind: b.kind as Exclude<Kind, "site">, title, author, publisher, year, url,
    language: language as NewSource["language"], rights: b.rights as Rights, rightsNote,
  };
}
export async function addSource(env: Env, s: NewSource, by: string, now: number): Promise<number> {
  const r = await env.WIKI.prepare(
    `INSERT INTO kb_sources (kind, title, author, publisher, year, url, language, rights, rights_note, exportable, trust, status, added_by, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 'pending', ?12, ?13, ?13) RETURNING id`,
  ).bind(s.kind, s.title, s.author ?? null, s.publisher ?? null, s.year ?? null, s.url ?? null, s.language, s.rights, s.rightsNote ?? null,
    exportableFor(s.rights), TRUST[s.kind], by, now).first<{ id: number }>();
  return r!.id;
}
export type ChunkIn = { text: string; locator?: string | null };
/**
 * Check a list of passages before anything is written, so a bad one cannot leave half a source behind.
 * Newlines inside a passage are kept (they separate paragraphs); null if any passage is unusable.
 */
export function readChunks(list: unknown, maxCount = MAX_CHUNKS_PER_CALL): { text: string; locator: string | null }[] | null {
  if (!Array.isArray(list) || list.length > maxCount) return null;
  const out: { text: string; locator: string | null }[] = [];
  for (const c of list) {
    if (!c || typeof c !== "object") return null;
    const { text: raw, locator: loc } = c as Record<string, unknown>;
    if (typeof raw !== "string") return null;
    const text = raw.normalize("NFC").trim();
    if (!text || text.length > MAX_CHUNK || CONTROL_BUT_NEWLINE.test(text)) return null;
    const locator = optText(loc, 120);
    if (locator === undefined) return null;
    out.push({ text, locator });
  }
  return out;
}
export async function addChunks(env: Env, sourceId: number, chunks: ChunkIn[]): Promise<{ added: number } | { error: "not_found" | "not_pending" | "bad_request" }> {
  const src = await env.WIKI.prepare("SELECT status FROM kb_sources WHERE id = ?1").bind(sourceId).first<{ status: SourceStatus }>();
  if (!src) return { error: "not_found" };
  // Text may only change while nobody has approved it yet; an approved source is what a reviewer saw.
  if (src.status !== "pending") return { error: "not_pending" };
  const good = readChunks(chunks);
  if (!good) return { error: "bad_request" };
  if (!good.length) return { added: 0 };
  const top = await env.WIKI.prepare("SELECT COALESCE(MAX(ordinal), 0) AS n FROM kb_chunks WHERE source_id = ?1").bind(sourceId).first<{ n: number }>();
  let ordinal = top?.n ?? 0;
  const rows = await Promise.all(good.map(async (c) => ({ ...c, ordinal: ++ordinal, sha: await sha256Hex(c.text) })));
  const insert = env.WIKI.prepare("INSERT INTO kb_chunks (source_id, ordinal, locator, text, sha256) VALUES (?1, ?2, ?3, ?4, ?5)");
  for (let i = 0; i < rows.length; i += BATCH) {
    await env.WIKI.batch(rows.slice(i, i + BATCH).map((r) => insert.bind(sourceId, r.ordinal, r.locator, r.text, r.sha)));
  }
  return { added: rows.length };
}
export async function decideSource(
  env: Env, id: number, decision: "approve" | "reject", who: { email: string; owner: boolean }, now: number,
): Promise<{ ok: true } | { error: "not_found" | "not_pending" | "own_submission" | "no_text" }> {
  const src = await env.WIKI.prepare("SELECT kind, status, added_by FROM kb_sources WHERE id = ?1").bind(id)
    .first<{ kind: Kind; status: SourceStatus; added_by: string }>();
  // Site sources are approved at birth by the sync job (plan 002), never decided by hand.
  if (!src || src.kind === "site") return { error: "not_found" };
  if (src.status !== "pending") return { error: "not_pending" };
  if (src.added_by.toLowerCase() === who.email.toLowerCase() && !who.owner) return { error: "own_submission" };
  if (decision === "approve") {
    const n = await env.WIKI.prepare("SELECT COUNT(*) AS n FROM kb_chunks WHERE source_id = ?1").bind(id).first<{ n: number }>();
    if (!n?.n) return { error: "no_text" };
  }
  // status = 'pending' again in the WHERE so two reviewers deciding at once cannot both win.
  const r = await env.WIKI.prepare(
    "UPDATE kb_sources SET status = ?2, decided_by = ?3, decided_at = ?4, updated_at = ?4 WHERE id = ?1 AND status = 'pending'",
  ).bind(id, decision === "approve" ? "approved" : "rejected", who.email, now).run();
  if (!r.meta.changes) return { error: "not_pending" };
  return { ok: true };
}
/**
 * Take a source down completely: its passages (and so its index entries) and its file go;
 * the row stays as a record of what was removed, when, by whom and why.
 */
export async function withdrawSource(
  env: Env, id: number, who: { email: string }, reason: string | null, now: number,
): Promise<{ ok: true } | { error: "not_found" | "already_withdrawn" }> {
  const src = await env.WIKI.prepare("SELECT kind, status, r2_key FROM kb_sources WHERE id = ?1").bind(id)
    .first<{ kind: Kind; status: SourceStatus; r2_key: string | null }>();
  if (!src || src.kind === "site") return { error: "not_found" };
  if (src.status === "withdrawn") return { error: "already_withdrawn" };
  // The delete trigger removes each passage from the full-text index as it goes.
  await env.WIKI.prepare("DELETE FROM kb_chunks WHERE source_id = ?1").bind(id).run();
  if (src.r2_key) await env.WIKI_FILES.delete(src.r2_key);
  await env.WIKI.prepare(
    "UPDATE kb_sources SET status = 'withdrawn', withdrawn_reason = ?2, r2_key = NULL, decided_by = ?3, decided_at = ?4, updated_at = ?4 WHERE id = ?1",
  ).bind(id, reason, who.email, now).run();
  return { ok: true };
}
const FIELDS = `s.id, s.kind, s.title, s.author, s.publisher, s.year, s.url, s.language, s.rights, s.rights_note, s.exportable, s.trust, s.status,
  CASE WHEN s.r2_key IS NULL THEN 0 ELSE 1 END AS has_file, s.added_by, s.decided_by, s.decided_at, s.created_at,
  (SELECT COUNT(*) FROM kb_chunks c WHERE c.source_id = s.id) AS chunks`;
export type SourceRow = {
  id: number; kind: Kind; title: string; author: string | null; publisher: string | null; year: string | null; url: string | null;
  language: string; rights: Rights; rights_note: string | null; exportable: number; trust: number; status: SourceStatus;
  has_file: number; added_by: string; decided_by: string | null; decided_at: number | null; created_at: number; chunks: number;
};
export async function listSources(env: Env, status: SourceStatus, limit = 200): Promise<SourceRow[]> {
  const n = Math.min(Math.max(1, Math.floor(limit) || 1), 500);
  const { results } = await env.WIKI.prepare(
    `SELECT ${FIELDS} FROM kb_sources s WHERE s.status = ?1 AND s.kind <> 'site' ORDER BY s.created_at DESC, s.id DESC LIMIT ?2`,
  ).bind(status, n).all<SourceRow>();
  return results;
}
export async function getSource(env: Env, id: number): Promise<(Omit<SourceRow, "chunks"> & { chunks: { id: number; ordinal: number; locator: string | null; text: string }[] }) | null> {
  const row = await env.WIKI.prepare(`SELECT ${FIELDS} FROM kb_sources s WHERE s.id = ?1`).bind(id).first<SourceRow>();
  if (!row) return null;
  const { results } = await env.WIKI.prepare("SELECT id, ordinal, locator, text FROM kb_chunks WHERE source_id = ?1 ORDER BY ordinal LIMIT 500")
    .bind(id).all<{ id: number; ordinal: number; locator: string | null; text: string }>();
  return { ...row, chunks: results };
}
export type Hit = {
  chunkId: number; text: string; locator: string | null; sourceId: number; title: string; kind: Kind; trust: number;
  url: string | null; author: string | null; year: string | null; rights: Rights; score: number;
};
/**
 * Turn free text into an FTS5 query. Every part is wrapped in double quotes, and the split has
 * already removed every quote and operator character, so a visitor's text can never become FTS5 syntax.
 */
export function ftsQuery(terms: string[]): string | null {
  const parts = new Set<string>();
  for (const t of terms) {
    if (typeof t !== "string") continue;
    for (const p of t.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
      if (p.length >= 2) parts.add(p);
      if (parts.size >= 32) break;
    }
    if (parts.size >= 32) break;
  }
  return parts.size ? [...parts].map((p) => `"${p}"`).join(" OR ") : null;
}
/** Passages of approved sources that match any of the terms, best first (bm25 is lower for better). */
export async function searchChunks(env: Env, terms: string[], limit = 20): Promise<Hit[]> {
  const q = ftsQuery(terms);
  if (!q) return [];
  const n = Math.min(Math.max(1, Math.floor(limit) || 1), 50);
  const { results } = await env.WIKI.prepare(
    `SELECT c.id AS chunkId, c.text, c.locator, s.id AS sourceId, s.title, s.kind, s.trust, s.url, s.author, s.year, s.rights, bm25(kb_chunks_fts) AS score
       FROM kb_chunks_fts JOIN kb_chunks c ON c.id = kb_chunks_fts.rowid JOIN kb_sources s ON s.id = c.source_id
      WHERE kb_chunks_fts MATCH ?1 AND s.status = 'approved'
      ORDER BY score LIMIT ?2`,
  ).bind(q, n).all<Hit>();
  return results;
}
