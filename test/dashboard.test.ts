import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { addSentences, call, fakeDeps, PHONE_A } from "./helpers";

const REV = fakeDeps({ verifyAccess: async () => "rev@example.org" });
const get = async () => (await call("/review/api/dashboard", {}, REV)).json();

// One waiting item in every queue. `done` makes the same items already decided.
async function seed(done = false, at = "2026-01-02 03:04:05") {
  const [sid] = await addSentences("Water.");
  await env.DB.prepare("INSERT INTO answers (sentence_id, phone_id, paite, register, status, created_at) VALUES (?1, ?2, 'Tui', 'both', ?3, ?4)")
    .bind(sid, PHONE_A, done ? "accepted" : "new", at).run();
  await env.DB.prepare("INSERT INTO word_submissions (paite, english, phone_id, status, created_at) VALUES ('tui', 'water', ?1, ?2, ?3)")
    .bind(PHONE_A, done ? "approved" : "pending", at).run();
  await env.DB.prepare("INSERT INTO proverbs (kind, paite, english, entered_from, status, created_at) VALUES ('proverb', 'Tui', 'Water', 'en2pai', ?1, ?2)")
    .bind(done ? "hidden" : "pending", at).run();
  const a = await env.DB.prepare("INSERT INTO answers (sentence_id, phone_id, paite, register, status) VALUES (?1, ?2, 'Tui', 'both', 'accepted') RETURNING id").bind(sid, PHONE_A).first<{ id: number }>();
  const r = await env.DB.prepare("INSERT INTO reviews (sentence_id, reviewer_email, decision, accepted_answer_id, final_paite) VALUES (?1, 'rev@example.org', 'accept', ?2, 'Tui') RETURNING id").bind(sid, a!.id).first<{ id: number }>();
  await env.DB.prepare("INSERT INTO recordings (review_id, sentence_id, paite, phone_id, r2_key, mime, bytes, duration_ms, consent, status, created_at) VALUES (?1, ?2, 'Tui', ?3, 'k1', 'audio/webm', 4000, 2500, 'CC-BY-4.0', ?4, ?5)")
    .bind(r!.id, sid, PHONE_A, done ? "accepted" : "pending", at).run();
}

describe("review dashboard", () => {
  it("needs a reviewer", async () => {
    expect((await call("/review/api/dashboard", {}, fakeDeps())).status).toBe(401);
    expect((await call("/review/api/dashboard", {}, REV)).status).toBe(200);
  });

  it("is empty when nothing waits", async () => {
    const none = { waiting: 0, oldest: null };
    expect(await get()).toEqual({ sentences: none, words: none, pauUpa: none, recordings: none });
  });

  it("counts one waiting item per queue and reports the oldest", async () => {
    await seed();
    const one = { waiting: 1, oldest: "2026-01-02 03:04:05" };
    expect(await get()).toEqual({ sentences: one, words: one, pauUpa: one, recordings: one });
  });

  it("does not count decided items", async () => {
    await seed(true);
    const none = { waiting: 0, oldest: null };
    expect(await get()).toEqual({ sentences: none, words: none, pauUpa: none, recordings: none });
  });
});
