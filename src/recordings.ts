import { isOwner } from "./access";
import { cleanText, isId } from "./text";
import { json, type Env } from "./types";

// Hear it. Only someone who already has a verified sentence may record, every clip
// carries the consent its speaker ticked, and one reviewer's accept publishes it.
export const CONSENT = "CC-BY-4.0";
export const MAX_BYTES = 1_000_000;
export const MAX_MS = 20_000;
// A line is offered until this many people have a live (pending or accepted) clip of it.
export const VOICES_PER_LINE = 3;
const TYPES = ["audio/webm", "audio/ogg", "audio/mp4"];

// The verified Paite of a reviewed pair: the reviewer's final line, or the prompt when the pair ran Paite to English.
const VERIFIED = `SELECT r.id AS reviewId, s.id AS sentenceId,
    CASE WHEN s.direction = 'pai2en' THEN s.paite_prompt ELSE r.final_paite END AS paite,
    CASE WHEN s.direction = 'pai2en' THEN r.final_paite ELSE s.english END AS english
  FROM reviews r JOIN sentences s ON s.id = r.sentence_id
  WHERE r.decision = 'accept' AND r.undone_at IS NULL`;

export async function verifiedCount(env: Env, phoneId: string): Promise<number> {
  const r = await env.DB.prepare("SELECT count(*) AS n FROM answers WHERE phone_id = ?1 AND status IN ('accepted', 'also_correct')").bind(phoneId).first<{ n: number }>();
  return r!.n;
}

/** The next line for this phone to read aloud: its own verified lines first, then anyone's. */
export async function nextLine(env: Env, phoneId: string) {
  return env.DB.prepare(
    `SELECT v.* FROM (${VERIFIED}) v
     WHERE v.paite IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM recordings x WHERE x.review_id = v.reviewId AND x.phone_id = ?1)
       AND (SELECT count(*) FROM recordings x WHERE x.review_id = v.reviewId AND x.status != 'rejected') < ?2
     ORDER BY EXISTS (SELECT 1 FROM reviews r JOIN answers a ON a.id = r.accepted_answer_id WHERE r.id = v.reviewId AND a.phone_id = ?1) DESC, random()
     LIMIT 1`,
  ).bind(phoneId, VOICES_PER_LINE).first<{ reviewId: number; sentenceId: number; paite: string; english: string }>();
}

export async function submitRecording(req: Request, env: Env, phoneId: string, now: number): Promise<Response> {
  const url = new URL(req.url);
  const reviewId = Number(url.searchParams.get("reviewId"));
  const ms = Number(req.headers.get("X-Duration"));
  const mime = (req.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (!isId(reviewId) || !TYPES.includes(mime) || !Number.isInteger(ms) || ms < 300 || ms > MAX_MS) return json({ error: "bad_request" }, 400);
  if (req.headers.get("X-Consent") !== CONSENT) return json({ error: "consent_required" }, 400);
  if ((await verifiedCount(env, phoneId)) < 1) return json({ error: "not_eligible" }, 403);
  const recent = await env.DB.prepare("SELECT count(*) AS n FROM recordings WHERE phone_id = ?1 AND created_at >= datetime(?2 / 1000, 'unixepoch', '-1 minute')").bind(phoneId, now).first<{ n: number }>();
  if (recent!.n >= 5) return json({ error: "slow_down" }, 429);
  const line = await env.DB.prepare(`SELECT v.* FROM (${VERIFIED}) v WHERE v.reviewId = ?1`).bind(reviewId).first<{ reviewId: number; sentenceId: number; paite: string | null }>();
  if (!line || !line.paite) return json({ error: "not_found" }, 404);
  if (await env.DB.prepare("SELECT 1 FROM recordings WHERE review_id = ?1 AND phone_id = ?2").bind(reviewId, phoneId).first()) return json({ error: "already_recorded" }, 409);

  const declared = Number(req.headers.get("content-length"));
  if (declared > MAX_BYTES) return json({ error: "too_large" }, 413);
  const audio = await req.arrayBuffer();
  if (audio.byteLength < 200 || audio.byteLength > MAX_BYTES) return json({ error: audio.byteLength > MAX_BYTES ? "too_large" : "bad_request" }, audio.byteLength > MAX_BYTES ? 413 : 400);

  const key = `pending/${reviewId}/${crypto.randomUUID()}.${mime.split("/")[1]}`;
  await env.AUDIO.put(key, audio, { httpMetadata: { contentType: mime } });
  const name = await env.DB.prepare("SELECT contributor_name AS n FROM answers WHERE phone_id = ?1 AND contributor_name IS NOT NULL ORDER BY id DESC LIMIT 1").bind(phoneId).first<{ n: string }>();
  await env.DB.prepare(
    `INSERT INTO recordings (review_id, sentence_id, paite, phone_id, contributor_name, r2_key, mime, bytes, duration_ms, consent)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
  ).bind(reviewId, line.sentenceId, line.paite, phoneId, name?.n ?? null, key, mime, audio.byteLength, ms, CONSENT).run();
  return json({ ok: true });
}

async function stream(env: Env, key: string, cache: string): Promise<Response> {
  const obj = await env.AUDIO.get(key);
  if (!obj) return json({ error: "not_found" }, 404);
  return new Response(obj.body, { headers: { "content-type": obj.httpMetadata?.contentType || "audio/webm", "cache-control": cache } });
}

/** Public playback: only clips a reviewer accepted. */
export async function publicAudio(env: Env, pathname: string): Promise<Response> {
  const id = Number(pathname.slice("/audio/".length));
  if (!isId(id)) return json({ error: "not_found" }, 404);
  const r = await env.DB.prepare("SELECT r2_key FROM recordings WHERE id = ?1 AND status = 'accepted'").bind(id).first<{ r2_key: string }>();
  return r ? stream(env, r.r2_key, "public, max-age=86400") : json({ error: "not_found" }, 404);
}

/** The reviewer lane. Null when the path is not a recordings path. */
export async function handleRecordingReview(req: Request, pathname: string, b: Record<string, unknown>, env: Env, email: string): Promise<Response | null> {
  if (!pathname.startsWith("/review/api/recordings")) return null;
  if (pathname === "/review/api/recordings" && req.method === "GET") {
    const { results } = await env.DB.prepare(
      `SELECT r.id, r.paite, s.english, r.contributor_name AS contributor, r.duration_ms AS durationMs, r.created_at AS createdAt
       FROM recordings r JOIN sentences s ON s.id = r.sentence_id WHERE r.status = 'pending' ORDER BY r.id LIMIT 20`,
    ).all();
    const w = await env.DB.prepare("SELECT count(*) AS n FROM recordings WHERE status = 'pending'").first<{ n: number }>();
    return json({ items: results, waiting: w!.n });
  }
  if (pathname === "/review/api/recordings/audio" && req.method === "GET") {
    const id = Number(new URL(req.url).searchParams.get("id"));
    if (!isId(id)) return json({ error: "bad_request" }, 400);
    const r = await env.DB.prepare("SELECT r2_key FROM recordings WHERE id = ?1").bind(id).first<{ r2_key: string }>();
    return r ? stream(env, r.r2_key, "private, no-store") : json({ error: "not_found" }, 404);
  }
  if (pathname === "/review/api/recordings/decide" && req.method === "POST") {
    const blank = b.note === undefined || b.note === null || (typeof b.note === "string" && !b.note.trim());
    const note = blank ? null : cleanText(b.note, 300);
    if (!isId(b.id) || !["accept", "reject"].includes(b.decision as string) || (!blank && !note)) return json({ error: "bad_request" }, 400);
    const r = await env.DB.prepare("UPDATE recordings SET status = ?2, reviewed_by = ?3, reviewed_at = datetime('now'), review_note = ?4 WHERE id = ?1 AND status = 'pending'")
      .bind(b.id, b.decision === "accept" ? "accepted" : "rejected", email, note).run();
    return r.meta.changes ? json({ ok: true }) : json({ error: "not_found" }, 404);
  }
  // Undo puts the clip back in the queue. Only its reviewer, or the owner, may.
  if (pathname === "/review/api/recordings/undo" && req.method === "POST") {
    if (!isId(b.id)) return json({ error: "bad_request" }, 400);
    const r = await env.DB.prepare("UPDATE recordings SET status = 'pending', reviewed_by = NULL, reviewed_at = NULL, review_note = NULL WHERE id = ?1 AND status != 'pending' AND (lower(reviewed_by) = lower(?2) OR ?3)")
      .bind(b.id, email, isOwner(env, email) ? 1 : 0).run();
    return r.meta.changes ? json({ ok: true }) : json({ error: "nothing_to_undo" }, 404);
  }
  return json({ error: "not_found" }, 404);
}
