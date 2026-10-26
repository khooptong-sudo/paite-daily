import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { addSentences, call, PHONE_A, PHONE_B, PHONE_C, session } from "./helpers";

const next = async (phone: string, s?: number) => (await call(`/api/next${s ? `?s=${s}` : ""}`, { session: await session(phone) })).json() as Promise<any>;
const answer = async (phone: string, sentenceId: number) =>
  call("/api/answer", { method: "POST", session: await session(phone), body: JSON.stringify({ sentenceId, paite: "Ka dam e.", register: "both" }) });

describe("Ask a relative, version 2", () => {
  it("opens the exact sentence that was shared", async () => {
    const ids = await addSentences("One.", "Two.", "Three.", "Four.");
    expect(await next(PHONE_A, ids[2])).toEqual({ id: ids[2], english: "Three.", shared: true });
  });

  it("falls back to another sentence, marked, when the shared one is full or already seen", async () => {
    const [full, other] = await addSentences("Full one.", "Another.");
    await answer(PHONE_A, full); await answer(PHONE_B, full);
    expect(await next(PHONE_C, full)).toMatchObject({ id: other, sharedGone: true });
    await answer(PHONE_C, other);
    await env.DB.prepare("UPDATE sentences SET status = 'open', answer_count = 1 WHERE id = ?1").bind(other).run();
    const [third] = await addSentences("Third.");
    expect(await next(PHONE_C, other)).toMatchObject({ id: third, sharedGone: true });
  });

  it("ignores a bad id and serves as usual", async () => {
    const [only] = await addSentences("Only.");
    expect(await next(PHONE_A)).toEqual({ id: only, english: "Only." });
    expect((await call("/api/next?s=abc", { session: await session(PHONE_A) })).status).toBe(200);
  });
});
