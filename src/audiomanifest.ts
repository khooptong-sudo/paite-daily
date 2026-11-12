// Pure pieces of the audio export, with no runtime imports, so a one-off Node script can build
// byte-identical output from the same rules (node runs this .ts file directly).

// A clip is published while it is accepted and its line is still a live verified pair.
export const PUBLISHED_CLIPS = `SELECT rec.id, rec.sentence_id, rec.paite, rec.contributor_name, rec.r2_key, rec.mime, rec.duration_ms, rec.consent,
    rec.reviewed_by, rec.reviewed_at, rec.created_at, rec.exported_at,
    CASE WHEN s.direction = 'pai2en' THEN r.final_paite ELSE s.english END AS english
  FROM recordings rec
  JOIN reviews r ON r.id = rec.review_id AND r.decision = 'accept' AND r.undone_at IS NULL
  JOIN sentences s ON s.id = rec.sentence_id
  WHERE rec.status = 'accepted'`;

export type Clip = {
  id: number; sentence_id: number; paite: string; contributor_name: string | null; r2_key: string; mime: string;
  duration_ms: number; consent: string; reviewed_by: string | null; reviewed_at: string | null; created_at: string;
  exported_at: string | null; english: string;
};

const EXT: Record<string, string> = { "audio/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "m4a" };

export function audioPath(id: number, mime: string): string {
  return `audio/${id}.${EXT[mime] ?? "bin"}`;
}

// audio/recordings.jsonl: one line per published clip, oldest first. text_id is the matching line in community/.
export function manifestText(clips: Clip[], verifiedBy: (email: string | null) => string): string {
  return clips.map((c) => JSON.stringify({
    id: `audio:${c.id}`,
    file: audioPath(c.id, c.mime),
    text_id: `community:${c.sentence_id}`,
    paite: c.paite,
    english: c.english,
    speaker: c.contributor_name ?? "",
    verified_by: verifiedBy(c.reviewed_by),
    recorded_at: c.created_at,
    verified_at: c.reviewed_at,
    duration_ms: c.duration_ms,
    mime: c.mime,
    licence: c.consent,
  }) + "\n").join("");
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
