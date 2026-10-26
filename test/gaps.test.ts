import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { COMMON, commonIn, gapScore, gapWords } from "../src/gaps";
import { nextSentence } from "../src/db";
import { addSentences, NOW, PHONE_A, PHONE_B } from "./helpers";

const verify = async (english: string) => {
  const [s] = await addSentences(english);
  await env.DB.prepare("INSERT INTO answers (sentence_id, paite, register, phone_id, status) VALUES (?1, 'x', 'both', ?2, 'accepted')").bind(s, PHONE_B).run();
};

describe("Gap-driven prompts", () => {
  it("finds common words in a line, with their simple endings", () => {
    const at = (w: string) => COMMON.indexOf(w);
    expect(commonIn("She cooks rice and drinks water.")).toEqual(expect.arrayContaining([at("cook"), at("rice"), at("drink"), at("water")]));
    expect(commonIn("Quantum flux")).toEqual([]);
    expect(new Set(COMMON).size).toBe(COMMON.length);
  });

  it("scores only the words still uncovered, earlier words higher", () => {
    const none = new Set<number>();
    expect(gapScore("I drink water", none)).toBeGreaterThan(gapScore("I drink", none));
    expect(gapScore("I drink water", new Set(commonIn("I drink water")))).toBe(0);
    expect(gapScore("go", none)).toBeGreaterThan(gapScore("still", none));
  });

  it("serves the open sentence that fills a gap before one whose words are covered", async () => {
    await verify("I eat rice.");
    const [, fill] = await addSentences("I eat rice every day.", "My grandmother sings a song.");
    for (let i = 0; i < 5; i++) {
      await env.DB.prepare("DELETE FROM seen").run();
      expect((await nextSentence(env.DB, PHONE_A, NOW + i))!.id).toBe(fill);
    }
  });

  it("lists the first uncovered words for the generator", async () => {
    await verify("Go and come.");
    const gaps = await gapWords(env.DB, NOW, 3);
    expect(gaps).toEqual(COMMON.filter((w) => w !== "go" && w !== "come").slice(0, 3));
  });
});
