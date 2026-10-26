import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { streakFor } from "../src/streak";
import { addSentences, call, PHONE_A, session } from "./helpers";

const NOW = 1_800_000_000_000;
async function answerOn(sid: number, days: number) {
  await env.DB.prepare(`INSERT INTO answers (sentence_id, phone_id, paite, register, status, created_at) VALUES (?1, ?2, 'x', 'both', 'new', datetime(?3 / 1000, 'unixepoch', '-${days} days'))`)
    .bind(sid, PHONE_A, NOW).run();
}

describe("streakFor", () => {
  it("is 0 when nothing was sent", async () => {
    expect(await streakFor(env.DB, PHONE_A, NOW)).toBe(0);
  });

  it("counts consecutive days including today", async () => {
    const [s] = await addSentences("One.");
    for (const d of [0, 1, 2]) await answerOn(s, d);
    expect(await streakFor(env.DB, PHONE_A, NOW)).toBe(3);
  });

  it("a gap breaks it", async () => {
    const [s] = await addSentences("One.");
    for (const d of [0, 1, 3, 4, 5]) await answerOn(s, d);
    expect(await streakFor(env.DB, PHONE_A, NOW)).toBe(2);
  });

  it("still counts up to yesterday when today is empty", async () => {
    const [s] = await addSentences("One.");
    for (const d of [1, 2]) await answerOn(s, d);
    expect(await streakFor(env.DB, PHONE_A, NOW)).toBe(2);
  });

  it("is 0 when the last answer was two days ago", async () => {
    const [s] = await addSentences("One.");
    await answerOn(s, 2);
    expect(await streakFor(env.DB, PHONE_A, NOW)).toBe(0);
  });
});

describe("/api/me", () => {
  it("includes streak", async () => {
    const r = await call("/api/me", { session: await session(PHONE_A) });
    expect((await r.json() as { streak: number }).streak).toBe(0);
  });
});
