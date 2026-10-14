import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { nextSentence } from "../src/db";
import { exportVerified } from "../src/export";
import { runPrereview } from "../src/prereview";
import { runReverse } from "../src/reverse";
import { addSentences, call, fakeDeps, NOW, PHONE_A, PHONE_B, PHONE_C, session } from "./helpers";

const rev = (path: string, body?: unknown) =>
  call(path, body === undefined ? {} : { method: "POST", body: JSON.stringify(body) }, fakeDeps({ verifyAccess: async () => "rev@example.org" }));

const puts: any[] = [];
const ghFetch = (async (_u: string, init?: RequestInit) => {
  if (init?.method === "PUT") puts.push(JSON.parse(init.body as string));
  return new Response("{}", { status: 201 });
}) as typeof fetch;

// A verified en2pai sentence: PHONE_A answered `paite` (accepted), PHONE_B answered "other" (also_correct).
async function verified(english = "I am well.", paite = "Ka dam e.", doExport = true) {
  const [id] = await addSentences(english);
  for (const [p, t] of [[PHONE_A, paite], [PHONE_B, "Dam ka ne."]] as const) {
    await call("/api/answer", { method: "POST", session: await session(p), body: JSON.stringify({ sentenceId: id, paite: t, register: "both" }) });
  }
  const card = await (await rev("/review/api/next")).json<{ answers: { id: number }[] }>();
  const ids = card.answers.map((a) => a.id);
  await rev("/review/api/decide", { sentenceId: id, answerIds: ids, decision: "accept", answerId: ids[0], alsoCorrect: [ids[1]] });
  if (doExport) await exportVerified(env, ghFetch);
  return { id, ids };
}
const reverseRows = async () => (await env.DB.prepare("SELECT id, english, paite_prompt, direction, source_answer_id FROM sentences WHERE direction = 'pai2en'").all<any>()).results;

describe("reverse prompts", () => {
  it("creates one per accepted answer only, idempotently, from the reviewed text", async () => {
    const { ids } = await verified();
    expect(await runReverse(env)).toEqual({ created: 1 });
    expect(await runReverse(env)).toBeNull();
    const rows = await reverseRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ english: "I am well.", paite_prompt: "Ka dam e.", source_answer_id: ids[0] });
    // the reverse sentence itself, once accepted, makes no further prompt
    await env.DB.prepare("UPDATE answers SET status = 'accepted' WHERE sentence_id = ?1").bind(rows[0].id).run();
    expect(await runReverse(env)).toBeNull();
  });

  it("makes no prompt for an accept that is not exported yet", async () => {
    await verified("I am well.", "Ka dam e.", false);
    expect(await runReverse(env)).toBeNull();
    await exportVerified(env, ghFetch);
    expect(await runReverse(env)).toEqual({ created: 1 });
  });

  it("is not served to the author of the source answer, and never blocks", async () => {
    await verified();
    await runReverse(env);
    // PHONE_A and PHONE_B answered the source sentence, so no card; a phone that only skipped it saw the original English, so none either
    expect(await nextSentence(env.DB, PHONE_A, NOW)).toBeNull();
    expect(await nextSentence(env.DB, PHONE_B, NOW)).toBeNull();
    const src = (await env.DB.prepare("SELECT id FROM sentences WHERE direction = 'en2pai'").first<{ id: number }>())!.id;
    await env.DB.prepare("INSERT INTO seen (phone_id, sentence_id, action) VALUES (?1, ?2, 'skipped')").bind("dddddddd-dddd-4ddd-8ddd-dddddddddddd", src).run();
    expect(await nextSentence(env.DB, "dddddddd-dddd-4ddd-8ddd-dddddddddddd", NOW)).toBeNull();
    expect(await nextSentence(env.DB, PHONE_C, NOW)).toMatchObject({ english: "Ka dam e.", direction: "pai2en" });
    // direct answer by the author is refused
    const [rid] = (await reverseRows()).map((r) => r.id);
    const r = await call("/api/answer", { method: "POST", session: await session(PHONE_A), body: JSON.stringify({ sentenceId: rid, paite: "I am well." }) });
    expect(r.status).toBe(409);
  });

  it("mixes 1 in 5 and falls back to en2pai when no reverse is free", async () => {
    await verified();
    await runReverse(env);
    await addSentences("One.", "Two.", "Three.", "Four.", "Five.", "Six.");
    const dirs: (string | undefined)[] = [];
    for (let i = 0; i < 7; i++) {
      const s = (await nextSentence(env.DB, PHONE_C, NOW))!;
      dirs.push(s.direction);
      await env.DB.prepare("INSERT INTO seen (phone_id, sentence_id, action) VALUES (?1, ?2, 'skipped')").bind(PHONE_C, s.id).run();
    }
    expect(dirs.indexOf("pai2en")).toBe(4); // 5th card; the only reverse prompt is used once, the rest are en2pai
    expect(dirs.filter((d) => d === "pai2en")).toHaveLength(1);
    expect(dirs.filter((d) => d === undefined).length).toBe(6);
  });

  it("serves the reverse prompt when no en2pai sentence is left", async () => {
    await verified();
    await runReverse(env);
    expect(await nextSentence(env.DB, PHONE_C, NOW)).toMatchObject({ direction: "pai2en" });
  });

  it("review card, accept, feedback and export carry the direction", async () => {
    await verified();
    await runReverse(env);
    const [row] = await reverseRows();
    await call("/api/answer", { method: "POST", session: await session(PHONE_C), body: JSON.stringify({ sentenceId: row.id, paite: "I am fine." }) });
    const card = await (await rev("/review/api/next")).json<any>();
    expect(card.sentence).toMatchObject({ id: row.id, direction: "pai2en", paite_prompt: "Ka dam e.", english: "I am well." });
    expect(card.answers[0].paite).toBe("I am fine.");
    const ids = card.answers.map((a: any) => a.id);
    expect((await rev("/review/api/decide", { sentenceId: row.id, answerIds: ids, decision: "accept", answerId: ids[0] })).status).toBe(200);

    const fb = await (await call("/api/feedback", { session: await session(PHONE_C) })).json<{ items: any[] }>();
    expect(fb.items[0]).toMatchObject({ english: "Ka dam e.", yours: "I am fine.", result: "correct", direction: "pai2en" });

    expect((await exportVerified(env, ghFetch)).exported).toBe(1);
    const lines = puts.filter((p) => p.message.includes("verified sentences")).flatMap((p) => atob(p.content).trim().split("\n").map((l) => JSON.parse(l)));
    const fwd = lines.find((l) => l.direction === "en2pai"), back = lines.find((l) => l.direction === "pai2en");
    expect(fwd).toMatchObject({ english: "I am well.", paite: "Ka dam e." });
    expect(fwd).not.toHaveProperty("original_english");
    expect(back).toMatchObject({ paite: "Ka dam e.", english: "I am fine.", original_english: "I am well." });
  });

  it("counts both directions in goal and /api/me", async () => {
    await verified();
    await runReverse(env);
    const [row] = await reverseRows();
    await call("/api/answer", { method: "POST", session: await session(PHONE_C), body: JSON.stringify({ sentenceId: row.id, paite: "I am fine." }) });
    const card = await (await rev("/review/api/next")).json<any>();
    await rev("/review/api/decide", { sentenceId: row.id, answerIds: [card.answers[0].id], decision: "accept", answerId: card.answers[0].id });
    expect(await (await call("/api/goal")).json()).toMatchObject({ verified: 2 });
    expect(await (await call("/api/me", { session: await session(PHONE_C) })).json()).toMatchObject({ verified: 1 });
  });

  it("prereview sends the Paite prompt and the original English for pai2en", async () => {
    await verified();
    await runReverse(env);
    const [row] = await reverseRows();
    const a = (await env.DB.prepare("INSERT INTO answers (sentence_id, paite, register, phone_id) VALUES (?1, 'I am fine.', 'both', 'x') RETURNING id").bind(row.id).first<{ id: number }>())!.id;
    const bodies: any[] = [];
    const f = (async (_u: string, init: RequestInit) => {
      bodies.push(JSON.parse(init.body as string));
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ answers: [{ id: a, note: "meaning matches", flag: "ok" }], agree: true }) } }] }));
    }) as unknown as typeof fetch;
    expect(await runPrereview({ ...env, DEEPSEEK_API_KEY: "k" }, f)).toEqual({ noted: 1, failed: 0 });
    expect(bodies[0].messages[0].content).toContain("original English");
    expect(bodies[0].messages[1].content).toContain("Paite: Ka dam e.\nOriginal English: I am well.\nAnswers:");
    expect((await env.DB.prepare("SELECT ai_note FROM answers WHERE id = ?1").bind(a).first<any>()).ai_note).toBe("meaning matches");
  });
});
