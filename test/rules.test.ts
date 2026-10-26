import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { clearRulesCache, getRules, swaps } from "../src/rules";
import { addSentences, call, fakeDeps, NOW, PHONE_A } from "./helpers";

beforeEach(clearRulesCache);

async function corrected(written: string, kept: string | null, opts: { direction?: string; undone?: boolean } = {}) {
  const [s] = await addSentences(`Sentence ${Math.random()}`);
  if (opts.direction) await env.DB.prepare("UPDATE sentences SET direction = ?1 WHERE id = ?2").bind(opts.direction, s).run();
  const a = await env.DB.prepare("INSERT INTO answers (sentence_id, paite, register, phone_id, status) VALUES (?1, ?2, 'both', ?3, 'accepted') RETURNING id").bind(s, written, PHONE_A).first<{ id: number }>();
  await env.DB.prepare("INSERT INTO reviews (sentence_id, reviewer_email, decision, accepted_answer_id, final_paite, undone_at) VALUES (?1, 'r@x.org', 'accept', ?2, ?3, ?4)")
    .bind(s, a!.id, kept, opts.undone ? "2026-10-26 00:00:00" : null).run();
}

describe("Spelling rulebook", () => {
  it("pairs the changed words one to one, and leaves out added or split words", () => {
    expect(swaps("Na dam hia?", "Na daam hia?")).toEqual([["dam", "daam"]]);
    expect(swaps("Ka pai ding hi", "Kei ka pai ding hi")).toEqual([]);
    expect(swaps("Ka nu leh pa", "Ka nu le pa")).toEqual([["leh", "le"]]);
    expect(swaps("Ka pai ding", "ka pai ding")).toEqual([]);
    expect(swaps("ka in ah", "kei ka inn ah")).toEqual([["in", "inn"]]);
    // A rewritten phrase is not a spelling: the words no longer look alike.
    expect(swaps("Ka nu'n kou a dia singpi", "Ka nu'n kou ading in singpi")).toEqual([]);
    expect(swaps("Zingkal teng in anntang ka huan", "Zingkal teng in antang ka huan")).toEqual([["anntang", "antang"]]);
  });

  it("counts each rule across reviews, and skips undone reviews, uncorrected accepts and English answers", async () => {
    await corrected("Na dam hia?", "Na daam hia?");
    await corrected("A dam mah", "A daam mah");
    await corrected("Ka nu leh pa", "Ka nu le pa");
    await corrected("Ka dam", "Ka daam", { undone: true });
    await corrected("Ka pai", null);
    await corrected("I am dam fine", "I am damn fine", { direction: "pai2en" });
    const rules = await getRules(env, NOW);
    expect(rules.map((r) => [r.from, r.to, r.count])).toEqual([["dam", "daam", 2], ["leh", "le", 1]]);
    expect(rules[0]).toMatchObject({ before: "Na dam hia?", after: "Na daam hia?" });
  });

  it("is public as a page and as JSON, and open to reviewers", async () => {
    await corrected("Na dam hia?", "Na daam hia?");
    const page = await call("/rules");
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("daam");
    expect(await (await call("/rules.json")).json()).toMatchObject({ rules: [{ from: "dam", to: "daam", count: 1 }] });
    expect((await call("/review/api/rules")).status).toBe(401);
    expect((await call("/review/api/rules", {}, fakeDeps({ verifyAccess: async () => "rev@example.org" }))).status).toBe(200);
  });
});
