import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { errorPage } from "../src/observability";
import { call, fakeDeps, session, PHONE_A } from "./helpers";

const rev = (path: string, init: RequestInit = {}, email = "owner@example.org", deps = fakeDeps({ verifyAccess: async () => email })) =>
  call(path, init, deps);
const post = (path: string, body: unknown) => ({ method: "POST", body: JSON.stringify(body) });

describe("funnel events", () => {
  it("stores a known kind and drops the rest without an error", async () => {
    expect((await call("/api/event", post("/api/event", { kind: "page", path: "/", vid: "abc" }))).status).toBe(204);
    expect((await call("/api/event", post("/api/event", { kind: "page", path: "/glossary?x=1", vid: "abc", ref: "https://x.example/thread" }))).status).toBe(204);
    expect((await call("/api/event", post("/api/event", { kind: "nonsense", vid: "abc" }))).status).toBe(204);
    expect((await call("/api/event", { method: "POST", body: "not json" })).status).toBe(204);
    const rows = await env.DB.prepare("SELECT kind, path, vid, ref, device FROM events ORDER BY id").all();
    expect(rows.results).toEqual([
      { kind: "page", path: "/", vid: "abc", ref: null, device: "desktop" },
      { kind: "page", path: "/glossary", vid: "abc", ref: "x.example", device: "desktop" },
    ]);
  });

  it("counts people per funnel step and reports the drop-off", async () => {
    for (const [kind, vid] of [["page", "a"], ["page", "b"], ["card", "a"], ["card", "b"], ["answer", "a"]] as const) {
      await call("/api/event", post("/api/event", { kind, vid, path: "/" }));
    }
    const r = await rev("/review/api/analytics?days=7");
    expect(r.status).toBe(200);
    const d = await r.json<{ funnel: { kind: string; people: number }[]; dropOff: { kind: string; lost: number; percent: number }[] }>();
    expect(d.funnel).toEqual([{ kind: "page", hits: 2, people: 2 }, { kind: "card", hits: 2, people: 2 }, { kind: "answer", hits: 1, people: 1 }]);
    expect(d.dropOff[1]).toEqual({ kind: "answer", from: 2, lost: 1, percent: 50 });
  });

  it("drops a flood from one tab id", async () => {
    for (let i = 0; i < 62; i++) await call("/api/event", post("/api/event", { kind: "page", vid: "hot" }));
    const r = await env.DB.prepare("SELECT count(*) AS n FROM events WHERE vid = 'hot'").first<{ n: number }>();
    expect(r!.n).toBe(60);
  });

  it("keeps the funnel to the owner", async () => {
    expect((await rev("/review/api/analytics", {}, "rev@example.org")).status).toBe(403);
    expect((await rev("/review/api/errors", {}, "rev@example.org")).status).toBe(403);
  });
});

describe("errors", () => {
  it("answers a thrown API request with JSON, never a stack trace", async () => {
    const deps = fakeDeps({ verifyAccess: async () => { throw new Error("kaboom"); } });
    const r = await rev("/review/api/me", {}, "owner@example.org", deps);
    expect(r.status).toBe(500);
    expect(await r.json()).toEqual({ error: "server_error" });
    const rows = await env.DB.prepare("SELECT route, method, message FROM errors").all();
    expect(rows.results).toEqual([{ route: "/review/api/me", method: "GET", message: "kaboom" }]);
  });

  it("serves the HTML 500 page for a page request, and JSON for an API path", async () => {
    const page = await errorPage(new Request("https://paite.lamkalabs.com/glossary"), fakeDeps() as unknown as Parameters<typeof errorPage>[1]);
    expect(page.status).toBe(500);
    expect(page.headers.get("content-type")).toContain("text/html");
    expect(await page.text()).toContain("Something broke on our side");
    const api = await errorPage(new Request("https://paite.lamkalabs.com/api/next"), fakeDeps() as unknown as Parameters<typeof errorPage>[1]);
    expect(api.status).toBe(500);
    expect(await api.json()).toEqual({ error: "server_error" });
  });

  it("lists the errors for the owner", async () => {
    const deps = fakeDeps({ verifyAccess: async () => { throw new Error("kaboom"); } });
    await call("/review/api/me", {}, deps);
    await call("/review/api/me", {}, deps);
    const r = await rev("/review/api/errors");
    const { errors } = await r.json<{ errors: { message: string; count: number; route: string }[] }>();
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ message: "kaboom", count: 2, route: "/review/api/me" });
  });
});

describe("server input checks", () => {
  it("bounds ids and lists", async () => {
    const deps = fakeDeps({ verifyAccess: async () => "rev@example.org" });
    expect((await rev("/review/api/undo", post("/review/api/undo", { reviewId: 0 }), "rev@example.org", deps)).status).toBe(400);
    expect((await rev("/review/api/undo", post("/review/api/undo", { reviewId: -3 }), "rev@example.org", deps)).status).toBe(400);
    expect((await rev("/review/api/undo", post("/review/api/undo", { reviewId: 2 ** 31 }), "rev@example.org", deps)).status).toBe(400);
    expect((await rev("/review/api/glossary/hide", post("/review/api/glossary/hide", { id: "1" }), "rev@example.org", deps)).status).toBe(400);
    const many = Array.from({ length: 51 }, (_, i) => i + 1);
    expect((await rev("/review/api/decide", post("/review/api/decide", { sentenceId: 1, decision: "reject", answerIds: many }), "rev@example.org", deps)).status).toBe(400);
    expect((await rev("/review/api/decide", post("/review/api/decide", { sentenceId: 1, decision: "accept", answerIds: [1] }), "rev@example.org", deps)).status).toBe(400);
  });

  it("bounds the contributor input", async () => {
    expect((await call("/api/session", post("/api/session", { phoneId: PHONE_A, turnstileToken: "x".repeat(4097) }))).status).toBe(400);
    expect((await call("/api/session", post("/api/session", { phoneId: "nope", turnstileToken: "x" }))).status).toBe(400);
    const s = await session(PHONE_A);
    const asPhone = (path: string, body: unknown) => call(path, { ...post(path, body), session: s });
    expect((await asPhone("/api/skip", { sentenceId: 0 })).status).toBe(400);
    expect((await asPhone("/api/skip", { sentenceId: 1.5 })).status).toBe(400);
    expect((await asPhone("/api/answer", { sentenceId: -1, paite: "Ka dam e.", register: "both" })).status).toBe(400);
    expect((await asPhone("/api/answer", { sentenceId: 1, paite: "Ka dam e.", register: "sideways" })).status).toBe(400);
    expect((await asPhone("/api/answer", { sentenceId: 1, paite: "x".repeat(400), register: "both" })).status).toBe(400);
  });
});
