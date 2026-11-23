import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { forgetAIConfig } from "../src/ai";
import { COMMON, commonIn } from "../src/gaps";
import { cleanPlace } from "../src/places";
import { saveProverbReview } from "../src/proverbcard";
import { decideProverbAnswer, decideProverbPair, undoProverbReview } from "../src/proverbreview";
import type { Env } from "../src/types";
import { call, fakeDeps, NOW } from "./helpers";

const DB = env as unknown as Env;
const REV = "rev@example.org";
const st = async (id: number) => (await DB.DB.prepare("SELECT status, paite FROM proverbs WHERE id = ?1").bind(id).first<{ status: string; paite: string | null }>())!;

const wipe = async () => {
  await DB.DB.batch([DB.DB.prepare("DELETE FROM proverb_reviews"), DB.DB.prepare("DELETE FROM proverb_answers"), DB.DB.prepare("DELETE FROM proverbs")]);
};
beforeEach(wipe);
afterEach(wipe);

describe("P4 proverb undo", () => {
  it("P4-1 undo after a save with an also-correct variant undoes the whole save", async () => {
    const s = await DB.DB.prepare("INSERT INTO proverbs (kind, english, entered_from, status) VALUES ('proverb','Qa idiom one','en2pai','open') RETURNING id").first<{ id: number }>();
    const mk = async (p: string) => (await DB.DB.prepare("INSERT INTO proverb_answers (proverb_id, paite, phone_id) VALUES (?1, ?2, 'ph') RETURNING id").bind(s!.id, p).first<{ id: number }>())!.id;
    const a1 = await mk("Aaa bbb ccc");
    const a2 = await mk("Ddd eee fff");
    expect(await saveProverbReview(DB, REV, { proverbId: s!.id, acceptAnswerId: a1, alsoCorrect: [a2] })).toBe("ok");
    expect(await undoProverbReview(DB, REV, s!.id)).toBe(true);
    expect(await st(s!.id)).toEqual({ status: "open", paite: null });
    const rows = await DB.DB.prepare("SELECT status FROM proverb_answers WHERE proverb_id = ?1").bind(s!.id).all<{ status: string }>();
    expect(rows.results.map((r) => r.status)).toEqual(["new", "new"]);
    expect(await undoProverbReview(DB, REV, s!.id)).toBe(false);
  });

  it("P4-2 pair accept then undo withdraws it: pending again with both lines", async () => {
    const s = await DB.DB.prepare("INSERT INTO proverbs (kind, paite, english, entered_from, status) VALUES ('proverb','Pai line a','Eng line a','en2pai','pending') RETURNING id").first<{ id: number }>();
    expect(await decideProverbPair(DB, REV, s!.id, true)).toBe("ok");
    expect(await undoProverbReview(DB, REV, s!.id)).toBe(true);
    expect(await st(s!.id)).toEqual({ status: "pending", paite: "Pai line a" });
  });

  it("P4-3 answer accept then undo returns the saying to open and the answer to new", async () => {
    const s = await DB.DB.prepare("INSERT INTO proverbs (kind, english, entered_from, status) VALUES ('proverb','Eng line b','en2pai','open') RETURNING id").first<{ id: number }>();
    const a = await DB.DB.prepare("INSERT INTO proverb_answers (proverb_id, paite, phone_id) VALUES (?1,'Pai line b','ph') RETURNING id").bind(s!.id).first<{ id: number }>();
    expect(await decideProverbAnswer(DB, REV, a!.id, true)).toBe("ok");
    expect(await undoProverbReview(DB, REV, s!.id)).toBe(true);
    expect(await st(s!.id)).toEqual({ status: "open", paite: null });
    expect((await DB.DB.prepare("SELECT status FROM proverb_answers WHERE id = ?1").bind(a!.id).first<{ status: string }>())!.status).toBe("new");
  });

  it("P4-4 pair accept that copies another saying is a duplicate and writes no review row", async () => {
    await DB.DB.prepare("INSERT INTO proverbs (kind, paite, english, entered_from, status) VALUES ('proverb','Taken line','Eng taken','pai2en','live')").run();
    const s = await DB.DB.prepare("INSERT INTO proverbs (kind, paite, english, entered_from, status) VALUES ('proverb','Other line','Eng other','en2pai','pending') RETURNING id").first<{ id: number }>();
    expect(await decideProverbPair(DB, REV, s!.id, true, { finalPaite: "taken LINE" })).toBe("duplicate");
    expect((await DB.DB.prepare("SELECT count(*) AS n FROM proverb_reviews WHERE proverb_id = ?1").bind(s!.id).first<{ n: number }>())!.n).toBe(0);
    expect((await st(s!.id)).status).toBe("pending");
  });

  it("P4-4 the route answers 409 duplicate", async () => {
    await DB.DB.prepare("INSERT INTO proverbs (kind, paite, english, entered_from, status) VALUES ('proverb','Taken line','Eng taken','pai2en','live')").run();
    const s = await DB.DB.prepare("INSERT INTO proverbs (kind, paite, english, entered_from, status) VALUES ('proverb','Other line','Eng other','en2pai','pending') RETURNING id").first<{ id: number }>();
    const r = await call("/review/api/proverbs/pair", { method: "POST", body: JSON.stringify({ id: s!.id, accept: true, finalPaite: "Taken line" }) }, fakeDeps({ verifyReviewer: async () => "owner@example.org" }));
    expect(r.status).toBe(409);
  });
});

describe("P1 reviewer routes", () => {
  it("P1-01 a null JSON body is 400, not 500", async () => {
    const r = await call("/review/api/skip", { method: "POST", body: "null" }, fakeDeps({ verifyReviewer: async () => "rev@example.org" }));
    expect(r.status).toBe(400);
  });

  it("P1-02 a removed reviewer loses access even if the REVIEWERS secret lists them", async () => {
    await env.DB.prepare("INSERT INTO reviewers (email, name, added_by) VALUES ('rev@example.org', 'Rev DB', 'owner@example.org')").run();
    const owner = fakeDeps({ verifyReviewer: async () => "owner@example.org" });
    const rm = await call("/review/api/reviewers/remove", { method: "POST", body: JSON.stringify({ email: "rev@example.org" }) }, owner);
    expect(rm.status).toBe(200);
    expect(((await rm.json()) as { message: string }).message).toMatch(/REVIEWERS secret/);
    const me = await call("/review/api/me", {}, fakeDeps({ verifyReviewer: async () => "rev@example.org" }));
    expect(me.status).toBe(403);
    const list = await call("/review/api/reviewers", {}, owner);
    expect(JSON.stringify(await list.json())).not.toContain("rev@example.org");
  });
});

describe("P9 admin key and reviewer page", () => {
  const OWNER = "owner@example.org";
  const H = { "X-Admin": "1", Origin: "https://paite.lamkalabs.com" };
  async function signIn(email: string): Promise<string> {
    const token = "a".repeat(63) + (email === OWNER ? "1" : "2");
    const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)))].map((b) => b.toString(16).padStart(2, "0")).join("");
    await env.DB.prepare("INSERT INTO admin_links (token_hash, email, expires_at) VALUES (?1, ?2, ?3)").bind(hash, email, NOW + 60_000).run();
    const r = await call("/admin/api/password/set", { method: "POST", headers: H, body: JSON.stringify({ token, password: "correct horse" }) });
    return r.headers.get("Set-Cookie")!.split(";")[0];
  }
  it("P9-2 a blank key is refused when the provider or address changes, and kept when it does not", async () => {
    const owner = await signIn(OWNER);
    const save = (cookie: string, body: object) => call("/admin/api/ai", { method: "POST", headers: { ...H, Cookie: cookie }, body: JSON.stringify(body) });
    expect((await save(owner, { provider: "glm", model: "glm-4.6", key: "glm-key-0000-9999" })).status).toBe(200);
    await call("/admin/api/admins/add", { method: "POST", headers: { ...H, Cookie: owner }, body: JSON.stringify({ email: "helper@example.org" }) });
    const helper = await signIn("helper@example.org");
    const r = await save(helper, { provider: "custom", baseUrl: "https://evil.example/v1", model: "m", key: "" });
    expect(r.status).toBe(400);
    expect(((await r.json()) as { error: string }).error).toBe("key_required");
    expect((await save(owner, { provider: "glm", model: "glm-4.5", key: "" })).status).toBe(200);
    forgetAIConfig();
  });

  it("P9-3 (verbatim copy of post() from proverbs.html) a non-JSON or network failure resolves to ok:false", async () => {
    const html = (await import("../public/review/proverbs.html?raw")).default as string;
    expect(html).toContain('.catch(function () { return { ok: false, body: { message:');
    const post = (url: string, body: unknown) =>
      fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
        .then((r) => r.json().then((j: unknown) => ({ ok: r.ok, body: j })))
        .catch(() => ({ ok: false, body: { message: "x" } }));
    const real = globalThis.fetch;
    try {
      globalThis.fetch = (async () => new Response("<html>Bad gateway</html>", { status: 502 })) as typeof fetch;
      expect((await post("/x", {})).ok).toBe(false);
      globalThis.fetch = (async () => { throw new TypeError("network"); }) as typeof fetch;
      expect((await post("/x", {})).ok).toBe(false);
    } finally { globalThis.fetch = real; }
  });
});

describe("P3 places and gaps", () => {
  it("P3-5 cleanPlace keeps apostrophes natural and merges case variants", () => {
    expect(cleanPlace("Saikot's market")).toBe("Saikot's Market");
    expect(cleanPlace("NEW LAMKA")).toBe(cleanPlace("new lamka"));
  });
  it("P3-6 unrelated words do not cover common words, real inflections still do", () => {
    expect(commonIn("They tend to seed the card").map((i) => COMMON[i])).toEqual([]);
    const hit = (s: string) => commonIn(s).map((i) => COMMON[i]);
    expect(hit("She walked home and loved it")).toEqual(expect.arrayContaining(["walk", "love", "home"]));
    expect(hit("He likes cooking and carries bags")).toEqual(expect.arrayContaining(["like", "cook", "bag"]));
    expect(hit("She saw ten cars")).toEqual(expect.arrayContaining(["ten", "car"]));
  });
});
