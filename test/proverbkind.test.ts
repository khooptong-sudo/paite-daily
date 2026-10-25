import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { call, fakeDeps } from "./helpers";

const REV = fakeDeps({ verifyAccess: async () => "rev@example.org" });
const kind = (body: unknown, deps = REV) => call("/review/api/proverbs/kind", { method: "POST", body: JSON.stringify(body) }, deps);

describe("POST /review/api/proverbs/kind", () => {
  it("lets a reviewer turn a proverb into an idiom and back", async () => {
    const p = await env.DB.prepare("INSERT INTO proverbs (kind, paite, english, entered_from, status, source) VALUES ('proverb', 'x', 'Break a leg.', 'pai2en', 'pending', 'contributed') RETURNING id").first<{ id: number }>();
    expect((await kind({ proverbId: p!.id, kind: "idiom" })).status).toBe(200);
    expect(await env.DB.prepare("SELECT kind FROM proverbs").first()).toEqual({ kind: "idiom" });
    expect((await kind({ proverbId: p!.id, kind: "proverb" })).status).toBe(200);
    expect(await env.DB.prepare("SELECT kind FROM proverbs").first()).toEqual({ kind: "proverb" });
  });

  it("refuses strangers, unknown kinds and missing sayings", async () => {
    expect((await kind({ proverbId: 1, kind: "idiom" }, fakeDeps())).status).toBe(401);
    expect((await kind({ proverbId: 1, kind: "riddle" })).status).toBe(400);
    expect((await kind({ proverbId: 999, kind: "idiom" })).status).toBe(404);
  });
});
