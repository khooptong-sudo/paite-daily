import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { recordAnswer } from "../src/db";
import { addSentences, call, PHONE_A, PHONE_B, PHONE_C, session } from "./helpers";

const answer = async (phone: string, sentenceId: number, paite = "Ka dam e.", extra: Record<string, unknown> = {}) =>
  call("/api/answer", {
    method: "POST",
    session: await session(phone),
    body: JSON.stringify({ sentenceId, paite, register: "both", ...extra }),
  });

describe("answers", () => {
  it("records an answer and hides the sentence from that phone", async () => {
    const [id] = await addSentences("I am well.");
    expect((await answer(PHONE_A, id)).status).toBe(200);
    expect((await call("/api/next", { session: await session(PHONE_A) })).status).toBe(204);
    const row = await env.DB.prepare("SELECT paite, register, status FROM answers WHERE sentence_id = ?1").bind(id).first();
    expect(row).toEqual({ paite: "Ka dam e.", register: "both", status: "new" });
  });

  it("second answer closes the sentence", async () => {
    const [id] = await addSentences("I am well.");
    await answer(PHONE_A, id);
    await answer(PHONE_B, id);
    const s = await env.DB.prepare("SELECT status, answer_count FROM sentences WHERE id = ?1").bind(id).first();
    expect(s).toEqual({ status: "full", answer_count: 2 });
    expect((await call("/api/next", { session: await session(PHONE_C) })).status).toBe(204);
    expect((await answer(PHONE_C, id)).status).toBe(409);
  });

  it("second answer race: never more than 2 answers", async () => {
    const [id] = await addSentences("I am well.");
    await answer(PHONE_A, id);
    const results = await Promise.all([answer(PHONE_B, id), answer(PHONE_C, id)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const { n } = (await env.DB.prepare("SELECT count(*) AS n FROM answers WHERE sentence_id = ?1").bind(id).first<{ n: number }>())!;
    expect(n).toBe(2);
  });

  it("the same phone cannot answer the same sentence twice", async () => {
    const [id] = await addSentences("I am well.");
    expect((await answer(PHONE_A, id)).status).toBe(200);
    expect((await answer(PHONE_A, id)).status).toBe(409);
  });

  it("answer text is cleaned and bounded", async () => {
    const [a, b, c, d] = await addSentences("One.", "Two.", "Three.", "Four.");
    expect((await answer(PHONE_A, a, "  Ka   dam\n e.  ")).status).toBe(200);
    const row = await env.DB.prepare("SELECT paite FROM answers WHERE sentence_id = ?1").bind(a).first<{ paite: string }>();
    expect(row!.paite).toBe("Ka dam e.");
    expect((await answer(PHONE_A, b, "x".repeat(301))).status).toBe(400);
    expect((await answer(PHONE_A, c, "bad\u0007bell")).status).toBe(400);
    expect((await answer(PHONE_A, d, "   ")).status).toBe(400);
  });

  it("rejects a bad register and keeps an optional name", async () => {
    const [a, b] = await addSentences("One.", "Two.");
    expect((await answer(PHONE_A, a, "Ka dam e.", { register: "sung" })).status).toBe(400);
    expect((await answer(PHONE_A, b, "Ka dam e.", { register: "spoken", name: "  Mang  " })).status).toBe(200);
    const row = await env.DB.prepare("SELECT register, contributor_name FROM answers WHERE sentence_id = ?1").bind(b).first();
    expect(row).toEqual({ register: "spoken", contributor_name: "Mang" });
  });

  it("rate limit: the 11th answer within a minute is refused", async () => {
    const ids = await addSentences(...Array.from({ length: 11 }, (_, i) => `Sentence ${i}.`));
    for (const id of ids.slice(0, 10)) expect((await answer(PHONE_A, id)).status).toBe(200);
    expect((await answer(PHONE_A, ids[10])).status).toBe(429);
  });

  it("a constraint error on insert maps to closed and gives the claim back", async () => {
    const [id] = await addSentences("I am well.");
    const racing = new Proxy(env.DB, {
      get: (t, k) => k === "batch"
        ? async (stmts: D1PreparedStatement[]) => { await env.DB.prepare("INSERT INTO seen (phone_id, sentence_id, action) VALUES (?1, ?2, 'answered')").bind(PHONE_A, id).run(); return t.batch(stmts); }
        : (t as any)[k].bind(t),
    });
    expect(await recordAnswer(racing, { phoneId: PHONE_A, sentenceId: id, paite: "Ka dam e.", register: "both", name: null }, 1)).toBe("closed");
    expect(await env.DB.prepare("SELECT status, answer_count FROM sentences WHERE id = ?1").bind(id).first()).toEqual({ status: "open", answer_count: 0 });
  });
});
