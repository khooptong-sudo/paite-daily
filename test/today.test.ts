import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { clearTodayCache, contributorOfTheDay } from "../src/today";
import { addSentences, call, fakeDeps, PHONE_A, PHONE_B, PHONE_C } from "./helpers";

// 2027-01-15 12:00 UTC = 17:30 IST on 15 Jan, so "yesterday" in IST is 14 Jan (13 Jan 18:30 to 14 Jan 18:30 UTC).
const NOW = Date.parse("2027-01-15T12:00:00Z");

async function verified(phone: string, name: string | null, at: string, undone = false) {
  const [s] = await addSentences(`S ${Math.random()}`);
  const a = await env.DB.prepare("INSERT INTO answers (sentence_id, phone_id, paite, register, contributor_name, status) VALUES (?1, ?2, 'x', 'both', ?3, 'accepted') RETURNING id")
    .bind(s, phone, name).first<{ id: number }>();
  await env.DB.prepare("INSERT INTO reviews (sentence_id, reviewer_email, decision, final_paite, register, created_at, undone_at, answer_ids) VALUES (?1, 'r@example.org', 'accept', 'x', 'both', ?2, ?3, ?4)")
    .bind(s, at, undone ? "2027-01-14 10:00:00" : null, JSON.stringify([a!.id])).run();
}
const word = (phone: string, name: string, at: string) =>
  env.DB.prepare("INSERT INTO word_submissions (phone_id, paite, english, contributor_name, status, decided_at) VALUES (?1, 'pau', 'word', ?2, 'approved', ?3)").bind(phone, name, at).run();

describe("contributor of the day", () => {
  it("returns a named phone verified yesterday (IST) with counts, not today or two days ago", async () => {
    await verified(PHONE_A, "Mang", "2027-01-14 05:00:00");
    await verified(PHONE_A, "Mang", "2027-01-14 06:00:00");
    await word(PHONE_A, "Mang", "2027-01-14 07:00:00");
    await verified(PHONE_B, "Tial", "2027-01-15 05:00:00");
    await verified(PHONE_C, "Old", "2027-01-12 05:00:00");
    expect(await contributorOfTheDay(env, NOW)).toEqual({ name: "Mang", sentences: 2, words: 1, period: "day" });
  });

  it("uses India time at the day boundary", async () => {
    await verified(PHONE_A, "Mang", "2027-01-14 18:45:00"); // IST 15 Jan: today, not yesterday
    expect(await contributorOfTheDay(env, NOW)).toBeNull();
    await verified(PHONE_B, "Tial", "2027-01-13 18:45:00"); // IST 14 Jan: yesterday
    clearTodayCache();
    expect(await contributorOfTheDay(env, NOW)).toMatchObject({ name: "Tial", period: "day" });
  });

  it("skips unnamed phones and undone reviews", async () => {
    await verified(PHONE_A, null, "2027-01-14 05:00:00");
    await verified(PHONE_B, "Tial", "2027-01-14 05:00:00", true);
    expect(await contributorOfTheDay(env, NOW)).toBeNull();
  });

  it("falls back to the week, then to nobody", async () => {
    expect(await contributorOfTheDay(env, NOW)).toBeNull();
    await verified(PHONE_A, "Mang", "2027-01-10 05:00:00");
    clearTodayCache();
    expect(await contributorOfTheDay(env, NOW)).toEqual({ name: "Mang", sentences: 1, words: 0, period: "week" });
  });

  it("picks the same person all day, one of the eligible", async () => {
    await verified(PHONE_A, "Mang", "2027-01-14 05:00:00");
    await verified(PHONE_B, "Tial", "2027-01-14 05:00:00");
    await verified(PHONE_C, "Vung", "2027-01-14 05:00:00");
    const one = await contributorOfTheDay(env, NOW);
    clearTodayCache();
    const two = await contributorOfTheDay(env, NOW + 3_600_000);
    expect(two).toEqual(one);
    expect(["Mang", "Tial", "Vung"]).toContain(one!.name);
  });

  it("/api/today needs no session and is cached; 204 when nobody", async () => {
    const empty = await call("/api/today", {}, fakeDeps({ now: () => NOW }));
    expect(empty.status).toBe(204);
    await verified(PHONE_A, "Mang", "2027-01-14 05:00:00");
    clearTodayCache();
    const r = await call("/api/today", {}, fakeDeps({ now: () => NOW }));
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("public, max-age=300");
    expect(await r.json()).toEqual({ name: "Mang", sentences: 1, words: 0, period: "day" });
  });

  it("keeps the answer for ten minutes, then reads again", async () => {
    expect(await contributorOfTheDay(env, NOW)).toBeNull();
    await verified(PHONE_A, "Mang", "2027-01-14 05:00:00");
    expect(await contributorOfTheDay(env, NOW + 60_000)).toBeNull();
    expect(await contributorOfTheDay(env, NOW + 11 * 60_000)).toMatchObject({ name: "Mang" });
  });
});
