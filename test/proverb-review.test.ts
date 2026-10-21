import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { saveProverbReview } from "../src/proverbcard";
import { decideProverbAnswer, decideProverbPair, getProverbReviewList, skipProverbSaying, undoProverbReview } from "../src/proverbreview";

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
    DB.DB.prepare("DELETE FROM proverb_skips"),
    DB.DB.prepare("DELETE FROM proverb_reviews"),
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

  it("leaves the other candidates in the queue, not thrown away", async () => {
    const pid = await seedSaying(ENGLISH);
    const winner = await seedAnswer(pid, LINKS[0]);
    const other = await seedAnswer(pid, LINKS[1]);

    await decideProverbAnswer(DB, "one@example.org", winner, true);
    await decideProverbAnswer(DB, "two@example.org", winner, true);

    expect(await answerStatus(winner)).toBe("accepted");
    // The saying keeps collecting renderings, so a second line is still a candidate.
    expect(await answerStatus(other)).toBe("new");
  });

  it("publishes the reviewer's correction, not the contributor's spelling", async () => {
    const pid = await seedSaying(ENGLISH);
    const aid = await seedAnswer(pid, LINKS[0]);
    const fixed = "Suang tuktuk pan a kai kei.";

    await decideProverbAnswer(DB, "one@example.org", aid, true, { finalPaite: fixed });
    await decideProverbAnswer(DB, "two@example.org", aid, true);

    expect((await sayingStatus(pid)).paite).toBe(fixed);
  });

  it("keeps a variant as an alternative without publishing it", async () => {
    const pid = await seedSaying(ENGLISH);
    const aid = await seedAnswer(pid, LINKS[1]);

    expect(await decideProverbAnswer(DB, "one@example.org", aid, true, { decision: "variant" })).toBe("ok");
    expect(await answerStatus(aid)).toBe("also_correct");
    expect((await sayingStatus(pid)).status).toBe("open");
  });

  it("opens the saying for more renderings once it publishes", async () => {
    const pid = await seedSaying(ENGLISH);
    const aid = await seedAnswer(pid, LINKS[0]);
    await decideProverbAnswer(DB, "one@example.org", aid, true);
    await decideProverbAnswer(DB, "two@example.org", aid, true);

    const row = await DB.DB.prepare("SELECT accepting_more FROM proverbs WHERE id = ?1").bind(pid).first<{ accepting_more: number }>();
    expect(row!.accepting_more).toBe(1);
  });

  it("applies the same rule to a whole submitted saying", async () => {
    const pid = await seedSaying("Strike while the iron is hot", "pending");

    expect(await decideProverbPair(DB, "one@example.org", pid, true)).toBe("waiting");
    expect((await sayingStatus(pid)).status).toBe("pending");

    expect(await decideProverbPair(DB, "two@example.org", pid, true)).toBe("ok");
    expect((await sayingStatus(pid)).status).toBe("live");
  });

  it("takes fresh renderings for a saying that already published", async () => {
    // A published saying, collecting more: exactly the state a reviewed saying
    // goes back to the pool in.
    const pid = await seedSaying(ENGLISH, "live");
    await DB.DB.prepare("UPDATE proverbs SET paite = ?2, accepting_more = 1 WHERE id = ?1")
      .bind(pid, LINKS[0])
      .run();

    const gate = await DB.DB.prepare("SELECT status, accepting_more FROM proverbs WHERE id = ?1")
      .bind(pid)
      .first<{ status: string; accepting_more: number }>();
    expect(gate).toEqual({ status: "live", accepting_more: 1 });

    await seedAnswer(pid, LINKS[2]);

    // The new line reaches the reviewer.
    const list = await getProverbReviewList(DB, "one@example.org");
    const fresh = list.answers.find((a) => a.proverb_id === pid);
    expect(fresh?.paite).toBe(LINKS[2]);

    // Two approvals accept it as an alternative without overwriting the primary line.
    await saveProverbReview(DB, "one@example.org", { proverbId: pid, acceptAnswerId: fresh!.id, finalPaite: LINKS[2] });
    await saveProverbReview(DB, "two@example.org", { proverbId: pid, acceptAnswerId: fresh!.id, finalPaite: LINKS[2] });

    const p = await sayingStatus(pid);
    expect(p.status).toBe("live");
    expect(p.paite).toBe(LINKS[0]);
    expect(await answerStatus(fresh!.id)).toBe("accepted");
  });

  it("skips a saying out of one reviewer's queue only", async () => {
    const pid = await seedSaying(ENGLISH);
    await seedAnswer(pid, LINKS[0]);
    const now = Date.now();

    expect((await getProverbReviewList(DB, "one@example.org", now)).answers.length).toBe(1);
    expect(await skipProverbSaying(DB, "one@example.org", pid, now)).toBe(true);

    // Gone for the reviewer who skipped, still there for everyone else.
    expect((await getProverbReviewList(DB, "one@example.org", now + 60_000)).answers.length).toBe(0);
    expect((await getProverbReviewList(DB, "two@example.org", now + 60_000)).answers.length).toBe(1);

    // Back after two hours.
    const later = now + 2 * 60 * 60 * 1000 + 60_000;
    expect((await getProverbReviewList(DB, "one@example.org", later)).answers.length).toBe(1);
  });

  it("undoes an accept and puts the saying back", async () => {
    const pid = await seedSaying(ENGLISH);
    const aid = await seedAnswer(pid, LINKS[0]);

    await saveProverbReview(DB, "one@example.org", { proverbId: pid, acceptAnswerId: aid });
    expect(await answerStatus(aid)).toBe("new");

    expect(await undoProverbReview(DB, "one@example.org", pid)).toBe(true);
    expect(await answerStatus(aid)).toBe("new");
    expect((await sayingStatus(pid)).status).toBe("open");

    const list = await getProverbReviewList(DB, "one@example.org");
    expect(list.answers.some((a) => a.id === aid)).toBe(true);
  });

  it("undoes the review that published, and takes the saying back with it", async () => {
    const pid = await seedSaying(ENGLISH);
    const aid = await seedAnswer(pid, LINKS[0]);

    await saveProverbReview(DB, "one@example.org", { proverbId: pid, acceptAnswerId: aid, finalPaite: LINKS[0] });
    await saveProverbReview(DB, "two@example.org", { proverbId: pid, acceptAnswerId: aid, finalPaite: LINKS[0] });
    expect((await sayingStatus(pid)).status).toBe("live");

    expect(await undoProverbReview(DB, "two@example.org", pid)).toBe(true);
    const p = await sayingStatus(pid);
    expect(p.status).toBe("open");
    expect(p.paite).toBeNull();
    expect(await answerStatus(aid)).toBe("new");
  });

  it("does not touch the primary line when undoing an alternative", async () => {
    const pid = await seedSaying(ENGLISH, "live");
    await DB.DB.prepare("UPDATE proverbs SET paite = ?2, accepting_more = 1 WHERE id = ?1").bind(pid, LINKS[0]).run();
    const alt = await seedAnswer(pid, LINKS[1]);

    await saveProverbReview(DB, "one@example.org", { proverbId: pid, acceptAnswerId: alt });
    await saveProverbReview(DB, "two@example.org", { proverbId: pid, acceptAnswerId: alt });
    expect(await answerStatus(alt)).toBe("accepted");

    expect(await undoProverbReview(DB, "two@example.org", pid)).toBe(true);
    const p = await sayingStatus(pid);
    expect(p.status).toBe("live");
    expect(p.paite).toBe(LINKS[0]);
  });

  it("reports nothing to undo when there is nothing", async () => {
    const pid = await seedSaying(ENGLISH);
    expect(await undoProverbReview(DB, "stranger@example.org", pid)).toBe(false);
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
