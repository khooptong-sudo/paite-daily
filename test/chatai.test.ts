import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { matchChat, recordWant } from "../src/chat";
import { queueWanted } from "../src/wants";
import { nextSentence } from "../src/db";
import { addSentences, PHONE_A, PHONE_B } from "./helpers";

const keyed = { ...env, DEEPSEEK_API_KEY: "k" };
const reply = (o: unknown) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(o) } }] }));
const model = (o: unknown, bodies: string[] = []) => (async (_u: string, init: RequestInit) => { bodies.push(init.body as string); return reply(o); }) as unknown as typeof fetch;

async function verified(english: string, paite: string) {
  const [id] = await addSentences(english);
  const a = await env.DB.prepare("INSERT INTO answers (sentence_id, paite, register, phone_id) VALUES (?1, ?2, 'both', ?3) RETURNING id").bind(id, paite, PHONE_A).first<{ id: number }>();
  await env.DB.prepare("INSERT INTO reviews (sentence_id, reviewer_email, decision, accepted_answer_id) VALUES (?1, 'rev@example.org', 'accept', ?2)").bind(id, a!.id).run();
  await env.DB.prepare("UPDATE sentences SET status = 'verified' WHERE id = ?1").bind(id).run();
  return id!;
}

describe("chat: the model chooses, the corpus speaks", () => {
  it("finds a verified pair that means the same, and shows its reviewed Paite word for word", async () => {
    await verified("How much does this cost?", "Hiai bangzah man a?");
    await verified("Where is the market?", "Bazar koiah a om a?");
    const bodies: string[] = [];
    // The shortlist is sorted by shared stems: "how much is it" shares "much" with the cost line only.
    const m = await matchChat(keyed, "how much is it", model({ id: 1 }, bodies));
    expect(m).toMatchObject({ english: "How much does this cost?", paite: "Hiai bangzah man a?", ai: true });
    expect(bodies[0]).toContain("How much does this cost?");
  });

  it("answers nothing when the model says no line means the same, and remembers that", async () => {
    await verified("How much does this cost?", "Hiai bangzah man a?");
    let calls = 0;
    const f = (async () => { calls++; return reply({ id: null }); }) as unknown as typeof fetch;
    expect(await matchChat(keyed, "how much do you love me", f)).toBeNull();
    expect(await matchChat(keyed, "how much do you love me", f)).toBeNull();
    expect(calls).toBe(1);
  });

  it("never uses an id outside its list, and falls back to word overlap when the call fails", async () => {
    await verified("How far is the town?", "Khua bangchi tuk a gamla ahia?");
    expect(await matchChat(keyed, "how far away is that town now", model({ id: 99 }))).toBeNull();
    const broken = (async () => new Response("no", { status: 500 })) as unknown as typeof fetch;
    expect((await matchChat(keyed, "how far away is the town now", broken))?.paite).toBe("Khua bangchi tuk a gamla ahia?");
  });

  it("an exact line never calls the model", async () => {
    await verified("Good morning.", "Zingpha.");
    let calls = 0;
    const f = (async () => { calls++; return reply({ id: 1 }); }) as unknown as typeof fetch;
    expect((await matchChat(keyed, "good morning", f))?.paite).toBe("Zingpha.");
    expect(calls).toBe(0);
  });
});

describe("wanted lines go to the translate queue", () => {
  it("queues the clean ones, turns down the rest, and serves a queued one first", async () => {
    await recordWant(env, "where is the hospitl");
    await recordWant(env, "call me on 9876543210");
    await addSentences("We eat rice.", "The rain is heavy.");
    const rows = await env.DB.prepare("SELECT id, english FROM chat_wants ORDER BY id").all<{ id: number; english: string }>();
    const [clean, phone] = rows.results;
    const r = await queueWanted(keyed, model({ keep: [{ id: clean.id, english: "Where is the hospital?" }, { id: 12345, english: "Injected line." }] }));
    expect(r).toEqual({ checked: 2, queued: 1 });
    const v = await env.DB.prepare("SELECT id, vetted FROM chat_wants ORDER BY id").all<{ id: number; vetted: number }>();
    expect(v.results).toEqual([{ id: clean.id, vetted: 1 }, { id: phone.id, vetted: 2 }]);
    const s = await env.DB.prepare("SELECT english, source FROM sentences WHERE source = 'want'").all();
    expect(s.results).toEqual([{ english: "Where is the hospital?", source: "want" }]);
    expect((await nextSentence(env.DB, PHONE_B, 0))?.english).toBe("Where is the hospital?");
    // Nothing new to look at: no call.
    let calls = 0;
    expect(await queueWanted(keyed, (async () => { calls++; return reply({}); }) as unknown as typeof fetch)).toEqual({ checked: 0, queued: 0 });
    expect(calls).toBe(0);
  });

  it("does nothing without a key", async () => {
    await recordWant(env, "Where is the bank?");
    expect(await queueWanted(env, model({ keep: [] }))).toBeNull();
  });
});
