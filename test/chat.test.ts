import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { buildScenes, matchChat, recordWant, wantedLines } from "../src/chat";
import { addSentences, call, PHONE_A } from "./helpers";

/** A sentence with an accepted answer, sitting at status verified. */
async function verified(english: string, paite: string) {
  const [id] = await addSentences(english);
  const a = await env.DB.prepare("INSERT INTO answers (sentence_id, paite, register, phone_id) VALUES (?1, ?2, 'both', ?3) RETURNING id")
    .bind(id, paite, PHONE_A)
    .first<{ id: number }>();
  await env.DB
    .prepare("INSERT INTO reviews (sentence_id, reviewer_email, decision, accepted_answer_id) VALUES (?1, 'rev@example.org', 'accept', ?2)")
    .bind(id, a!.id)
    .run();
  await env.DB.prepare("UPDATE sentences SET status = 'verified' WHERE id = ?1").bind(id).run();
  return id!;
}

describe("chat scenes", () => {
  it("builds a scene only from reviewed pairs", async () => {
    await verified("Good morning.", "Zingpha.");
    await verified("How are you?", "Na dam hia?");
    await verified("I am fine, thank you.", "Ka dam e, kipak");
    await verified("What is your name?", "Na min bang a?");
    await verified("My name is Lalmuan.", "Ka min Lalmuan ahi.");
    const [greet] = await buildScenes(env);
    expect(greet.turns.map((t) => t.paite)).toEqual(["Zingpha.", "Na dam hia?", "Ka dam e, kipak", "Na min bang a?", "Ka min Lalmuan ahi."]);
    expect(greet.turns.map((t) => t.side)).toEqual(["they", "me", "they", "me", "they"]);
  });

  it("skips a line with no reviewed pair, and hides a scene left too thin", async () => {
    await verified("Good morning.", "Zingpha.");
    await verified("How are you?", "Na dam hia?");
    expect(await buildScenes(env)).toEqual([]);
  });

  it("never shows an untranslated or either-or line", async () => {
    await verified("Good morning.", "Good morning.");
    await verified("How are you?", "Na dam hia? / Na dam diam?");
    await verified("I am fine, thank you.", "Ka dam e, kipak");
    expect(await buildScenes(env)).toEqual([]);
  });
});

describe("chat match", () => {
  it("returns the pair for an exact line", async () => {
    await verified("How much does this cost?", "Hiai bangzah man a?");
    expect(await matchChat(env, "how much does this cost")).toMatchObject({ paite: "Hiai bangzah man a?", score: 1 });
  });

  it("matches on the words that carry meaning", async () => {
    await verified("How much does this cost?", "Hiai bangzah man a?");
    await verified("How far is the town?", "Khua bangchi tuk a gamla ahia?");
    expect((await matchChat(env, "how much is this"))?.paite).toBe("Hiai bangzah man a?");
    expect((await matchChat(env, "how far is the town"))?.paite).toBe("Khua bangchi tuk a gamla ahia?");
  });

  it("says nothing rather than guessing", async () => {
    await verified("How much does this cost?", "Hiai bangzah man a?");
    expect(await matchChat(env, "where is the market")).toBeNull();
    expect(await matchChat(env, "the")).toBeNull();
    expect(await matchChat(env, "   ")).toBeNull();
  });

  it("ignores pairs that were never accepted, and unverified sentences", async () => {
    await addSentences("Where is the market?");
    expect(await matchChat(env, "where is the market")).toBeNull();
  });
});

describe("wanted lines", () => {
  it("counts repeats of the same wording once per entry", async () => {
    expect(await recordWant(env, "Where is the market?")).toBe(true);
    expect(await recordWant(env, "  where is the MARKET?  ")).toBe(true);
    const row = await env.DB.prepare("SELECT english, ask_count FROM chat_wants").first<{ english: string; ask_count: number }>();
    expect(row!.ask_count).toBe(2);
    expect(row!.english).toBe("Where is the market?");
  });

  it("drops a wanted line once it is in the corpus", async () => {
    await recordWant(env, "Where is the market?");
    expect(await wantedLines(env)).toEqual([{ english: "Where is the market?", ask_count: 1 }]);
    await addSentences("Where is the market?");
    expect(await wantedLines(env)).toEqual([]);
  });

  it("rejects an empty or wordless ask", async () => {
    expect(await recordWant(env, "")).toBe(false);
    expect(await recordWant(env, "??!")).toBe(false);
    expect(await recordWant(env, 42)).toBe(false);
  });
});

describe("chat endpoints", () => {
  it("serves scenes and matches without a session", async () => {
    await verified("Good morning.", "Zingpha.");
    await verified("How are you?", "Na dam hia?");
    await verified("I am fine, thank you.", "Ka dam e, kipak");
    const scenes = (await (await call("/api/chat/scenes")).json()) as { scenes: { turns: unknown[] }[] };
    expect(scenes.scenes[0].turns).toHaveLength(3);
    const m = (await (await call("/api/chat/match?q=good%20morning")).json()) as { match: { paite: string } };
    expect(m.match.paite).toBe("Zingpha.");
  });

  it("records a wanted line and refuses rubbish", async () => {
    expect((await call("/api/chat/want", { method: "POST", body: JSON.stringify({ q: "Where is the market?" }) })).status).toBe(200);
    expect((await call("/api/chat/want", { method: "POST", body: JSON.stringify({ q: "" }) })).status).toBe(400);
  });
});
