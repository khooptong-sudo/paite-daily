import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { addSentences, call, PHONE_A, PHONE_B, session } from "./helpers";

const ago = (days: number) => `datetime(1800000000, 'unixepoch', '-${days} days')`;

async function answer(sid: number, phone: string, days: number, status = "new"): Promise<number> {
  const r = await env.DB.prepare(`INSERT INTO answers (sentence_id, phone_id, paite, register, status, created_at) VALUES (?1, ?2, 'x', 'both', ?3, ${ago(days)}) RETURNING id`)
    .bind(sid, phone, status).first<{ id: number }>();
  return r!.id;
}
async function review(sid: number, answerId: number, days: number, undone = false) {
  await env.DB.prepare(`INSERT INTO reviews (sentence_id, reviewer_email, decision, accepted_answer_id, created_at, undone_at) VALUES (?1, 'r@x.org', 'accept', ?2, ${ago(days)}, ${undone ? "datetime('now')" : "NULL"})`)
    .bind(sid, answerId).run();
}
const week = async (phone: string) => (await call("/api/week", { session: await session(phone) })).json();

describe("/api/week", () => {
  it("401 without a session", async () => {
    expect((await call("/api/week")).status).toBe(401);
  });

  it("counts the last seven days only, and not undone reviews", async () => {
    const ids = await addSentences("One.", "Two.", "Three.", "Four.");
    const a1 = await answer(ids[0], PHONE_A, 1, "accepted");
    const a2 = await answer(ids[1], PHONE_A, 2, "accepted");
    const a3 = await answer(ids[2], PHONE_A, 3, "also_correct");
    await answer(ids[3], PHONE_A, 10, "accepted");
    await review(ids[0], a1, 1);
    await review(ids[1], a2, 2, true);
    await review(ids[2], a3, 20); // accepted long ago: not this week's
    await env.DB.prepare(`INSERT INTO word_submissions (paite, english, phone_id, created_at) VALUES ('Tui', 'Water', ?1, ${ago(1)}), ('Mei', 'Fire', ?1, ${ago(9)}), ('Ni', 'Sun', ?2, ${ago(1)})`).bind(PHONE_A, PHONE_B).run();
    expect(await week(PHONE_A)).toEqual({ sent: 3, verified: 1, words: 1, rank: 1 });
  });

  it("ranks by answers sent, null when none", async () => {
    const ids = await addSentences("One.", "Two.", "Three.");
    await answer(ids[0], PHONE_A, 1);
    await answer(ids[0], PHONE_B, 1);
    await answer(ids[1], PHONE_B, 2);
    await answer(ids[2], PHONE_B, 30);
    expect(await week(PHONE_A)).toMatchObject({ sent: 1, rank: 2 });
    expect(await week(PHONE_B)).toMatchObject({ sent: 2, rank: 1 });
    expect(await week("cccccccc-cccc-4ccc-8ccc-cccccccccccc")).toEqual({ sent: 0, verified: 0, words: 0, rank: null });
  });
});
