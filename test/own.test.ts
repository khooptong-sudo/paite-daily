import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { addSentences, call, fakeDeps, PHONE_A, PHONE_B } from "./helpers";

// A reviewer is not served their own submissions (src/own.ts). NOW is 2027-01-15 08:00 UTC.
const FRESH = "2027-01-10 00:00:00"; // five days old: still goes to someone else
const STALE = "2026-12-20 00:00:00"; // 26 days old: back to everyone, its author too

const as = (email: string) => fakeDeps({ verifyReviewer: async () => email });
const REV = as("rev@example.org"); // "Rev One" in the test REVIEWERS binding
const TWO = as("two@example.org");
const OWNER = as("owner@example.org");
const get = async (path: string, deps = REV) => (await call(path, {}, deps)).json() as Promise<any>;
const post = (path: string, body: unknown, deps = REV) => call(path, { method: "POST", body: JSON.stringify(body) }, deps);

beforeEach(async () => {
  await env.DB.prepare("INSERT INTO reviewers (email, name, added_by) VALUES ('two@example.org', 'Two', 'test')").run();
  await env.DB.prepare("DELETE FROM proverb_reviews").run();
  await env.DB.prepare("DELETE FROM proverb_skips").run();
});

async function answer(sid: number, phone: string, name: string | null, at = FRESH) {
  await env.DB.prepare("INSERT INTO answers (sentence_id, phone_id, paite, register, contributor_name, status, created_at) VALUES (?1, ?2, 'Tui', 'both', ?3, 'new', ?4)")
    .bind(sid, phone, name, at).run();
}
const linkPhone = (phone: string, email = "rev@example.org") =>
  env.DB.prepare("INSERT INTO reviewer_phones (phone_id, reviewer_email) VALUES (?1, ?2)").bind(phone, email).run();

describe("own submissions: sentences", () => {
  it("skips a sentence answered from the reviewer's linked phone, and serves it to another reviewer", async () => {
    const [sid] = await addSentences("Water.");
    await answer(sid, PHONE_A, null);
    await linkPhone(PHONE_A);
    expect((await call("/review/api/next", {}, REV)).status).toBe(204);
    expect((await get("/review/api/queue")).waiting).toBe(0);
    expect((await get("/review/api/next", TWO)).sentence.id).toBe(sid);
  });

  it("skips a sentence carrying the reviewer's name, ignoring case and spaces", async () => {
    const [sid] = await addSentences("Water.");
    await answer(sid, PHONE_A, " rev  ONE ");
    expect((await call("/review/api/next", {}, REV)).status).toBe(204);
    expect((await get("/review/api/next", TWO)).sentence.id).toBe(sid);
  });

  it("skips the whole sentence when only one of its answers is the reviewer's", async () => {
    const [sid] = await addSentences("Water.");
    await answer(sid, PHONE_A, "Rev One");
    await answer(sid, PHONE_B, "Someone");
    expect((await call("/review/api/next", {}, REV)).status).toBe(204);
  });

  it("gives it back to its author after 14 days", async () => {
    const [sid] = await addSentences("Water.");
    await answer(sid, PHONE_A, "Rev One", STALE);
    expect((await get("/review/api/next")).sentence.id).toBe(sid);
  });

  it("does not apply to the owner", async () => {
    const [sid] = await addSentences("Water.");
    await answer(sid, PHONE_A, null);
    await linkPhone(PHONE_A, "owner@example.org");
    expect((await get("/review/api/next", OWNER)).sentence.id).toBe(sid);
  });

  it("refuses a decision on an own sentence", async () => {
    const [sid] = await addSentences("Water.");
    await answer(sid, PHONE_A, "Rev One");
    const a = await env.DB.prepare("SELECT id FROM answers WHERE sentence_id = ?1").bind(sid).first<{ id: number }>();
    const r = await post("/review/api/decide", { sentenceId: sid, decision: "accept", answerIds: [a!.id], answerId: a!.id });
    expect(r.status).toBe(409);
    expect((await r.json() as any).error).toBe("own_submission");
  });
});

describe("own submissions: words, recordings and Pau Upa", () => {
  it("leaves the reviewer's own words out of their list and refuses a decision", async () => {
    await env.DB.prepare("INSERT INTO word_submissions (paite, english, phone_id, contributor_name, created_at) VALUES ('tui', 'water', ?1, 'Rev One', ?2)").bind(PHONE_A, FRESH).run();
    expect((await get("/review/api/words/pending")).words).toHaveLength(0);
    expect((await get("/review/api/words/pending", TWO)).words).toHaveLength(1);
    const w = await env.DB.prepare("SELECT id FROM word_submissions").first<{ id: number }>();
    expect((await post("/review/api/words/decide", { id: w!.id, decision: "approve" })).status).toBe(409);
    expect((await post("/review/api/words/decide", { id: w!.id, decision: "approve" }, TWO)).status).toBe(200);
  });

  it("leaves the reviewer's own recordings out of their list", async () => {
    const [sid] = await addSentences("Water.");
    await env.DB.prepare("INSERT INTO answers (sentence_id, phone_id, paite, register, status) VALUES (?1, ?2, 'Tui', 'both', 'accepted')").bind(sid, PHONE_A).run();
    const rv = await env.DB.prepare("INSERT INTO reviews (sentence_id, reviewer_email, decision, final_paite) VALUES (?1, 'two@example.org', 'accept', 'Tui') RETURNING id").bind(sid).first<{ id: number }>();
    await env.DB.prepare("INSERT INTO recordings (review_id, sentence_id, paite, phone_id, r2_key, mime, bytes, duration_ms, consent, status, created_at) VALUES (?1, ?2, 'Tui', ?3, 'k1', 'audio/webm', 4000, 2500, 'CC-BY-4.0', 'pending', ?4)")
      .bind(rv!.id, sid, PHONE_A, FRESH).run();
    await linkPhone(PHONE_A);
    expect(await get("/review/api/recordings")).toMatchObject({ items: [], waiting: 0 });
    expect((await get("/review/api/recordings", TWO)).waiting).toBe(1);
  });

  it("leaves out a saying holding the reviewer's own line, and a whole pair they sent", async () => {
    const open = await env.DB.prepare("INSERT INTO proverbs (kind, english, entered_from, status) VALUES ('proverb', 'Water', 'en2pai', 'open') RETURNING id").first<{ id: number }>();
    await env.DB.prepare("INSERT INTO proverb_answers (proverb_id, paite, phone_id, contributor_name, created_at) VALUES (?1, 'Tui', ?2, 'Rev One', ?3)").bind(open!.id, PHONE_A, FRESH).run();
    await env.DB.prepare("INSERT INTO proverbs (kind, paite, english, entered_from, status, submitted_by, created_at) VALUES ('proverb', 'Mei', 'Fire', 'en2pai', 'pending', ?1, ?2)").bind(PHONE_B, FRESH).run();
    await linkPhone(PHONE_B);
    const mine = await get("/review/api/proverbs");
    expect([mine.answers.length, mine.pairs.length]).toEqual([0, 0]);
    const theirs = await get("/review/api/proverbs", TWO);
    expect([theirs.answers.length, theirs.pairs.length]).toEqual([1, 1]);
    expect((await post("/review/api/proverbs/save", { proverbId: open!.id, rejectAll: true })).status).toBe(409);
  });
});

describe("own submissions: dashboard", () => {
  it("leaves them out of the counts and says how many wait for someone else", async () => {
    const [sid] = await addSentences("Water.");
    await answer(sid, PHONE_A, "Rev One");
    await env.DB.prepare("INSERT INTO word_submissions (paite, english, phone_id, contributor_name, created_at) VALUES ('tui', 'water', ?1, 'Rev One', ?2)").bind(PHONE_A, FRESH).run();
    const d = await get("/review/api/dashboard");
    expect([d.sentences.waiting, d.words.waiting, d.own]).toEqual([0, 0, 2]);
    const t = await get("/review/api/dashboard", TWO);
    expect([t.sentences.waiting, t.words.waiting, t.own]).toEqual([1, 1, 0]);
  });

  it("stops counting them once they are 14 days old", async () => {
    const [sid] = await addSentences("Water.");
    await answer(sid, PHONE_A, "Rev One", STALE);
    const d = await get("/review/api/dashboard");
    expect([d.sentences.waiting, d.own]).toEqual([1, 0]);
  });
});
