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
  it("limits 20 words per phone per day", async () => {
    for (let i = 0; i < 20; i++) expect((await word({ paite: "w" + i, english: "e" })).status).toBe(200);
    expect((await word({ paite: "extra", english: "e" })).status).toBe(429);
    expect((await word({ paite: "w1", english: "e" })).status).toBe(429);
    expect(await n("word_submissions")).toBe(20);
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
