import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { getGlossary, getWordExtras, renderGlossary, type Entry } from "../src/glossary";
import { addSentences, call, fakeDeps, PHONE_A, PHONE_B, session } from "./helpers";

const FRESH = "2027-01-10 00:00:00"; // five days before the test clock
const rev = (email = "rev@example.org") => fakeDeps({ verifyReviewer: async () => email });
const g = async (paite: string, english: string, example?: string) => {
  const r = await env.DB.prepare("INSERT INTO glossary (paite, english, source) VALUES (?1, ?2, 'note') RETURNING id").bind(paite, english).first<{ id: number }>();
  if (example) {
    const [sid] = await addSentences("Example for " + paite);
    const a = await env.DB.prepare("INSERT INTO answers (sentence_id, paite, register, phone_id, status) VALUES (?1, ?2, 'both', 'p', 'accepted') RETURNING id").bind(sid, example).first<{ id: number }>();
    await env.DB.prepare("UPDATE glossary SET answer_id = ?1, sentence_id = ?2 WHERE id = ?3").bind(a!.id, sid, r!.id).run();
  }
  return r!.id;
};
const line = async (paite: string, status = "accepted", direction = "en2pai") => {
  const [sid] = await addSentences("English of " + paite);
  if (direction !== "en2pai") await env.DB.prepare("UPDATE sentences SET direction = ?1 WHERE id = ?2").bind(direction, sid).run();
  await env.DB.prepare("INSERT INTO answers (sentence_id, paite, register, phone_id, status) VALUES (?1, ?2, 'both', 'p', ?3)").bind(sid, paite, status).run();
};
const link = async (paite: string, other: string, kind: string, status = "approved") =>
  env.DB.prepare("INSERT INTO word_links (paite, other, kind, phone_id, status) VALUES (?1, ?2, ?3, 'x', ?4)").bind(paite, other, kind, status).run();
const post = async (b: Record<string, unknown>, s?: string) => call("/api/link", { method: "POST", body: JSON.stringify(b), session: s ?? (await session(PHONE_A)) });
const rows = async () => (await env.DB.prepare("SELECT paite, other, kind, status FROM word_links ORDER BY id").all()).results;
const extras = async () => getWordExtras(env, await getGlossary(env));

describe("POST /api/link and /api/link/next", () => {
  it("needs a session", async () => {
    expect((await call("/api/link", { method: "POST", body: JSON.stringify({ id: 1, same: "x" }) })).status).toBe(401);
    expect((await call("/api/link/next")).status).toBe(401);
  });

  it("inserts one pending row per kind", async () => {
    const id = await g("tui", "water");
    expect((await post({ id, same: "ti", opposite: "mei", name: "Ann" })).status).toBe(200);
    expect(await rows()).toEqual([
      { paite: "Tui", other: "Ti", kind: "same", status: "pending" },
      { paite: "Tui", other: "Mei", kind: "opposite", status: "pending" },
    ]);
  });

  it("rejects empty or bad input and unknown ids", async () => {
    const id = await g("tui", "water");
    expect((await post({ id })).status).toBe(400);
    expect((await post({ id, same: "  " })).status).toBe(400);
    expect((await post({ id, same: "x".repeat(61) })).status).toBe(400);
    expect((await post({ id, same: "x", name: "n".repeat(61) })).status).toBe(400);
    expect((await post({ id: 99999, same: "x" })).status).toBe(404);
  });

  it("drops the headword itself, and a duplicate in the reverse direction", async () => {
    const id = await g("tui", "water");
    expect((await post({ id, same: "TUI" })).status).toBe(200);
    expect(await rows()).toEqual([]);
    await link("Mei", "Tui", "same", "rejected");
    expect((await post({ id, same: "mei" })).status).toBe(200);
    expect(await rows()).toHaveLength(1);
    // another kind is not a duplicate
    await post({ id, opposite: "mei" });
    expect(await rows()).toHaveLength(2);
  });

  it("skips headwords this phone already linked, then 204; another phone still gets one", async () => {
    const id = await g("tui", "water");
    const r = await call("/api/link/next", { session: await session(PHONE_A) });
    expect(await r.json()).toEqual({ id, paite: "Tui" });
    await post({ id, same: "ti" });
    expect((await call("/api/link/next", { session: await session(PHONE_A) })).status).toBe(204);
    expect((await call("/api/link/next", { session: await session(PHONE_B) })).status).toBe(200);
    expect(await (await call("/api/me", { session: await session(PHONE_A) })).json()).toMatchObject({ links: 1 });
  });
});

describe("reviewer: word links", () => {
  const add = async (phone = PHONE_A, name: string | null = null, at = FRESH) =>
    (await env.DB.prepare("INSERT INTO word_links (paite, other, kind, phone_id, contributor_name, created_at) VALUES ('Tui', 'ti', 'same', ?1, ?2, ?3) RETURNING id").bind(phone, name, at).first<{ id: number }>())!.id;
  const decide = (b: unknown, deps = rev()) => call("/review/api/links/decide", { method: "POST", body: JSON.stringify(b) }, deps);
  const pending = async (deps = rev()) => (await (await call("/review/api/links/pending", {}, deps)).json() as any).links;

  it("lists pending links, hiding the reviewer's own fresh ones", async () => {
    await add(PHONE_A, "Ann");
    await add(PHONE_B, "Rev One");
    const l = await pending();
    expect(l).toEqual([{ id: expect.any(Number), paite: "Tui", other: "ti", kind: "same", name: "Ann" }]);
    expect(await pending(rev("owner@example.org"))).toHaveLength(2);
  });

  it("approve names the reviewer and applies a corrected word; a second decision is 409", async () => {
    await env.DB.prepare("INSERT INTO reviewers (email, name, added_by) VALUES ('rev@example.org', 'Rev One', 'test')").run();
    const id = await add();
    expect((await decide({ id, decision: "approve", other: "tii" })).status).toBe(200);
    expect(await env.DB.prepare("SELECT status, other, reviewed_by, decided_by FROM word_links").first()).toEqual({ status: "approved", other: "Tii", reviewed_by: "Rev One", decided_by: "rev@example.org" });
    expect((await decide({ id, decision: "reject" })).status).toBe(409);
    expect((await decide({ id: await add(), decision: "approve", other: "x".repeat(61) })).status).toBe(400);
  });

  it("refuses a non-owner's own submission", async () => {
    const id = await add(PHONE_A, "Rev One");
    const r = await decide({ id, decision: "approve" });
    expect(r.status).toBe(409);
    expect((await r.json() as any).error).toBe("own_submission");
    expect((await decide({ id, decision: "approve" }, rev("owner@example.org"))).status).toBe(200);
  });
});

describe("getWordExtras", () => {
  it("lists headwords that share a meaning under each other", async () => {
    await g("tui", "Water"); await g("ti", " water "); await g("mei", "fire");
    const x = await extras();
    expect(x.same.get("tui")).toEqual(["Ti"]);
    expect(x.same.get("ti")).toEqual(["Tui"]);
    expect(x.same.get("mei")).toBeUndefined();
  });

  it("shows approved links on both words, not pending or rejected", async () => {
    await g("mei", "fire"); await g("tui", "water");
    await link("mei", "kang", "same");
    await link("mei", "zoh", "same", "pending");
    await link("mei", "lek", "same", "rejected");
    await link("tui", "mei", "opposite");
    const x = await extras();
    expect(x.same.get("mei")).toEqual(["kang"]);
    expect(x.same.get("kang")).toEqual(["Mei"]);
    expect(x.opposite.get("tui")).toEqual(["Mei"]);
    expect(x.opposite.get("mei")).toEqual(["Tui"]);
  });

  it("seen in use: whole words, phrases, cap 2, skips the example, ignores pai2en and unverified", async () => {
    await g("pa", "father"); await g("tui nam", "juice", "Tui nam a dam.");
    await line("Ka pai ing."); // "pa" must not match "pai"
    await line("Ka pa a hong."); await line("Ka pa a pai."); await line("Pa a nuam."); await line("Tui nam a dam.");
    await line("Tui nam khat.", "accepted"); await line("Ka tui nam ing", "new"); await line("Tui nam pai2en", "accepted", "pai2en");
    const x = await extras();
    expect(x.seen.get("pa")!.map((e) => e.paite)).toEqual(["Pa a nuam.", "Ka pa a pai."]);
    expect(x.seen.get("tui nam")!.map((e) => e.paite)).toEqual(["Tui nam khat."]);
  });
});

describe("renderGlossary with extras", () => {
  const e = (id: number, paite: string, english: string): Entry => ({ id, paite, english, note: null, source: "note", by: null, reviewed_by: null, example: null });
  const xs = [e(1, "Tui", "water"), e(2, "Ti", "water")];

  it("renders the three blocks, linking a listed word and leaving others plain", () => {
    const html = renderGlossary(xs, {
      same: new Map([["tui", ["Ti", "Kang"]]]), opposite: new Map([["tui", ["Mei <b>"]]]),
      seen: new Map([["tui", [{ paite: "Tui <i>", english: "Water & more" }]]]),
    });
    expect(html).toContain('<p class="rel"><span class="lbl" data-s="relSame">Same Meaning</span> <a href="#w-2">Ti</a>, Kang</p>');
    expect(html).toContain('data-s="relOpposite">Opposite</span> Mei &lt;b&gt;</p>');
    expect(html).toContain('<div class="seen"><span class="lbl" data-s="seenInUse">Seen in Use</span><span class="ex">Tui &lt;i&gt;<br>Water &amp; more</span></div>');
  });

  it("is unchanged without extras, and empty extras add nothing", () => {
    const base = renderGlossary(xs);
    expect(base).not.toContain('class="rel"');
    expect(renderGlossary(xs, { same: new Map(), opposite: new Map(), seen: new Map() })).toBe(base);
  });
});
