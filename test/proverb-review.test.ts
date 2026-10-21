import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { decideProverbAnswer, decideProverbPair, getProverbReviewList } from "../src/proverbreview";
import type { Env } from "../src/types";

// Sayings need two reviewers before they publish. These tests hold that rule,
// because the failure it prevents is silent: a half-reviewed saying reaching the
// public page looks exactly like a reviewed one.

const DB = env as unknown as Env;

const ENGLISH = "A rolling stone gathers no moss";
const LINKS = ["Lampam sik khiallou kuamah omlou", "Suang tuktuk pan a kai kei", "Tui leh mei a kikham kei"];

// proverbs_english_unique and proverbs_paite_unique are both real, and the
// suite shares one database, so each test starts from empty.
beforeEach(async () => {
  await DB.DB.batch([
    DB.DB.prepare("DELETE FROM proverb_votes"),
    DB.DB.prepare("DELETE FROM proverb_answers"),
    DB.DB.prepare("DELETE FROM proverbs"),
  ]);
});

let seq = 0;

async function seedSaying(english: string, status = "open"): Promise<number> {
  const r = await DB.DB.prepare(
    `INSERT INTO proverbs (kind, english, entered_from, status) VALUES ('proverb', ?1, 'en2pai', ?2) RETURNING id`,
  )
    .bind(`${english} #${++seq}`, status)
    .first<{ id: number }>();
  return r!.id;
}

async function seedAnswer(proverbId: number, paite: string): Promise<number> {
  const r = await DB.DB.prepare(
    `INSERT INTO proverb_answers (proverb_id, paite, phone_id, contributor_name) VALUES (?1, ?2, 'p-1', 'Contributor') RETURNING id`,
  )
    .bind(proverbId, paite)
    .first<{ id: number }>();
  return r!.id;
}

const sayingStatus = async (id: number) =>
  (await DB.DB.prepare("SELECT status, paite FROM proverbs WHERE id = ?1").bind(id).first<{ status: string; paite: string | null }>())!;

const answerStatus = async (id: number) =>
  (await DB.DB.prepare("SELECT status FROM proverb_answers WHERE id = ?1").bind(id).first<{ status: string }>())!.status;

describe("sayings need two reviewers", () => {
  it("holds a candidate back after one approval", async () => {
    const pid = await seedSaying(ENGLISH);
    const aid = await seedAnswer(pid, LINKS[0]);

    expect(await decideProverbAnswer(DB, "one@example.org", aid, true)).toBe("waiting");
    expect((await sayingStatus(pid)).status).toBe("open");
    expect(await answerStatus(aid)).toBe("new");
  });

  it("publishes on the second, different reviewer", async () => {
    const pid = await seedSaying(ENGLISH);
    const aid = await seedAnswer(pid, LINKS[0]);

    await decideProverbAnswer(DB, "one@example.org", aid, true);
    expect(await decideProverbAnswer(DB, "two@example.org", aid, true)).toBe("ok");

    const p = await sayingStatus(pid);
    expect(p.status).toBe("live");
    expect(p.paite).toBe(LINKS[0]);
    expect(await answerStatus(aid)).toBe("accepted");
  });

  it("counts one reviewer once in either letter case", async () => {
    const pid = await seedSaying(ENGLISH);
    const aid = await seedAnswer(pid, LINKS[0]);

    expect(await decideProverbAnswer(DB, "one@example.org", aid, true)).toBe("waiting");
    expect(await decideProverbAnswer(DB, "ONE@Example.org", aid, true)).toBe("waiting");
    expect((await sayingStatus(pid)).status).toBe("open");
  });

  it("takes one rejection as final", async () => {
    const pid = await seedSaying(ENGLISH);
    const aid = await seedAnswer(pid, LINKS[0]);

    await decideProverbAnswer(DB, "one@example.org", aid, true);
    expect(await decideProverbAnswer(DB, "two@example.org", aid, false)).toBe("ok");
    expect(await answerStatus(aid)).toBe("rejected");
    expect((await sayingStatus(pid)).status).toBe("open");
  });

  it("rejects the other candidates once one is published", async () => {
    const pid = await seedSaying(ENGLISH);
    const winner = await seedAnswer(pid, LINKS[0]);
    const loser = await seedAnswer(pid, LINKS[1]);

    await decideProverbAnswer(DB, "one@example.org", winner, true);
    await decideProverbAnswer(DB, "two@example.org", winner, true);

    expect(await answerStatus(winner)).toBe("accepted");
    expect(await answerStatus(loser)).toBe("rejected");
  });

  it("applies the same rule to a whole submitted saying", async () => {
    const pid = await seedSaying("Strike while the iron is hot", "pending");

    expect(await decideProverbPair(DB, "one@example.org", pid, true)).toBe("waiting");
    expect((await sayingStatus(pid)).status).toBe("pending");

    expect(await decideProverbPair(DB, "two@example.org", pid, true)).toBe("ok");
    expect((await sayingStatus(pid)).status).toBe("live");
  });

  it("shows the list who has already voted", async () => {
    const pid = await seedSaying(ENGLISH);
    const aid = await seedAnswer(pid, LINKS[0]);
    await decideProverbAnswer(DB, "one@example.org", aid, true);

    const list = await getProverbReviewList(DB, "one@example.org");
    const row = list.answers.find((a) => a.id === aid)!;
    expect(row.accepts).toBe(1);
    expect(row.mine).toBe(1);
    expect(list.required).toBe(2);

    const other = await getProverbReviewList(DB, "stranger@example.org");
    expect(other.answers.find((a) => a.id === aid)!.mine).toBe(0);
  });
});
