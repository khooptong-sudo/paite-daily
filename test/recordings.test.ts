import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { addSentences, call, fakeDeps, PHONE_A, PHONE_B, session } from "./helpers";

const REV = fakeDeps({ verifyAccess: async () => "rev@example.org" });
const CLIP = new Uint8Array(4000).fill(7);

// A sentence whose answer from `phone` a reviewer accepted, so the pair is verified.
async function verified(english: string, paite: string, phone = PHONE_A) {
  const [sid] = await addSentences(english);
  const a = await env.DB.prepare("INSERT INTO answers (sentence_id, phone_id, paite, register, status) VALUES (?1, ?2, ?3, 'both', 'accepted') RETURNING id").bind(sid, phone, paite).first<{ id: number }>();
  const r = await env.DB.prepare("INSERT INTO reviews (sentence_id, reviewer_email, decision, accepted_answer_id, final_paite) VALUES (?1, 'rev@example.org', 'accept', ?2, ?3) RETURNING id").bind(sid, a!.id, paite).first<{ id: number }>();
  return r!.id;
}

function upload(reviewId: number, s: string, headers: Record<string, string> = {}, body: BodyInit = CLIP) {
  return call(`/api/record?reviewId=${reviewId}`, { method: "POST", session: s, body,
    headers: { "content-type": "audio/webm", "X-Consent": "CC-BY-4.0", "X-Duration": "2500", ...headers } });
}

describe("Hear it", () => {
  it("offers nothing to a phone without a verified sentence", async () => {
    await verified("Water.", "Tui", PHONE_A);
    const r = await call("/api/record/next", { session: await session(PHONE_B) });
    expect(r.status).toBe(403);
    expect((await upload(1, await session(PHONE_B))).status).toBe(403);
  });

  it("offers the phone's own verified line, takes the clip, and counts it", async () => {
    const id = await verified("Water.", "Tui");
    const s = await session(PHONE_A);
    expect(await (await call("/api/record/next", { session: s })).json()).toMatchObject({ reviewId: id, paite: "Tui", english: "Water." });
    expect((await upload(id, s)).status).toBe(200);
    const row = await env.DB.prepare("SELECT paite, status, consent, bytes, r2_key FROM recordings").first<{ paite: string; status: string; consent: string; bytes: number; r2_key: string }>();
    expect(row).toMatchObject({ paite: "Tui", status: "pending", consent: "CC-BY-4.0", bytes: 4000 });
    expect(await env.AUDIO.get(row!.r2_key)).not.toBeNull();
    // the same line is not offered twice to the same phone, and cannot be sent twice
    expect((await call("/api/record/next", { session: s })).status).toBe(204);
    expect((await upload(id, s)).status).toBe(409);
    expect(await (await call("/api/me", { session: s })).json()).toMatchObject({ recordings: 1 });
  });

  it("refuses a clip without consent, of the wrong type, too long or too large", async () => {
    const id = await verified("Water.", "Tui");
    const s = await session(PHONE_A);
    expect(await (await upload(id, s, { "X-Consent": "" })).json()).toEqual({ error: "consent_required" });
    expect((await upload(id, s, { "content-type": "video/mp4" })).status).toBe(400);
    expect((await upload(id, s, { "X-Duration": "60000" })).status).toBe(400);
    expect((await upload(id, s, {}, new Uint8Array(1_000_001))).status).toBe(413);
    expect((await upload(9999, s)).status).toBe(404);
    expect(await env.DB.prepare("SELECT count(*) AS n FROM recordings").first()).toEqual({ n: 0 });
  });

  it("hides a clip from the public until a reviewer accepts it, and undo hides it again", async () => {
    const id = await verified("Water.", "Tui");
    await upload(id, await session(PHONE_A));
    const { id: rec } = (await env.DB.prepare("SELECT id FROM recordings").first<{ id: number }>())!;
    expect((await call(`/audio/${rec}`)).status).toBe(404);

    expect((await call("/review/api/recordings", {}, fakeDeps())).status).toBe(401);
    const list = await (await call("/review/api/recordings", {}, REV)).json<{ items: { id: number }[]; waiting: number }>();
    expect(list.waiting).toBe(1);
    expect((await call(`/review/api/recordings/audio?id=${rec}`, {}, REV)).status).toBe(200);

    const decide = (decision: string) => call("/review/api/recordings/decide", { method: "POST", body: JSON.stringify({ id: rec, decision }) }, REV);
    expect((await decide("accept")).status).toBe(200);
    expect((await decide("reject")).status).toBe(404);
    const pub = await call(`/audio/${rec}`);
    expect(pub.status).toBe(200);
    expect(pub.headers.get("content-type")).toBe("audio/webm");
    expect((await pub.arrayBuffer()).byteLength).toBe(4000);

    const other = fakeDeps({ verifyAccess: async () => "owner@example.org" });
    expect((await call("/review/api/recordings/undo", { method: "POST", body: JSON.stringify({ id: 12345 }) }, other)).status).toBe(404);
    expect((await call("/review/api/recordings/undo", { method: "POST", body: JSON.stringify({ id: rec }) }, REV)).status).toBe(200);
    expect((await call(`/audio/${rec}`)).status).toBe(404);
  });

  it("stops offering a line once it has enough voices", async () => {
    const id = await verified("Water.", "Tui");
    for (const n of ["1", "2", "3"]) {
      await env.DB.prepare("INSERT INTO recordings (review_id, sentence_id, paite, phone_id, r2_key, mime, bytes, duration_ms, consent) SELECT ?1, sentence_id, 'Tui', ?2, ?3, 'audio/webm', 1, 1000, 'CC-BY-4.0' FROM reviews WHERE id = ?1")
        .bind(id, "phone-" + n, "k" + n).run();
    }
    expect((await call("/api/record/next", { session: await session(PHONE_A) })).status).toBe(204);
  });
});
