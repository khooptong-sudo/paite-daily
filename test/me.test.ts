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
    expect(await r.json()).toEqual({ total: 3, verified: 2, words: 0, badge: null });
  });
});
