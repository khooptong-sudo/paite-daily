import { env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runDigest } from "../src/digest";
import { getGlossary, glossaryJson, renderGlossary } from "../src/glossary";
import { call, fakeDeps, PHONE_A, session } from "./helpers";

const saved = { r: env.REVIEWERS, a: env.ALERT_EMAIL };
afterEach(() => { env.REVIEWERS = saved.r; env.ALERT_EMAIL = saved.a; vi.restoreAllMocks(); });

const word = async (b: Record<string, unknown>, s?: string) =>
  call("/api/word", { method: "POST", body: JSON.stringify(b), session: s ?? (await session(PHONE_A)) });
const rev = (path: string, body?: unknown, email: string | null = "rev@example.org") =>
  call(path, body === undefined ? {} : { method: "POST", body: JSON.stringify(body) }, fakeDeps({ verifyAccess: async () => email }));
const n = async (t: string) => (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${t}`).first<{ n: number }>())!.n;
const asReviewer = () => { env.REVIEWERS = JSON.stringify({ "rev@example.org": "Rev" }); };

describe("give the meaning", () => {
  const withWord = async (paite: string, english: string, hidden = 0) => {
    const r = await env.DB.prepare("INSERT INTO glossary (paite, english, source, hidden) VALUES (?1, ?2, 'note', ?3) RETURNING id")
      .bind(paite, english, hidden).first<{ id: number }>();
    return r!.id;
  };
  const next = async (s?: string) => call("/api/word/next", { session: s ?? (await session(PHONE_A)) });
  const meaning = async (b: Record<string, unknown>, s?: string) =>
    call("/api/word/meaning", { method: "POST", body: JSON.stringify(b), session: s ?? (await session(PHONE_A)) });

  it("needs a session", async () => {
    expect((await call("/api/word/next")).status).toBe(401);
    expect((await call("/api/word/meaning", { method: "POST", body: JSON.stringify({ id: 1, english: "x" }) })).status).toBe(401);
  });

  it("shows a listed word, never one this phone has answered, and 204 when they run out", async () => {
    const id = await withWord("Tui", "Water");
    const r = await next();
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ id, paite: "Tui" });
    expect((await meaning({ id, english: "Drinking water" })).status).toBe(200);
    // the only word is now answered by this phone, so there is nothing left for it
    expect((await next()).status).toBe(204);
    // another phone still gets it
    expect((await next(await session("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"))).status).toBe(200);
  });

  it("never shows a hidden word", async () => {
    await withWord("Zu", "Drink", 1);
    expect((await next()).status).toBe(204);
  });

  it("stores the meaning as a pending submission that names its source", async () => {
    const id = await withWord("Tan", "Warmth");
    expect((await meaning({ id, english: "warmth of a person", note: "as in feeling", name: "Ann" })).status).toBe(200);
    expect(await env.DB.prepare("SELECT paite, english, note, contributor_name AS name, source, status FROM word_submissions").first())
      .toEqual({ paite: "Tan", english: "Warmth of a person", note: "as in feeling", name: "Ann", source: "meaning", status: "pending" });
  });

  it("validates, and 404s on a missing or hidden word", async () => {
    const id = await withWord("Tui", "Water");
    const hiddenId = await withWord("Zu", "Drink", 1);
    expect((await meaning({ id: "x", english: "Water" })).status).toBe(400);
    expect((await meaning({ id, english: "   " })).status).toBe(400);
    expect((await meaning({ id, english: "W".repeat(121) })).status).toBe(400);
    expect((await meaning({ id, english: "Water", note: "n".repeat(201) })).status).toBe(400);
    expect((await meaning({ id: 99999, english: "Water" })).status).toBe(404);
    expect((await meaning({ id: hiddenId, english: "Water" })).status).toBe(404);
  });

  it("does not store a meaning the list already carries", async () => {
    const id = await withWord("Tui", "Water");
    expect((await meaning({ id, english: "water" })).status).toBe(200);
    expect(await n("word_submissions")).toBe(0);
  });

  it("counts a meaning as a meaning, not a word, on /api/me", async () => {
    const id = await withWord("Tui", "Water");
    await meaning({ id, english: "Drinking water" });
    const me = await (await call("/api/me", { session: await session(PHONE_A) })).json<{ words: number; meanings: number }>();
    expect(me).toMatchObject({ words: 0, meanings: 1 });
  });
});

describe("POST /api/word", () => {
  it("needs a session", async () => {
    expect((await call("/api/word", { method: "POST", body: JSON.stringify({ paite: "a", english: "b" }) })).status).toBe(401);
  });
  it("validates, stores, and never stores twice", async () => {
    for (const bad of [{}, { paite: "a" }, { paite: "a", english: "" }, { paite: "a".repeat(61), english: "b" }, { paite: "a", english: "b".repeat(121) },
      { paite: "a", english: "b", note: "n".repeat(201) }, { paite: "a\u0000", english: "b" }]) {
      expect((await word(bad)).status, JSON.stringify(bad).slice(0, 40)).toBe(400);
    }
    expect((await word({ paite: "dam", english: "well", note: "ka dam", name: "Ann" })).status).toBe(200);
    expect((await word({ paite: "DAM", english: "Well" })).status).toBe(200);
    expect(await n("word_submissions")).toBe(1);
    expect(await env.DB.prepare("SELECT paite, note, contributor_name AS name, status FROM word_submissions").first()).toEqual({ paite: "Dam", note: "ka dam", name: "Ann", status: "pending" });
  });
  it("blocks resubmission of a rejected pair", async () => {
    asReviewer();
    await word({ paite: "dam", english: "well" });
    const id = (await env.DB.prepare("SELECT id FROM word_submissions").first<{ id: number }>())!.id;
    await rev("/review/api/words/decide", { id, decision: "reject" });
    expect((await word({ paite: "Dam", english: "Well" })).status).toBe(200);
    expect(await n("word_submissions")).toBe(1);
  });
  it("treats an existing glossary entry as a duplicate", async () => {
    await env.DB.prepare("INSERT INTO glossary (paite, english, source) VALUES ('dam', 'well', 'contributed')").run();
    expect((await word({ paite: "Dam", english: "WELL" })).status).toBe(200);
    expect(await n("word_submissions")).toBe(0);
  });
  it("keeps no daily cap on words for now", async () => {
    for (let i = 0; i < 25; i++) expect((await word({ paite: "w" + i, english: "e" })).status).toBe(200);
    expect((await word({ paite: "extra", english: "e" })).status).toBe(200);
    expect(await n("word_submissions")).toBe(26);
  });
});

describe("review word endpoints", () => {
  it("rejects anonymous and non-reviewers", async () => {
    asReviewer();
    for (const email of [null, "stranger@example.org"]) {
      const want = email ? 403 : 401;
      expect((await rev("/review/api/words/pending", undefined, email)).status).toBe(want);
      expect((await rev("/review/api/words/decide", { id: 1, decision: "approve" }, email)).status).toBe(want);
    }
  });
  it("lists pending oldest first without phone ids, approves once, rejects", async () => {
    asReviewer();
    await word({ paite: "dam", english: "well", name: "Ann" });
    await word({ paite: "pa", english: "father" });
    const { words } = (await (await rev("/review/api/words/pending")).json()) as { words: { id: number; paite: string }[] };
    expect(words.map((w) => w.paite)).toEqual(["Dam", "Pa"]);
    expect(JSON.stringify(words)).not.toContain(PHONE_A);
    expect((await rev("/review/api/words/decide", { id: words[0].id, decision: "maybe" })).status).toBe(400);
    expect((await rev("/review/api/words/decide", { id: words[0].id, decision: "approve" })).status).toBe(200);
    expect((await rev("/review/api/words/decide", { id: words[0].id, decision: "approve" })).status).toBe(409);
    expect((await rev("/review/api/words/decide", { id: words[1].id, decision: "reject" })).status).toBe(200);
    expect((await rev("/review/api/words/decide", { id: words[1].id, decision: "approve" })).status).toBe(409);
    expect(await env.DB.prepare("SELECT paite, source, answer_id FROM glossary").all().then((r) => r.results)).toEqual([{ paite: "Dam", source: "contributed", answer_id: null }]);
    expect(await n("word_submissions WHERE status = 'pending'")).toBe(0);
    expect((await env.DB.prepare("SELECT decided_by FROM word_submissions WHERE id = ?1").bind(words[0].id).first<any>()).decided_by).toBe("rev@example.org");
  });
  it("credits the approving reviewer by name on the word list", async () => {
    asReviewer();
    await env.DB.prepare("INSERT INTO reviewers (email, name, added_by) VALUES ('rev@example.org', 'Lianpu', 'owner')").run();
    await word({ paite: "Laimal", english: "Letter", name: "Thangboi" });
    const id = (await env.DB.prepare("SELECT id FROM word_submissions").first<{ id: number }>())!.id;
    expect((await rev("/review/api/words/decide", { id, decision: "approve" })).status).toBe(200);
    expect((await env.DB.prepare("SELECT reviewed_by FROM glossary").first<any>()).reviewed_by).toBe("Lianpu");
    expect(renderGlossary(await getGlossary(env))).toContain("Added by Thangboi · Reviewed by Lianpu");
  });

  it("falls back to the reviewer's email when no name is on file", async () => {
    asReviewer();
    await word({ paite: "Tui", english: "Water" });
    const id = (await env.DB.prepare("SELECT id FROM word_submissions").first<{ id: number }>())!.id;
    await rev("/review/api/words/decide", { id, decision: "approve" });
    expect((await env.DB.prepare("SELECT reviewed_by FROM glossary").first<any>()).reviewed_by).toBe("rev@example.org");
  });
  it("stores a reviewer's correction when a word is approved, and ignores a half-filled one", async () => {
    asReviewer();
    await word({ paite: "dam", english: "well", name: "Ann" });
    const ids = (await env.DB.prepare("SELECT id FROM word_submissions ORDER BY id").all<{ id: number }>()).results;
    // only one field given: not a correction, the submission is stored as it came
    expect((await rev("/review/api/words/decide", { id: ids[0].id, decision: "approve", english: "well enough" })).status).toBe(200);
    expect(await env.DB.prepare("SELECT paite, english, note FROM glossary").all().then((r) => r.results))
      .toEqual([{ paite: "Dam", english: "Well", note: null }]);
  });
  it("approves with the reviewer's corrected text, note included", async () => {
    asReviewer();
    await word({ paite: "dam", english: "well", name: "Ann" });
    const id = (await env.DB.prepare("SELECT id FROM word_submissions").first<{ id: number }>())!.id;
    const r = await rev("/review/api/words/decide", { id, decision: "approve", paite: "dam hi", english: "i am well", note: "greeting" });
    expect(r.status).toBe(200);
    const row = await env.DB.prepare("SELECT paite, english, note, source, contributor_name FROM glossary").first();
    expect(row).toEqual({ paite: "Dam hi", english: "I am well", note: "greeting", source: "contributed", contributor_name: "Ann" });
    expect((await env.DB.prepare("SELECT paite, english FROM word_submissions WHERE id = ?1").bind(id).first()))
      .toEqual({ paite: "Dam", english: "Well" });
  });
  it("marks approved even when the glossary already has the word", async () => {
    asReviewer();
    await word({ paite: "dam", english: "well" });
    await env.DB.prepare("INSERT INTO glossary (paite, english) VALUES ('Dam', 'Well')").run();
    const id = (await env.DB.prepare("SELECT id FROM word_submissions").first<{ id: number }>())!.id;
    expect((await rev("/review/api/words/decide", { id, decision: "approve" })).status).toBe(200);
    expect(await n("glossary")).toBe(1);
    expect(await n("word_submissions WHERE status = 'approved'")).toBe(1);
  });
});

describe("digest with words", () => {
  it("sends when only words wait, and mentions both counts", async () => {
    env.REVIEWERS = JSON.stringify({ "a@example.org": "A" });
    const send = vi.fn(async (_m: unknown) => ({})); env.ALERT_EMAIL = { send } as unknown as SendEmail;
    expect(await runDigest(env)).toBeNull();
    await word({ paite: "dam", english: "well" });
    expect(await runDigest(env)).toEqual({ sent: 1 });
    expect((send.mock.calls[0][0] as any).subject).toBe("Paite Daily: 1 new words waiting");
    expect((send.mock.calls[0][0] as any).text).toBe("1 new words waiting for review.\n\nhttps://paite.lamkalabs.com/review");
  });
});

describe("glossary page", () => {
  it("credits a named contributor, falls back when unnamed, and capitalises words", async () => {
    await env.DB.prepare("INSERT INTO glossary (paite, english, source, contributor_name) VALUES ('dam', 'well', 'contributed', 'Mang <i>')").run();
    await env.DB.prepare("INSERT INTO glossary (paite, english, source) VALUES ('ngah', 'to get', 'contributed')").run();
    const html = renderGlossary(await getGlossary(env));
    expect(html).toContain("data-back");
    expect(html).toContain("Added by Mang &lt;i&gt;");
    expect(html.match(/data-s="srcContributed"/g)).toHaveLength(1);
    expect(html).toContain('<b class="w">Dam</b>');
    expect(html).toContain('<b class="w">Ngah</b>');
    expect(html).toContain("<p class=\"m\">Well</p>");
    expect(JSON.stringify(JSON.parse(glossaryJson(await getGlossary(env))))).not.toContain("Mang");
  });

  it("renders contributed and noted entries as details with ids, escaped, and exports source", async () => {
    await env.DB.prepare("INSERT INTO glossary (paite, english, note, source) VALUES ('<b>x</b>', 'a&b', '<i>n</i>', 'contributed')").run();
    const html = renderGlossary(await getGlossary(env));
    const id = (await env.DB.prepare("SELECT id FROM glossary").first<{ id: number }>())!.id;
    expect(html).toContain(`<li id="w-${id}" data-q=`);
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(html).not.toContain("<b>x</b>");
    expect(html).toContain('data-s="srcContributed"');
    expect(html).toMatch(/data-q="&lt;b&gt;x&lt;\/b&gt; a&amp;b &lt;i&gt;n&lt;\/i&gt;"/);
    expect(html).not.toContain('class="ex"');
    const json = JSON.parse(glossaryJson(await getGlossary(env)));
    expect(json.entries[0].source).toBe("contributed");
    expect(JSON.stringify(json)).not.toMatch(/phone|email/);
    const empty = renderGlossary([]);
    expect(empty).toContain('data-s="glossaryEmpty"');
    expect(empty).toContain('href="/"');
  });
});
