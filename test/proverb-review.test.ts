import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { saveProverbReview } from "../src/proverbcard";
import { decideProverbPair, getProverbReviewList, skipProverbSaying, undoProverbReview } from "../src/proverbreview";
import type { Env } from "../src/types";

// One reviewer publishes. A second submission is a comparison against the line
// already on the page, not a second signature.

const DB = env as unknown as Env;

const ENGLISH = "A rolling stone gathers no moss";
const L1 = "Lampam sik khiallou kuamah omlou";
const L2 = "Suang tuktuk pan a kai kei";
const L3 = "Tui leh mei a kikham kei";

let seq = 0;

beforeEach(async () => {
  await DB.DB.batch([
    DB.DB.prepare("DELETE FROM proverb_skips"),
    DB.DB.prepare("DELETE FROM proverb_reviews"),
    DB.DB.prepare("DELETE FROM proverb_answers"),
    DB.DB.prepare("DELETE FROM proverbs"),
  ]);
});

async function seedSaying(english: string, status = "open", paite: string | null = null): Promise<number> {
  const r = await DB.DB.prepare(
    `INSERT INTO proverbs (kind, paite, english, entered_from, status, accepting_more)
     VALUES ('proverb', ?3, ?1, 'en2pai', ?2, ?4) RETURNING id`,
  )
    .bind(`${english} #${++seq}`, status, paite, status === "live" ? 1 : 0)
    .first<{ id: number }>();
  return r!.id;
}

async function seedAnswer(proverbId: number, paite: string): Promise<number> {
  const r = await DB.DB.prepare(
    `INSERT INTO proverb_answers (proverb_id, paite, phone_id, contributor_name) VALUES (?1, ?2, 'p-1', 'Contributor') RETURNING id`,
  )
    .bind(proverbId, `${paite} ${++seq}`)
    .first<{ id: number }>();
  return r!.id;
}

type SayingRow = { status: string; paite: string | null; accepting_more: number };

async function saying(id: number): Promise<SayingRow> {
  const r = await DB.DB.prepare("SELECT status, paite, accepting_more FROM proverbs WHERE id = ?1").bind(id).first<SayingRow>();
  return r!;
}

async function answerStatus(id: number): Promise<string> {
  const r = await DB.DB.prepare("SELECT status FROM proverb_answers WHERE id = ?1").bind(id).first<{ status: string }>();
  return r!.status;
}

describe("one reviewer publishes", () => {
  it("publishes on a single accept", async () => {
    const pid = await seedSaying(ENGLISH);
    const aid = await seedAnswer(pid, L1);

    expect(await saveProverbReview(DB, "rev@example.org", { proverbId: pid, acceptAnswerId: aid })).toBe("ok");
    const p = await saying(pid);
    expect(p.status).toBe("live");
    expect(p.accepting_more).toBe(1);
    expect(p.paite).toContain(L1.split(" ")[0]);
    expect(await answerStatus(aid)).toBe("accepted");
  });

  it("publishes the reviewer's correction, not the contributor's spelling", async () => {
    const pid = await seedSaying(ENGLISH);
    const aid = await seedAnswer(pid, L1);

    await saveProverbReview(DB, "rev@example.org", { proverbId: pid, acceptAnswerId: aid, finalPaite: "Suang tuktuk." });
    expect((await saying(pid)).paite).toBe("Suang tuktuk.");
  });

  it("keeps a rejection final", async () => {
    const pid = await seedSaying(ENGLISH);
    const aid = await seedAnswer(pid, L1);

    await saveProverbReview(DB, "rev@example.org", { proverbId: pid, rejectAll: true });
    expect(await answerStatus(aid)).toBe("rejected");
    expect((await saying(pid)).status).toBe("open");
  });

  it("keeps ticked lines as variants and rejects the rest", async () => {
    const pid = await seedSaying(ENGLISH);
    const win = await seedAnswer(pid, L1);
    const keep = await seedAnswer(pid, L2);
    const drop = await seedAnswer(pid, L3);

    await saveProverbReview(DB, "rev@example.org", {
      proverbId: pid,
      acceptAnswerId: win,
      alsoCorrect: [keep],
    });

    expect(await answerStatus(win)).toBe("accepted");
    expect(await answerStatus(keep)).toBe("also_correct");
    expect(await answerStatus(drop)).toBe("rejected");
  });
});

describe("the second submission is a comparison", () => {
  it("shows the published line beside the new one", async () => {
    const pid = await seedSaying(ENGLISH, "live", L1);
    await seedAnswer(pid, L2);

    const list = await getProverbReviewList(DB, "rev@example.org");
    const row = list.answers.find((a) => a.proverb_id === pid)!;
    expect(row.current_paite).toContain(L1.split(" ")[0]);
    expect(row.paite).toContain(L2.split(" ")[0]);
  });

  it("replaces the primary line when the new one is accepted, keeping the old answer", async () => {
    const pid = await seedSaying(ENGLISH, "live", L1);
    const old = await seedAnswer(pid, L1);
    await DB.DB.prepare("UPDATE proverb_answers SET status = 'accepted' WHERE id = ?1").bind(old).run();
    const fresh = await seedAnswer(pid, L2);

    await saveProverbReview(DB, "rev@example.org", { proverbId: pid, acceptAnswerId: fresh, finalPaite: "New line." });
    const p = await saying(pid);
    expect(p.paite).toBe("New line.");
    expect(p.status).toBe("live");
    expect(await answerStatus(fresh)).toBe("accepted");
    // The line it replaced is still on record as an accepted alternative.
    expect(await answerStatus(old)).toBe("accepted");
  });

  it("corrects the published line in place", async () => {
    const pid = await seedSaying(ENGLISH, "live", L1);
    await DB.DB.prepare("UPDATE proverbs SET accepting_more = 1 WHERE id = ?1").bind(pid).run();

    expect(await saveProverbReview(DB, "rev@example.org", { proverbId: pid, acceptPublished: true, finalPaite: "Fixed line." })).toBe("ok");
    expect((await saying(pid)).paite).toBe("Fixed line.");
    expect((await saying(pid)).status).toBe("live");
  });
});

describe("undo, skip and whole sayings", () => {
  it("undoes a publish and puts the saying back", async () => {
    const pid = await seedSaying(ENGLISH);
    const aid = await seedAnswer(pid, L1);

    await saveProverbReview(DB, "rev@example.org", { proverbId: pid, acceptAnswerId: aid, finalPaite: L1 });
    expect((await saying(pid)).status).toBe("live");

    expect(await undoProverbReview(DB, "rev@example.org", pid)).toBe(true);
    const p = await saying(pid);
    expect(p.status).toBe("open");
    expect(p.paite).toBeNull();
    expect(await answerStatus(aid)).toBe("new");
  });

  it("has nothing to undo for a stranger", async () => {
    const pid = await seedSaying(ENGLISH);
    expect(await undoProverbReview(DB, "stranger@example.org", pid)).toBe(false);
  });

  it("skips a saying out of one reviewer's queue only", async () => {
    const pid = await seedSaying(ENGLISH);
    await seedAnswer(pid, L1);
    const now = Date.now();

    expect((await getProverbReviewList(DB, "one@example.org", now)).answers.length).toBe(1);
    expect(await skipProverbSaying(DB, "one@example.org", pid, now)).toBe(true);
    expect((await getProverbReviewList(DB, "one@example.org", now + 60_000)).answers.length).toBe(0);
    expect((await getProverbReviewList(DB, "two@example.org", now + 60_000)).answers.length).toBe(1);
    expect((await getProverbReviewList(DB, "one@example.org", now + 2 * 60 * 60 * 1000 + 60_000)).answers.length).toBe(1);
  });

  it("publishes a whole submitted saying on one accept", async () => {
    const pid = await seedSaying("Strike while the iron is hot", "pending", L2);
    expect(await decideProverbPair(DB, "rev@example.org", pid, true)).toBe("ok");
    expect((await saying(pid)).status).toBe("live");
  });
});
