import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { addSentences, call, fakeDeps, NOW, PHONE_A, PHONE_B, PHONE_C, session } from "./helpers";

const as = (email: string | null, now = NOW) => fakeDeps({ verifyAccess: async () => email, now: () => now });
const rev = (path: string, body?: unknown, email: string | null = "rev@example.org", now = NOW) =>
  call(path, body === undefined ? {} : { method: "POST", body: JSON.stringify(body) }, as(email, now));

async function fullSentence(english = "I am well.", answers = ["Ka dam e.", "Ka dam."]) {
  const [id] = await addSentences(english);
  const phones = [PHONE_A, PHONE_B];
  for (let i = 0; i < answers.length; i++) {
    await call("/api/answer", { method: "POST", session: await session(phones[i]), body: JSON.stringify({ sentenceId: id, paite: answers[i], register: "both" }) });
  }
  return id;
}

describe("review access", () => {
  it("refuses requests without a valid Access identity", async () => {
    expect((await rev("/review/api/next", undefined, null)).status).toBe(401);
  });
  it("refuses a signed-in person who is not on the reviewer list", async () => {
    expect((await rev("/review/api/next", undefined, "stranger@example.org")).status).toBe(403);
  });
});

describe("review flow", () => {
  it("serves a full sentence with its answers and locks it", async () => {
    const id = await fullSentence();
    const card = await (await rev("/review/api/next")).json<{ sentence: { id: number }; answers: { paite: string }[] }>();
    expect(card.sentence.id).toBe(id);
    expect(card.answers.map((a) => a.paite).sort()).toEqual(["Ka dam e.", "Ka dam."]);
    expect((await rev("/review/api/next", undefined, "owner@example.org")).status).toBe(204);
  });

  it("accept verifies the sentence and records the reviewer", async () => {
    const id = await fullSentence();
    const card = await (await rev("/review/api/next")).json<{ answers: { id: number; paite: string }[] }>();
    const chosen = card.answers.find((a) => a.paite === "Ka dam e.")!;
    const other = card.answers.find((a) => a.paite !== "Ka dam e.")!;
    const r = await rev("/review/api/decide", { sentenceId: id, decision: "accept", answerIds: card.answers.map((a) => a.id), answerId: chosen.id, register: "spoken", alsoCorrect: [other.id] });
    expect(r.status).toBe(200);
    expect(await env.DB.prepare("SELECT status FROM sentences WHERE id = ?1").bind(id).first()).toEqual({ status: "verified" });
    const review = await env.DB.prepare("SELECT reviewer_email, final_paite, register FROM reviews WHERE sentence_id = ?1").bind(id).first();
    expect(review).toEqual({ reviewer_email: "rev@example.org", final_paite: "Ka dam e.", register: "spoken" });
    const statuses = await env.DB.prepare("SELECT status FROM answers WHERE sentence_id = ?1 ORDER BY status").bind(id).all();
    expect(statuses.results.map((s) => s.status)).toEqual(["accepted", "also_correct"]);
  });

  it("fix: accept with edited text stores the edited text", async () => {
    const id = await fullSentence();
    const card = await (await rev("/review/api/next")).json<{ answers: { id: number }[] }>();
    await rev("/review/api/decide", { sentenceId: id, decision: "accept", answerIds: card.answers.map((a) => a.id), answerId: card.answers[0].id, finalPaite: "  Ka dam  e. " });
    const review = await env.DB.prepare("SELECT final_paite FROM reviews WHERE sentence_id = ?1").bind(id).first();
    expect(review).toEqual({ final_paite: "Ka dam e." });
  });

  it("reject reopens the sentence for new answers", async () => {
    const id = await fullSentence();
    const card = await (await rev("/review/api/next")).json<{ answers: { id: number }[] }>();
    await rev("/review/api/decide", { sentenceId: id, decision: "reject", answerIds: card.answers.map((a) => a.id) });
    expect(await env.DB.prepare("SELECT status, answer_count FROM sentences WHERE id = ?1").bind(id).first()).toEqual({ status: "open", answer_count: 0 });
  });

  it("deciding without holding the lock is refused", async () => {
    const id = await fullSentence();
    expect((await rev("/review/api/decide", { sentenceId: id, decision: "reject", answerIds: [1] })).status).toBe(409);
  });

  it("expired lock is refused", async () => {
    const id = await fullSentence();
    const card = await (await rev("/review/api/next", undefined, "rev@example.org", NOW)).json<{ answers: { id: number }[] }>();
    const later = NOW + 11 * 60_000;
    await rev("/review/api/next", undefined, "owner@example.org", later);
    expect((await rev("/review/api/decide", { sentenceId: id, decision: "reject", answerIds: card.answers.map((a) => a.id) }, "rev@example.org", later)).status).toBe(409);
  });

  it("owner can undo a decision that is not yet exported; others cannot", async () => {
    const id = await fullSentence();
    const card = await (await rev("/review/api/next")).json<{ answers: { id: number }[] }>();
    await rev("/review/api/decide", { sentenceId: id, decision: "accept", answerIds: card.answers.map((a) => a.id), answerId: card.answers[0].id });
    const { id: reviewId } = (await env.DB.prepare("SELECT id FROM reviews WHERE sentence_id = ?1").bind(id).first<{ id: number }>())!;
    expect((await rev("/review/api/undo", { reviewId })).status).toBe(403);
    expect((await rev("/review/api/undo", { reviewId }, "owner@example.org")).status).toBe(200);
    expect(await env.DB.prepare("SELECT status FROM sentences WHERE id = ?1").bind(id).first()).toEqual({ status: "full" });
    const st = await env.DB.prepare("SELECT status FROM answers WHERE sentence_id = ?1").bind(id).all();
    expect(st.results.map((s) => s.status)).toEqual(["new", "new"]);
    expect((await env.DB.prepare("SELECT undone_at FROM reviews WHERE id = ?1").bind(reviewId).first<{ undone_at: string | null }>())!.undone_at).not.toBeNull();
  });

  it("undo of an older review is refused once a newer one exists", async () => {
    const id = await fullSentence();
    const c1 = await (await rev("/review/api/next")).json<{ answers: { id: number }[] }>();
    await rev("/review/api/decide", { sentenceId: id, decision: "reject", answerIds: c1.answers.map((a) => a.id) });
    await call("/api/answer", { method: "POST", session: await session(PHONE_C), body: JSON.stringify({ sentenceId: id, paite: "Ka dam hi.", register: "both" }) });
    const c2 = await (await rev("/review/api/next")).json<{ answers: { id: number }[] }>();
    await rev("/review/api/decide", { sentenceId: id, decision: "reject", answerIds: c2.answers.map((a) => a.id) });
    const first = (await env.DB.prepare("SELECT MIN(id) AS id FROM reviews WHERE sentence_id = ?1").bind(id).first<{ id: number }>())!.id;
    expect((await rev("/review/api/undo", { reviewId: first }, "owner@example.org")).status).toBe(409);
  });

  it("a double submit on one lock writes exactly one review", async () => {
    const id = await fullSentence();
    const card = await (await rev("/review/api/next")).json<{ answers: { id: number }[] }>();
    const body = { sentenceId: id, decision: "accept", answerIds: card.answers.map((a) => a.id), answerId: card.answers[0].id };
    const codes = (await Promise.all([rev("/review/api/decide", body), rev("/review/api/decide", body)])).map((r) => r.status).sort();
    expect(codes).toEqual([200, 409]);
    expect((await env.DB.prepare("SELECT count(*) AS n FROM reviews WHERE sentence_id = ?1").bind(id).first<{ n: number }>())!.n).toBe(1);
  });

  it("a sentence under a live lock is not offered and refuses answers", async () => {
    const id = await fullSentence("I am well.", ["Ka dam e."]);
    await rev("/review/api/next");
    expect((await call("/api/next", { session: await session(PHONE_C) })).status).toBe(204);
    const r = await call("/api/answer", { method: "POST", session: await session(PHONE_C), body: JSON.stringify({ sentenceId: id, paite: "Late.", register: "both" }) });
    expect(r.status).toBe(409);
  });

  it("malformed input is a 400", async () => {
    const id = await fullSentence();
    expect((await rev("/review/api/decide", { sentenceId: id, decision: "reject", answerIds: "x" })).status).toBe(400);
    expect((await rev("/review/api/undo", { reviewId: "x" }, "owner@example.org")).status).toBe(400);
  });
});
