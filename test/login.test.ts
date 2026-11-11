import { env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { call, fakeDeps, NOW } from "./helpers";
import { COOKIE, createPasswordLink, LINK_MS, SESSION_MS, setPassword, verifyReviewer } from "../src/login";

const saved = { a: env.ALERT_EMAIL };
afterEach(() => { env.ALERT_EMAIL = saved.a; vi.restoreAllMocks(); });

// The real session check, on a clock the test controls.
const at = (now = NOW) => fakeDeps({ verifyReviewer: (req, e) => verifyReviewer(req, e, now), now: () => now });
const post = (path: string, body: unknown, init: { cookie?: string; ip?: string; origin?: string; now?: number } = {}) => {
  const headers: Record<string, string> = { "CF-Connecting-IP": init.ip ?? "1.1.1.1" };
  if (init.cookie) headers.Cookie = init.cookie;
  if (init.origin) headers.Origin = init.origin;
  return call(path, { method: "POST", headers, body: JSON.stringify(body) }, at(init.now));
};
const get = (path: string, cookie?: string, now = NOW) => call(path, cookie ? { headers: { Cookie: cookie } } : {}, at(now));
const cookieOf = (r: Response) => (r.headers.get("Set-Cookie") ?? "").split(";")[0];
const bind = () => { const send = vi.fn(async (_m: unknown) => ({})); env.ALERT_EMAIL = { send } as unknown as SendEmail; return send; };
const tokenIn = (link: string) => link.split("#set=")[1];
const REV = "rev@example.org";
const PW = "correct horse battery";
const login = (email = REV, password = PW, init: Parameters<typeof post>[2] = {}) => post("/review/api/login", { email, password }, init);

describe("sign in", () => {
  it("gives a session cookie for the right password, and the cookie opens the review API", async () => {
    await setPassword(env, REV, PW, NOW);
    const r = await login(" Rev@Example.org ");
    expect(r.status).toBe(200);
    const set = r.headers.get("Set-Cookie")!;
    expect(set).toMatch(new RegExp(`^${COOKIE}=[0-9a-f]{64}; Path=/; Max-Age=${SESSION_MS / 1000}; HttpOnly; Secure; SameSite=Strict$`));
    const me = await get("/review/api/me", cookieOf(r));
    expect(me.status).toBe(200);
    expect((await me.json<{ name: string }>()).name).toBe("Rev One");
  });

  it("stores neither the password nor the session token", async () => {
    await setPassword(env, REV, PW, NOW);
    const token = cookieOf(await login()).split("=")[1];
    const p = await env.DB.prepare("SELECT hash, salt FROM reviewer_passwords").first<{ hash: string; salt: string }>();
    expect(p!.hash).not.toContain(PW);
    expect(p!.salt).toMatch(/^[0-9a-f]{32}$/);
    const s = await env.DB.prepare("SELECT token_hash FROM reviewer_sessions").first<{ token_hash: string }>();
    expect(s!.token_hash).not.toBe(token);
  });

  it("answers 401 the same way for a wrong password, an unknown email and an email with no password", async () => {
    await setPassword(env, REV, PW, NOW);
    for (const [e, p] of [[REV, "wrong password"], ["nobody@example.org", PW], ["owner@example.org", PW]]) {
      const r = await login(e, p);
      expect(r.status, e).toBe(401);
      expect(await r.json()).toEqual({ error: "bad_login" });
      expect(r.headers.get("Set-Cookie")).toBeNull();
    }
  });

  it("refuses a right password for someone who is no longer a reviewer, and ends their session", async () => {
    await env.DB.prepare("INSERT INTO reviewers (email, name, added_by) VALUES ('dee@x.org', 'Dee', 'o')").run();
    await setPassword(env, "dee@x.org", PW, NOW);
    const c = cookieOf(await login("dee@x.org"));
    expect((await get("/review/api/me", c)).status).toBe(200);
    await env.DB.prepare("UPDATE reviewers SET removed_at = datetime('now') WHERE email = 'dee@x.org'").run();
    expect((await get("/review/api/me", c)).status).toBe(403);
    expect((await login("dee@x.org")).status).toBe(401);
  });

  it("refuses no cookie, a made-up cookie and an expired session", async () => {
    await setPassword(env, REV, PW, NOW);
    const c = cookieOf(await login());
    expect((await get("/review/api/me")).status).toBe(401);
    expect((await get("/review/api/me", `${COOKIE}=${"a".repeat(64)}`)).status).toBe(401);
    expect((await get("/review/api/me", `${COOKIE}=' OR 1=1 --`)).status).toBe(401);
    expect((await get("/review/api/me", c, NOW + SESSION_MS - 1)).status).toBe(200);
    expect((await get("/review/api/me", c, NOW + SESSION_MS)).status).toBe(401);
  });

  it("locks an email after ten wrong passwords in fifteen minutes, then lets it try again", async () => {
    await setPassword(env, REV, PW, NOW);
    for (let i = 0; i < 10; i++) expect((await login(REV, "nope", { ip: `2.2.2.${i}` })).status).toBe(401);
    expect((await login(REV, PW)).status).toBe(429);
    expect((await login(REV, PW, { now: NOW + 15 * 60_000 + 1 })).status).toBe(200);
  });

  it("slows one address that tries many emails", async () => {
    for (let i = 0; i < 30; i++) expect((await login(`u${i}@x.org`, "nope")).status).toBe(401);
    expect((await login("u99@x.org", "nope")).status).toBe(429);
    expect((await login("u99@x.org", "nope", { ip: "3.3.3.3" })).status).toBe(401);
  });

  it("refuses a POST from another site", async () => {
    await setPassword(env, REV, PW, NOW);
    expect((await login(REV, PW, { origin: "https://evil.example" })).status).toBe(403);
    expect((await login(REV, PW, { origin: "https://paite.lamkalabs.com" })).status).toBe(200);
  });

  it("sign out ends the session on the server", async () => {
    await setPassword(env, REV, PW, NOW);
    const c = cookieOf(await login());
    const out = await post("/review/api/logout", {}, { cookie: c });
    expect(out.headers.get("Set-Cookie")).toContain("Max-Age=0");
    expect((await get("/review/api/me", c)).status).toBe(401);
  });
});

describe("set or reset the password", () => {
  it("emails a one-time link to a reviewer, and says the same to anyone else without sending", async () => {
    const send = bind();
    const a = await post("/review/api/password/link", { email: REV });
    const b = await post("/review/api/password/link", { email: "stranger@example.org" });
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(await a.json()).toEqual(await b.json());
    expect(send).toHaveBeenCalledTimes(1);
    const m = send.mock.calls[0][0] as { to: string; text: string };
    expect(m.to).toBe(REV);
    expect(m.text).toMatch(/https:\/\/paite\.lamkalabs\.com\/review\/login#set=[0-9a-f]{64}/);
  });

  it("the link sets the password, signs in, works once, and signs out other devices", async () => {
    await setPassword(env, REV, "the old password", NOW);
    const old = cookieOf(await login(REV, "the old password"));
    const token = tokenIn(await createPasswordLink(env, REV, NOW));
    const r = await post("/review/api/password/set", { token, password: PW });
    expect(r.status).toBe(200);
    expect((await get("/review/api/me", cookieOf(r))).status).toBe(200);
    expect((await get("/review/api/me", old)).status).toBe(401);
    expect((await login(REV, "the old password")).status).toBe(401);
    expect((await login()).status).toBe(200);
    expect((await post("/review/api/password/set", { token, password: "another password" })).status).toBe(400);
    expect((await login()).status).toBe(200);
  });

  it("an owner with no reviewer row can set a password", async () => {
    const send = bind();
    const saveR = env.REVIEWERS; env.REVIEWERS = "{}";
    try {
      expect((await post("/review/api/password/link", { email: "owner@example.org" })).status).toBe(200);
      const token = tokenIn((send.mock.calls[0][0] as { text: string }).text.match(/https:\S+/)![0]);
      const r = await post("/review/api/password/set", { token, password: PW });
      expect((await (await get("/review/api/me", cookieOf(r))).json<{ owner: boolean }>()).owner).toBe(true);
    } finally { env.REVIEWERS = saveR; }
  });

  it("refuses an expired link, an unknown link, a short password, and a link for a removed reviewer", async () => {
    const token = tokenIn(await createPasswordLink(env, REV, NOW));
    expect((await post("/review/api/password/set", { token, password: PW }, { now: NOW + LINK_MS })).status).toBe(400);
    expect((await post("/review/api/password/set", { token: "b".repeat(64), password: PW })).status).toBe(400);
    const short = await post("/review/api/password/set", { token, password: "1234567" });
    expect(await short.json()).toEqual({ error: "weak_password", min: 8 });
    // The short password did not spend the link.
    expect((await post("/review/api/password/set", { token, password: PW })).status).toBe(200);

    await env.DB.prepare("INSERT INTO reviewers (email, name, added_by) VALUES ('dee@x.org', 'Dee', 'o')").run();
    const t2 = tokenIn(await createPasswordLink(env, "dee@x.org", NOW));
    await env.DB.prepare("UPDATE reviewers SET removed_at = datetime('now') WHERE email = 'dee@x.org'").run();
    expect((await post("/review/api/password/set", { token: t2, password: PW })).status).toBe(400);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM reviewer_passwords WHERE email = 'dee@x.org'").first<{ n: number }>())!.n).toBe(0);
  });

  it("sends at most three links to one email in fifteen minutes", async () => {
    const send = bind();
    for (let i = 0; i < 3; i++) expect((await post("/review/api/password/link", { email: REV }, { ip: `4.4.4.${i}` })).status).toBe(200);
    expect((await post("/review/api/password/link", { email: REV })).status).toBe(429);
    expect(send).toHaveBeenCalledTimes(3);
  });

  it("a new password clears the lock from wrong tries", async () => {
    await setPassword(env, REV, "the old password", NOW);
    for (let i = 0; i < 10; i++) await login(REV, "nope", { ip: `5.5.5.${i}` });
    expect((await login(REV, "the old password")).status).toBe(429);
    await post("/review/api/password/set", { token: tokenIn(await createPasswordLink(env, REV, NOW)), password: PW });
    expect((await login()).status).toBe(200);
  });
});
