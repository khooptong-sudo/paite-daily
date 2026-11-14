import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/index";
import index from "../public/index.html?raw";
import chatJs from "../public/chat.js?raw";
import strings from "../public/strings.js?raw";
import { call, fakeDeps } from "./helpers";

const mode = async (deps = fakeDeps()) => {
  const r = await call("/api/ask/mode", {}, deps);
  return { r, b: await r.json() };
};

describe("ask mode", () => {
  it("1. signed out, WIKI_PUBLIC unset: null, no-store", async () => {
    const { r, b } = await mode();
    expect(r.status).toBe(200);
    expect(b).toEqual({ mode: null });
    expect(r.headers.get("cache-control")).toBe("no-store");
  });
  it("2. a reviewer gets review", async () => {
    expect((await mode(fakeDeps({ verifyReviewer: async () => "rev@example.org" }))).b).toEqual({ mode: "review" });
  });
  it("3. a signed-in non-reviewer gets null", async () => {
    expect((await mode(fakeDeps({ verifyReviewer: async () => "nobody@example.org" }))).b).toEqual({ mode: null });
  });
  it("4. WIKI_PUBLIC 1 gives public", async () => {
    const r = await createApp(fakeDeps())(new Request("https://paite.lamkalabs.com/api/ask/mode"), { ...env, WIKI_PUBLIC: "1" });
    expect(await r.json()).toEqual({ mode: "public" });
  });
  it("5. the switch is in the page, hidden", () => {
    expect(index).toMatch(/id="chat-modes"[^>]*\bhidden\b/);
    expect(index).toContain("Tongdot | Tongsan");
  });
  it("6. chat.js uses the endpoints and no innerHTML", () => {
    for (const s of ["/api/ask/mode", "/review/api/ask", "/api/ask/flag"]) expect(chatJs).toContain(s);
    expect(chatJs).not.toMatch(/innerHTML|insertAdjacentHTML|outerHTML/);
  });
  it("7. new labels carry no Paite but the mode name", () => {
    const keys = [...strings.matchAll(/^\s*(ask\w+): \{ pai: "([^"]*)"/gm)].filter((m) => m[1] !== "askName" && m[1] !== "askHelp");
    expect(keys.length).toBe(17);
    for (const [, k, pai] of keys) expect(pai).toBe(k === "askMode" ? "Tongdot | Tongsan" : "");
  });
});
