import { env } from "cloudflare:test";
import { expect, it } from "vitest";
import { verifyTurnstile } from "../src/turnstile";

const reply = (success: boolean) => async () => new Response(JSON.stringify({ success }), { headers: { "content-type": "application/json" } });

it("passes when siteverify says success", async () => {
  expect(await verifyTurnstile("tok", "1.2.3.4", env, reply(true) as typeof fetch)).toBe(true);
});

it("fails when siteverify says no, errors, or the token is empty", async () => {
  expect(await verifyTurnstile("tok", null, env, reply(false) as typeof fetch)).toBe(false);
  expect(await verifyTurnstile("tok", null, env, (async () => { throw new Error("down"); }) as typeof fetch)).toBe(false);
  expect(await verifyTurnstile("", null, env, reply(true) as typeof fetch)).toBe(false);
});
