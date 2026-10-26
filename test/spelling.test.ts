import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { checkSpelling, clearSpellingCache, distance, paiteWords } from "../src/spelling";
import { addSentences, call, fakeDeps, NOW, PHONE_A, session } from "./helpers";

beforeEach(clearSpellingCache);

async function verified(paite: string, status = "accepted") {
  const [s] = await addSentences(`Sentence ${Math.random()}`);
  await env.DB.prepare("INSERT INTO answers (sentence_id, paite, register, phone_id, status) VALUES (?1, ?2, 'both', ?3, ?4)").bind(s, paite, PHONE_A, status).run();
}
const ask = async (text: unknown) => (await checkSpelling(env, { text }, NOW)).json() as Promise<any>;

describe("Is this spelled right?", () => {
  it("splits a line into lower-case words and keeps apostrophes", () => {
    expect(paiteWords("Ka pai ding hi. A’ ka 12 nu!")).toEqual(["ka", "pai", "ding", "hi", "a'", "ka", "nu"]);
  });

  it("counts a swap of two letters as one edit", () => {
    expect(distance("kammal", "kamaml", 2)).toBe(1);
    expect(distance("pai", "pai", 1)).toBe(0);
    expect(distance("ding", "dingte", 1)).toBe(2);
  });

  it("knows words from verified sentences and the word list, and suggests the nearest for the rest", async () => {
    await verified("Ka pai ding hi.");
    await verified("Ka pai nawn ding hi.", "also_correct");
    await verified("Kammal hoih", "new");
    await env.DB.prepare("INSERT INTO glossary (paite, english, answer_id, sentence_id) VALUES ('kammal', 'word', 0, 0)").run();
    const r = await ask("Ka pia ding kamaml xqzv");
    expect(r.unseen).toBe(3);
    expect(r.words.find((w: any) => w.word === "ka")).toEqual({ word: "ka", count: 2 });
    expect(r.words.find((w: any) => w.word === "pia").suggestions[0]).toEqual({ word: "pai", count: 2 });
    expect(r.words.find((w: any) => w.word === "kamaml").suggestions).toEqual([{ word: "kammal", count: 1 }]);
    expect(r.words.find((w: any) => w.word === "xqzv").suggestions).toEqual([]);
    // An unverified answer is not evidence.
    expect(r.words.find((w: any) => w.word === "hoih")).toBeUndefined();
  });

  it("uses a reviewer's correction, not the submitted text", async () => {
    const [s] = await addSentences("Hello");
    const a = await env.DB.prepare("INSERT INTO answers (sentence_id, paite, register, phone_id, status) VALUES (?1, 'Chibai mah', 'both', ?2, 'accepted') RETURNING id").bind(s, PHONE_A).first<{ id: number }>();
    await env.DB.prepare("INSERT INTO reviews (sentence_id, reviewer_email, decision, accepted_answer_id, final_paite) VALUES (?1, 'r@x.org', 'accept', ?2, 'Chibai ve')").bind(s, a!.id).run();
    const r = await ask("chibai ve mah");
    expect(r.words.map((w: any) => [w.word, w.count])).toEqual([["chibai", 1], ["ve", 1], ["mah", 0]]);
  });

  it("refuses an empty or very long line", async () => {
    expect((await checkSpelling(env, { text: " " }, NOW)).status).toBe(400);
    expect((await checkSpelling(env, { text: "a".repeat(501) }, NOW)).status).toBe(400);
  });

  it("needs a contributor session or a reviewer", async () => {
    const body = JSON.stringify({ text: "ka pai" });
    expect((await call("/api/spelling", { method: "POST", body })).status).toBe(401);
    expect((await call("/api/spelling", { method: "POST", body, session: await session(PHONE_A) })).status).toBe(200);
    expect((await call("/review/api/spelling", { method: "POST", body })).status).toBe(401);
    expect((await call("/review/api/spelling", { method: "POST", body }, fakeDeps({ verifyAccess: async () => "rev@example.org" }))).status).toBe(200);
  });
});
