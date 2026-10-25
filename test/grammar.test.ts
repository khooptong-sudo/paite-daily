import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { checkGrammar, PER_MINUTE } from "../src/grammar";
import { call, fakeDeps, NOW, PHONE_A, session } from "./helpers";

const KEYED = { ...env, DEEPSEEK_API_KEY: "test-key" };
const model = (fixed: unknown) => (async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ fixed }) } }] }))) as unknown as typeof fetch;
const ask = (text: unknown, fetcher: typeof fetch, now = NOW) => checkGrammar(KEYED, PHONE_A, { text }, now, fetcher);

describe("Check English", () => {
  it("suggests the corrected line and says whether it changed", async () => {
    expect(await (await ask("My brother play with his friends", model("My brother plays with his friends."))).json())
      .toEqual({ suggestion: "My brother plays with his friends.", changed: true });
    expect(await (await ask("All good.", model("All good."))).json()).toEqual({ suggestion: "All good.", changed: false });
  });

  it("refuses an empty line, and a reply that rewrote instead of corrected", async () => {
    expect((await ask("   ", model("x"))).status).toBe(400);
    expect((await ask("Hi.", model("Hello there, my dear friend, how are you doing on this fine day?"))).status).toBe(503);
    expect((await ask("Hi.", (async () => new Response("nope", { status: 500 })) as unknown as typeof fetch)).status).toBe(503);
  });

  it("holds one person to a few checks a minute", async () => {
    for (let i = 0; i < PER_MINUTE; i++) expect((await ask("Hi.", model("Hi."))).status).toBe(200);
    expect((await ask("Hi.", model("Hi."))).status).toBe(429);
    expect((await ask("Hi.", model("Hi."), NOW + 61_000)).status).toBe(200);
  });

  it("needs a contributor session or a reviewer, and a key", async () => {
    const body = JSON.stringify({ text: "Hi." });
    expect((await call("/api/grammar", { method: "POST", body })).status).toBe(401);
    expect((await call("/api/grammar", { method: "POST", body, session: await session(PHONE_A) })).status).toBe(503);
    expect((await call("/review/api/grammar", { method: "POST", body })).status).toBe(401);
    expect((await call("/review/api/grammar", { method: "POST", body }, fakeDeps({ verifyAccess: async () => "rev@example.org" }))).status).toBe(503);
  });
});
