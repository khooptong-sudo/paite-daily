import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { addSentences, call, PHONE_A, PHONE_B, session } from "./helpers";

describe("/api/me", () => {
  it("401 without a session", async () => {
    expect((await call("/api/me")).status).toBe(401);
  });

  it("counts total and reviewer-accepted answers for this phone only", async () => {
    const ids = await addSentences("One.", "Two.", "Three.");
    for (const id of ids) {
      await env.DB.prepare("INSERT INTO answers (sentence_id, phone_id, paite, register) VALUES (?1, ?2, 'x', 'both')").bind(id, PHONE_A).run();
    }
    await env.DB.prepare("INSERT INTO answers (sentence_id, phone_id, paite, register) VALUES (?1, ?2, 'y', 'both')").bind(ids[0], PHONE_B).run();
    await env.DB.prepare("UPDATE answers SET status = 'accepted' WHERE phone_id = ?1 AND sentence_id = ?2").bind(PHONE_A, ids[0]).run();
    await env.DB.prepare("UPDATE answers SET status = 'also_correct' WHERE phone_id = ?1 AND sentence_id = ?2").bind(PHONE_A, ids[1]).run();
    await env.DB.prepare("UPDATE answers SET status = 'rejected' WHERE phone_id = ?1 AND sentence_id = ?2").bind(PHONE_A, ids[2]).run();
    const r = await call("/api/me", { session: await session(PHONE_A) });
    expect(await r.json()).toEqual({ total: 3, verified: 2, words: 0, meanings: 0, sayings: 0, recordings: 0, badge: null, streak: 0 });
  });


  it("counts each section apart: words, meanings and sayings", async () => {
    await env.DB.prepare("INSERT INTO word_submissions (paite, english, phone_id) VALUES ('Tui', 'Water', ?1), ('Mei', 'Fire', ?1), ('Ni', 'Sun', ?2)").bind(PHONE_A, PHONE_B).run();
    await env.DB.prepare("INSERT INTO word_submissions (paite, english, phone_id, source) VALUES ('Van', 'Sky', ?1, 'meaning')").bind(PHONE_A).run();
    const p = await env.DB.prepare("INSERT INTO proverbs (kind, english, entered_from, status) VALUES ('proverb', 'Haste makes waste.', 'en2pai', 'open') RETURNING id").first<{ id: number }>();
    await env.DB.prepare("INSERT INTO proverb_answers (proverb_id, paite, phone_id) VALUES (?1, 'x', ?2)").bind(p!.id, PHONE_A).run();
    await env.DB.prepare("INSERT INTO proverbs (kind, paite, english, entered_from, status, source, submitted_by) VALUES ('idiom', 'y', 'Break a leg.', 'pai2en', 'pending', 'contributed', ?1)").bind(PHONE_A).run();
    const r = await call("/api/me", { session: await session(PHONE_A) });
    expect(await r.json()).toMatchObject({ total: 0, words: 2, meanings: 1, sayings: 2 });
  });
});

describe("POST /api/name", () => {
  it("needs a session and a name", async () => {
    expect((await call("/api/name", { method: "POST", body: JSON.stringify({ name: "Ann" }) })).status).toBe(401);
    const s = await session(PHONE_A);
    for (const name of ["", "   ", "n".repeat(61), 7]) {
      expect((await call("/api/name", { method: "POST", body: JSON.stringify({ name }), session: s })).status).toBe(400);
    }
  });

  it("names the rows this phone left unnamed, and only its own", async () => {
    const ids = await addSentences("One.", "Two.");
    await call("/api/answer", { method: "POST", session: await session(PHONE_A),
      body: JSON.stringify({ sentenceId: ids[0], paite: "Ka dam hi" }) });
    await call("/api/answer", { method: "POST", session: await session(PHONE_A),
      body: JSON.stringify({ sentenceId: ids[1], paite: "Ka dam hi", name: "Tete" }) });
    await call("/api/answer", { method: "POST", session: await session(PHONE_B),
      body: JSON.stringify({ sentenceId: ids[0], paite: "A hoi hi" }) });
    await call("/api/word", { method: "POST", session: await session(PHONE_A),
      body: JSON.stringify({ paite: "Tui", english: "Water" }) });

    const r = await call("/api/name", { method: "POST", session: await session(PHONE_A), body: JSON.stringify({ name: "Ann" }) });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, stamped: 2 });
    expect(await env.DB.prepare("SELECT contributor_name AS n FROM answers WHERE phone_id = ?1 AND sentence_id = ?2").bind(PHONE_A, ids[0]).first()).toEqual({ n: "Ann" });
    expect(await env.DB.prepare("SELECT contributor_name AS n FROM word_submissions").first()).toEqual({ n: "Ann" });
    // the other phone stays anonymous, and a name already given is left alone
    expect(await env.DB.prepare("SELECT count(*) AS n FROM answers WHERE contributor_name = 'Tete'").first()).toEqual({ n: 1 });
    expect(await env.DB.prepare("SELECT count(*) AS n FROM answers WHERE contributor_name IS NULL").first()).toEqual({ n: 1 });
  });
});
