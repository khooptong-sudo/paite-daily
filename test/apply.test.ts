import { env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { call, fakeDeps, NOW } from "./helpers";
import { reviewerName } from "../src/access";
import { runDigest } from "../src/digest";

const saved = { o: env.OWNER_EMAIL, r: env.REVIEWERS, a: env.ALERT_EMAIL };
afterEach(() => { env.OWNER_EMAIL = saved.o; env.REVIEWERS = saved.r; env.ALERT_EMAIL = saved.a; vi.restoreAllMocks(); });

const as = (email: string | null) => fakeDeps({ verifyAccess: async () => email, now: () => NOW });
const rev = (path: string, body?: unknown, email: string | null = "rev@example.org") =>
  call(path, body === undefined ? {} : { method: "POST", body: JSON.stringify(body) }, as(email));
const OWNER = "owner@example.org";
const apply = (body: Record<string, unknown>, deps = fakeDeps(), ip = "1.1.1.1") =>
  call("/api/apply", { method: "POST", headers: { "CF-Connecting-IP": ip }, body: JSON.stringify({ name: "Ann", email: "ann@x.org", turnstileToken: "t", ...body }) }, deps);
const bind = () => { const send = vi.fn(async (_m: unknown) => ({})); env.ALERT_EMAIL = { send } as unknown as SendEmail; return send; };
const addDb = (email: string, name = "Dee") => env.DB.prepare("INSERT OR IGNORE INTO reviewers (email, name, added_by) VALUES (?1, ?2, 'o')").bind(email, name).run();
const pending = () => env.DB.prepare("SELECT id FROM reviewer_applications WHERE status = 'pending'").all<{ id: number }>();
const count = async (t: string) => (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${t}`).first<{ n: number }>())!.n;

describe("non-reviewer with a valid Access identity", () => {
  it("gets 403 on every review endpoint", async () => {
    const me = "stranger@example.org";
    const cases: [string, unknown?][] = [
      ["/review/api/next"], ["/review/api/queue"], ["/review/api/glossary"], ["/review/api/health"], ["/review/api/me"], ["/review/api/applications"], ["/review/api/reviewers"],
      ["/review/api/decide", { sentenceId: 1, decision: "reject", answerIds: [] }], ["/review/api/undo", { reviewId: 1 }], ["/review/api/glossary/hide", { id: 1 }],
      ["/review/api/link-phone", { phoneId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }],
      ["/review/api/applications/decide", { id: 1, decision: "approve" }], ["/review/api/reviewers/remove", { email: "rev@example.org" }],
    ];
    for (const [p, b] of cases) expect((await rev(p, b, me)).status, p).toBe(403);
    expect(await count("reviewer_phones")).toBe(0);
  });
});

describe("non-owner reviewer", () => {
  it("gets 403 on application and reviewer management", async () => {
    await env.DB.prepare("INSERT INTO reviewer_applications (name, email) VALUES ('A', 'a@x.org')").run();
    const cases: [string, unknown?][] = [["/review/api/applications"], ["/review/api/reviewers"], ["/review/api/applications/decide", { id: 1, decision: "approve" }], ["/review/api/reviewers/remove", { email: "rev@example.org" }]];
    for (const [p, b] of cases) expect((await rev(p, b)).status, p).toBe(403);
    expect((await pending()).results).toHaveLength(1);
    expect(await count("reviewers")).toBe(0);
  });
});

describe("reviewer lookup", () => {
  it("removed DB reviewer is refused immediately", async () => {
    await addDb("dee@x.org");
    expect((await rev("/review/api/me", undefined, "DEE@x.org")).status).toBe(200);
    expect((await rev("/review/api/reviewers/remove", { email: "dee@x.org" }, OWNER)).status).toBe(200);
    expect((await rev("/review/api/me", undefined, "dee@x.org")).status).toBe(403);
    expect((await rev("/review/api/next", undefined, "dee@x.org")).status).toBe(403);
  });
  it("DB name wins over the secret; a removed DB reviewer who is also in the secret stays a reviewer", async () => {
    await addDb("rev@example.org", "Db Name");
    expect(await reviewerName(env, "rev@example.org")).toBe("Db Name");
    await rev("/review/api/reviewers/remove", { email: "rev@example.org" }, OWNER);
    expect(await reviewerName(env, "rev@example.org")).toBe("Rev One");
  });
  it("owner cannot be removed, secret-only entry cannot be removed", async () => {
    expect((await rev("/review/api/reviewers/remove", { email: "Owner@example.org" }, OWNER)).status).toBe(400);
    const s = await rev("/review/api/reviewers/remove", { email: "rev@example.org" }, OWNER);
    expect(s.status).toBe(400);
    expect((await s.json<{ message: string }>()).message).toContain("secret");
    await env.DB.prepare("INSERT INTO reviewers (email, name, added_by, removed_at) VALUES ('owner@example.org', 'O', 'o', datetime('now'))").run();
    expect(await reviewerName(env, OWNER)).not.toBeNull();
  });
  it("a bad REVIEWERS secret locks out nobody who is a DB reviewer or owner", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await addDb("dee@x.org");
    for (const bad of ["not json", "[]", "null", "\"x\""]) {
      env.REVIEWERS = bad;
      expect((await rev("/review/api/me", undefined, "dee@x.org")).status, bad).toBe(200);
      expect((await rev("/review/api/me", undefined, OWNER)).status, bad).toBe(200);
      expect((await rev("/review/api/me", undefined, "rev@example.org")).status, bad).toBe(403);
    }
  });
  it("reviewer list and digest include DB reviewers", async () => {
    await addDb("dee@x.org");
    const list = await (await rev("/review/api/reviewers", undefined, OWNER)).json<{ reviewers: { email: string; source: string }[] }>();
    expect(list.reviewers.map((r) => [r.email, r.source]).sort()).toEqual([["dee@x.org", "db"], ["owner@example.org", "owner"], ["rev@example.org", "secret"]]);
    const send = bind();
    await env.DB.prepare("INSERT INTO sentences (id, english, english_key, source) VALUES (1, 'a', 'a', 't')").run();
    await env.DB.prepare("INSERT INTO answers (sentence_id, phone_id, paite, register) VALUES (1, 'p', 'x', 'both')").run();
    await runDigest(env);
    expect(send.mock.calls.map((c) => (c[0] as { to: string }).to).sort()).toEqual(["dee@x.org", "owner@example.org", "rev@example.org"]);
    env.REVIEWERS = "{}";
    send.mockClear();
    await runDigest(env);
    expect(send.mock.calls.map((c) => (c[0] as { to: string }).to)).toEqual(["dee@x.org"]);
  });
});

describe("/api/apply", () => {
  it("Turnstile failure is 403 and stores nothing", async () => {
    expect((await apply({}, fakeDeps({ verifyTurnstile: async () => false }))).status).toBe(403);
    expect(await count("reviewer_applications")).toBe(0);
  });
  it("validates input", async () => {
    const bad = [{ name: "" }, { name: "x".repeat(81) }, { email: "nope" }, { email: "a@b" }, { email: "a b@c.org" }, { email: "a@b.org,c@d.org" }, { note: "x".repeat(301) }, { name: 5 }];
    for (const b of bad) expect((await apply(b)).status, JSON.stringify(b)).toBe(400);
  });
  it("stores a lowercased application, emails the owners once, duplicates and reviewers get the same 200", async () => {
    const send = bind();
    env.OWNER_EMAIL = "owner@example.org, b@example.org";
    const r = await apply({ name: "Ann\r\nBcc: evil@x.org", email: "Ann@X.org", note: "hi" });
    const body = await r.text();
    expect(r.status).toBe(200);
    expect(send).toHaveBeenCalledTimes(1);
    const m = send.mock.calls[0][0] as { to: string[]; subject: string; text: string };
    expect(m.to).toEqual(["owner@example.org", "b@example.org"]);
    expect(m.subject).not.toMatch(/[\r\n]/);
    expect(m.text).toContain("ann@x.org");
    expect(m.text).toContain("https://paite.lamkalabs.com/review");
    expect(await (await apply({ email: "ANN@x.org" })).text()).toBe(body);
    expect(await (await apply({ email: "rev@example.org" })).text()).toBe(body);
    expect(send).toHaveBeenCalledTimes(1);
    expect((await pending()).results).toHaveLength(1);
  });
  it("works without the ALERT_EMAIL binding", async () => {
    env.ALERT_EMAIL = undefined;
    expect((await apply({})).status).toBe(200);
  });
  it("rate limits to 5 per IP per day and stores no raw IP", async () => {
    for (let i = 0; i < 5; i++) expect((await apply({ email: `u${i}@x.org` }, fakeDeps(), "9.9.9.9")).status).toBe(200);
    expect((await apply({ email: "new@x.org" }, fakeDeps(), "9.9.9.9")).status).toBe(429);
    expect((await apply({ email: "u1@x.org" }, fakeDeps(), "9.9.9.9")).status).toBe(429);
    expect((await apply({ email: "other@x.org" }, fakeDeps(), "8.8.8.8")).status).toBe(200);
    const rows = await env.DB.prepare("SELECT * FROM reviewer_applications").all();
    expect(JSON.stringify(rows.results)).not.toContain("9.9.9.9");
  });
  it("no email or note appears in public responses or pages", async () => {
    await apply({ name: "Zed", email: "secret-person@x.org", note: "private-note-text" });
    for (const p of ["/contributors", "/glossary", "/api/contributors", "/api/goal"]) {
      const t = await (await call(p)).text();
      expect(t, p).not.toContain("secret-person@x.org");
      expect(t, p).not.toContain("private-note-text");
    }
    expect(await (await apply({ email: "secret-person@x.org" })).text()).not.toContain("secret");
  });
  it("contributors page has the form and the Turnstile site key attribute", async () => {
    const t = await (await call("/contributors")).text();
    expect(t).toContain("id=\"apply\"");
    expect(t).toContain("data-sitekey=\"");
  });
});

describe("owner tools", () => {
  const mk = async (email = "new@x.org", name = "Newbie") => (await env.DB.prepare("INSERT INTO reviewer_applications (name, email) VALUES (?1, ?2) RETURNING id").bind(name, email).first<{ id: number }>())!.id;
  it("lists pending, approves (reviewer row, email), then the applicant is a reviewer", async () => {
    const send = bind();
    const id = await mk();
    const l = await (await rev("/review/api/applications", undefined, OWNER)).json<{ applications: { id: number }[] }>();
    expect(l.applications.map((a) => a.id)).toEqual([id]);
    expect((await rev("/review/api/applications/decide", { id, decision: "approve" }, OWNER)).status).toBe(200);
    expect(await reviewerName(env, "new@x.org")).toBe("Newbie");
    const m = send.mock.calls[0][0] as { to: string; subject: string; text: string };
    expect([m.to, m.subject]).toEqual(["new@x.org", "You are now a Paite Daily reviewer"]);
    expect(m.text).toContain("6-digit code");
    expect((await rev("/review/api/applications/decide", { id, decision: "approve" }, OWNER)).status).toBe(404);
    expect((await rev("/review/api/me", undefined, "new@x.org")).status).toBe(200);
  });
  it("approving clears removed_at; decline sends no email", async () => {
    const send = bind();
    await addDb("new@x.org", "Old");
    await rev("/review/api/reviewers/remove", { email: "new@x.org" }, OWNER);
    expect(await reviewerName(env, "new@x.org")).toBeNull();
    await rev("/review/api/applications/decide", { id: await mk(), decision: "approve" }, OWNER);
    expect(await reviewerName(env, "new@x.org")).toBe("Newbie");
    send.mockClear();
    const id = await mk("no@x.org");
    expect((await rev("/review/api/applications/decide", { id, decision: "decline" }, OWNER)).status).toBe(200);
    expect(send).not.toHaveBeenCalled();
    expect(await reviewerName(env, "no@x.org")).toBeNull();
    expect((await rev("/review/api/applications/decide", { id: "x", decision: "approve" }, OWNER)).status).toBe(400);
  });
});
