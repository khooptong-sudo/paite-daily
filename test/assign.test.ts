import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { readSession, signSession } from "../src/session";
import { addSentences, call, fakeDeps, NOW, PHONE_A, session } from "./helpers";

describe("session", () => {
  it("issues a session after Turnstile passes", async () => {
    const r = await call("/api/session", { method: "POST", body: JSON.stringify({ phoneId: PHONE_A, turnstileToken: "t" }) });
    expect(r.status).toBe(200);
    const { session: token } = await r.json<{ session: string }>();
    expect(await readSession(token, NOW, env.SESSION_SECRET)).toBe(PHONE_A);
  });

  it("refuses a session when Turnstile fails", async () => {
    const deps = fakeDeps({ verifyTurnstile: async () => false });
    const r = await call("/api/session", { method: "POST", body: JSON.stringify({ phoneId: PHONE_A, turnstileToken: "t" }) }, deps);
    expect(r.status).toBe(403);
  });

  it("rejects a tampered or expired session", async () => {
    const good = await signSession(PHONE_A, NOW + 1000, env.SESSION_SECRET);
    expect(await readSession(good.slice(0, -2) + "xx", NOW, env.SESSION_SECRET)).toBeNull();
    expect(await readSession(good, NOW + 2000, env.SESSION_SECRET)).toBeNull();
    expect((await call("/api/next")).status).toBe(401);
  });
});

describe("assignment", () => {
  it("empty pool returns 204", async () => {
    const r = await call("/api/next", { session: await session(PHONE_A) });
    expect(r.status).toBe(204);
  });

  it("never returns a skipped sentence to the same phone", async () => {
    const [a, b] = await addSentences("Good morning.", "I am hungry.");
    const s = await session(PHONE_A);
    await call("/api/skip", { method: "POST", session: s, body: JSON.stringify({ sentenceId: a }) });
    for (let i = 0; i < 10; i++) {
      const r = await call("/api/next", { session: s });
      expect((await r.json<{ id: number }>()).id).toBe(b);
    }
  });

  it("never returns a full, verified or retired sentence", async () => {
    const [full, verified, retired, open] = await addSentences("One.", "Two.", "Three.", "Four.");
    await env.DB.batch([
      env.DB.prepare("UPDATE sentences SET status = 'full', answer_count = 2 WHERE id = ?1").bind(full),
      env.DB.prepare("UPDATE sentences SET status = 'verified' WHERE id = ?1").bind(verified),
      env.DB.prepare("UPDATE sentences SET status = 'retired' WHERE id = ?1").bind(retired),
    ]);
    const s = await session(PHONE_A);
    for (let i = 0; i < 10; i++) {
      expect((await (await call("/api/next", { session: s })).json<{ id: number }>()).id).toBe(open);
    }
  });
});
