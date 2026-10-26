import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { cleanPlace, getPlaces } from "../src/places";
import { addSentences, call, PHONE_A, PHONE_B, session } from "./helpers";

const answer = async (phone: string, sentenceId: number, place: unknown) =>
  call("/api/answer", { method: "POST", session: await session(phone), body: JSON.stringify({ sentenceId, paite: "Ka dam e.", register: "both", place }) });

describe("Where you learned it", () => {
  it("tidies a place: known names and their other spellings, title case, blank as none", () => {
    expect(cleanPlace("churachandpur")).toBe("Lamka");
    expect(cleanPlace(" tiddim ")).toBe("Tedim");
    expect(cleanPlace("singngat")).toBe("Singngat");
    expect(cleanPlace("")).toBeNull();
    expect(cleanPlace(undefined)).toBeNull();
    expect(cleanPlace("x".repeat(61))).toBeUndefined();
  });

  it("stores the place with the answer, and refuses one that is too long", async () => {
    const [a, b] = await addSentences("I am well.", "Come here.");
    expect((await answer(PHONE_A, a, "ccpur")).status).toBe(200);
    expect((await env.DB.prepare("SELECT place FROM answers WHERE sentence_id = ?1").bind(a).first())!.place).toBe("Lamka");
    expect((await answer(PHONE_A, b, "x".repeat(61))).status).toBe(400);
  });

  it("counts only verified answers per place, and shows no names", async () => {
    const [a, b, c] = await addSentences("One.", "Two.", "Three.");
    await answer(PHONE_A, a, "Lamka"); await answer(PHONE_A, b, "Lamka"); await answer(PHONE_B, c, "Singngat");
    await env.DB.prepare("UPDATE answers SET status = 'accepted', contributor_name = 'Secret Name' WHERE sentence_id IN (?1, ?2)").bind(a, c).run();
    expect(await getPlaces(env)).toEqual([{ name: "Lamka", n: 1, lat: 24.33, lng: 93.68 }, { name: "Singngat", n: 1 }]);
    const page = await (await call("/places")).text();
    expect(page).toContain("Lamka · 1");
    expect(page).toContain("Singngat");
    expect(page).not.toContain("Secret Name");
  });
});
