import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { addSentences, call, fakeDeps, PHONE_A, PHONE_B, session } from "./helpers";

const rev = (path: string, body?: unknown) =>
  call(path, body === undefined ? {} : { method: "POST", body: JSON.stringify(body) }, fakeDeps({ verifyAccess: async () => "rev@example.org" }));

// Two answers (A, B) on one sentence, then one review decision.
async function reviewed(english: string, decision: Record<string, unknown> | ((ids: number[]) => Record<string, unknown>), answers = ["A one", "B one"]) {
  const [id] = await addSentences(english);
  for (const [i, p] of [PHONE_A, PHONE_B].entries()) {
    await call("/api/answer", { method: "POST", session: await session(p), body: JSON.stringify({ sentenceId: id, paite: answers[i], register: "both" }) });
  }
  const card = await (await rev("/review/api/next")).json<{ answers: { id: number }[] }>();
  const ids = card.answers.map((a) => a.id);
  const d = typeof decision === "function" ? decision(ids) : decision;
  expect((await rev("/review/api/decide", { sentenceId: id, answerIds: ids, ...d })).status).toBe(200);
  return { id, ids };
}
const fb = async (phone: string, after = 0) => call(`/api/feedback?after=${after}`, { session: await session(phone) });
const items = async (phone: string, after = 0) => (await (await fb(phone, after)).json<{ items: any[] }>()).items;

describe("feedback", () => {
  it("401 without a session", async () => {
    expect((await call("/api/feedback")).status).toBe(401);
  });

  it("correct (accepted unchanged) and also_correct", async () => {
    await reviewed("I am well.", (ids) => ({ decision: "accept", answerId: ids[0], alsoCorrect: [ids[1]] }));
    expect((await items(PHONE_A))[0]).toMatchObject({ english: "I am well.", yours: "A one", result: "correct", corrected: null, note: null });
    expect((await items(PHONE_B))[0]).toMatchObject({ yours: "B one", result: "correct", corrected: null });
  });

  it("fixed, and other", async () => {
    await reviewed("I am well.", (ids) => ({ decision: "accept", answerId: ids[0], finalPaite: "A fixed", note: "spelling" }));
    expect((await items(PHONE_A))[0]).toMatchObject({ result: "fixed", corrected: "A fixed", note: "spelling" });
    expect((await items(PHONE_B))[0]).toMatchObject({ yours: "B one", result: "other", corrected: "A fixed" });
  });

  it("retry on reject", async () => {
    await reviewed("I am well.", { decision: "reject" });
    expect((await items(PHONE_A))[0]).toMatchObject({ result: "retry", corrected: null });
  });

  it("retired sentences are excluded", async () => {
    await reviewed("Bad english here.", { decision: "retire" });
    expect(await items(PHONE_A)).toEqual([]);
  });

  it("undone review is excluded; the earlier not-undone review is used", async () => {
    const { id, ids } = await reviewed("I am well.", { decision: "reject" });
    const first = (await items(PHONE_A))[0].reviewId;
    await env.DB.prepare("INSERT INTO reviews (sentence_id, reviewer_email, decision, accepted_answer_id, final_paite, answer_ids, undone_at) VALUES (?1, 'x@example.org', 'accept', ?2, 'Z', ?3, datetime('now'))")
      .bind(id, ids[0], JSON.stringify(ids)).run();
    expect((await items(PHONE_A))[0]).toMatchObject({ reviewId: first, result: "retry" });
    await env.DB.prepare("UPDATE reviews SET undone_at = datetime('now') WHERE id = ?1").bind(first).run();
    expect(await items(PHONE_A)).toEqual([]);
  });

  it("after filters; response has no email, name or phone fields", async () => {
    await reviewed("I am well.", (ids) => ({ decision: "accept", answerId: ids[0], note: "ok" }));
    const [it] = await items(PHONE_A);
    expect(await items(PHONE_A, it.reviewId)).toEqual([]);
    expect(await items(PHONE_A, it.reviewId - 1)).toHaveLength(1);
    const text = await (await fb(PHONE_A)).text();
    expect(Object.keys(it).sort()).toEqual(["corrected", "english", "note", "result", "reviewId", "yours"]);
    expect(text).not.toMatch(/rev@example|phone|aaaaaaaa|bbbbbbbb/);
  });

  it("another phone's answers are never returned", async () => {
    await reviewed("I am well.", (ids) => ({ decision: "accept", answerId: ids[0] }));
    const all = JSON.stringify(await items(PHONE_A));
    expect(all).not.toContain("B one");
    expect(await items("cccccccc-cccc-4ccc-8ccc-cccccccccccc")).toEqual([]);
  });
});
