import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import wikiJs from "../public/review/wiki.js?raw";
import { createApp } from "../src/index";
import { sha256Hex } from "../src/kb";
import { ask, flagAnswer } from "../src/kbask";
import { listArticles, renderWikiIndex, saveArticle, setStatus } from "../src/kbarticle";
import { syncSiteSources } from "../src/kbsite";
import { fakeDeps, NOW } from "./helpers";

const WHO = { email: "creator@example.org" };
const on = { ...env, WIKI_PUBLIC: "1" };
const flagReq = (askId: number, ip = "1.1.1.1") => createApp(fakeDeps())(new Request("https://paite.lamkalabs.com/api/ask/flag", { method: "POST", headers: { "content-type": "application/json", "CF-Connecting-IP": ip }, body: JSON.stringify({ askId, right: false }) }), on);
async function addAsk(status: string, at: number) {
  return (await env.WIKI.prepare("INSERT INTO kb_asks (q, q_key, via, retrieved, status, at) VALUES ('q','q','public','[]',?1,?2) RETURNING id").bind(status, at).first<{ id: number }>())!.id;
}

describe("wiki flags and limits", () => {
  it("a public flag is limited per visitor and answers 429", async () => {
    const id = await addAsk("answer", NOW);
    for (let i = 0; i < 30; i++) expect((await flagReq(id)).status).toBe(200);
    const r = await flagReq(id);
    expect(r.status).toBe(429);
    expect(((await r.json()) as { message: string }).message).toBeTruthy();
    expect((await flagReq(id, "2.2.2.2")).status).toBe(200);
  });
  it("a public flag needs a recent answered ask", async () => {
    expect((await flagReq(await addAsk("answer", NOW - 25 * 3_600_000))).status).toBe(400);
    expect((await flagReq(await addAsk("error", NOW))).status).toBe(400);
    expect((await flagReq(await addAsk("limited", NOW))).status).toBe(400);
    expect((await flagReq(await addAsk("cached", NOW - 3_600_000))).status).toBe(200);
  });
  it("a reviewer can still flag an old ask", async () => {
    expect(await flagAnswer(env, await addAsk("answer", 1), true, null, "rev:a@example.org", NOW)).toBe(true);
  });
  it("asks refused for the hour log one row, not one per request", async () => {
    const who = { via: "public" as const, key: "ip:z" };
    for (let i = 0; i < 20; i++) await ask(env, fetch, "Some question here", who, NOW);
    for (let i = 0; i < 5; i++) expect((await ask(env, fetch, "Some question here", who, NOW)).status).toBe("limited");
    const n = await env.WIKI.prepare("SELECT COUNT(*) AS n FROM kb_asks WHERE status = 'limited'").first<{ n: number }>();
    expect(n!.n).toBe(1);
  });
});

async function article(n: number) {
  const text = "Passage " + n;
  const s = await env.WIKI.prepare("INSERT INTO kb_sources (kind, title, url, rights, trust, status, added_by, created_at, updated_at) VALUES ('book', ?1, 'https://example.org/b', 'open', 2, 'approved', 'x', 1, 1) RETURNING id").bind("B" + n).first<{ id: number }>();
  const c = await env.WIKI.prepare("INSERT INTO kb_chunks (source_id, ordinal, locator, text, sha256) VALUES (?1, 1, 'p', ?2, ?3) RETURNING id").bind(s!.id, text, await sha256Hex(text)).first<{ id: number }>();
  const a = await env.WIKI.prepare("INSERT INTO kb_articles (slug, title, status, created_by, published_by, published_at, updated_at, created_at) VALUES (?1, ?2, 'published', 'a@example.org', 'b@example.org', ?3, ?3, ?3) RETURNING id").bind("art-" + n, "Article " + n, NOW + n).first<{ id: number }>();
  const r = await env.WIKI.prepare("INSERT INTO kb_article_revs (article_id, body, cited, author, created_at) VALUES (?1, ?2, ?3, 'a@example.org', 1) RETURNING id").bind(a!.id, JSON.stringify([{ type: "text", text: "Fine.", cites: [c!.id] }]), JSON.stringify([[c!.id, await sha256Hex(text)]])).first<{ id: number }>();
  await env.WIKI.prepare("UPDATE kb_articles SET rev_id = ?2 WHERE id = ?1").bind(a!.id, r!.id).run();
  return a!.id;
}
const counting = () => {
  const o = { n: 0 };
  const WIKI = new Proxy(env.WIKI, { get: (t, k) => k === "prepare" ? (sql: string) => { o.n++; return t.prepare(sql); } : (t as any)[k].bind(t) });
  return { o, e: { ...env, WIKI } as typeof env };
};

describe("wiki index and articles", () => {
  it("the index uses a fixed number of queries however many articles there are", async () => {
    for (let i = 1; i <= 12; i++) await article(i);
    const { o, e } = counting();
    const html = await renderWikiIndex(e);
    expect(html).toContain("Article 12");
    expect(o.n).toBeLessThanOrEqual(3);
    expect((await listArticles(env)).every((a) => !a.stale)).toBe(true);
  });
  it("a stale article is still marked stale", async () => {
    const id = await article(1);
    await env.WIKI.prepare("UPDATE kb_chunks SET sha256 = 'changed'").run();
    expect((await listArticles(env)).find((a) => a.id === id)!.stale).toBe(true);
  });
  it("saving a pending article keeps it pending", async () => {
    const id = await article(1);
    await env.WIKI.prepare("UPDATE kb_articles SET status = 'pending' WHERE id = ?1").bind(id).run();
    const c = (await env.WIKI.prepare("SELECT id FROM kb_chunks").first<{ id: number }>())!.id;
    const r = await saveArticle(env, { id, blocks: [{ type: "text", text: "Edited.", cites: [c] }], note: null }, WHO, NOW);
    expect(r).toEqual({ ok: true });
    expect((await env.WIKI.prepare("SELECT status FROM kb_articles WHERE id = ?1").bind(id).first<{ status: string }>())!.status).toBe("pending");
    expect(await setStatus(env, id, "return", { ...WHO, owner: false }, NOW)).toEqual({ ok: true });
    expect((await env.WIKI.prepare("SELECT status FROM kb_articles WHERE id = ?1").bind(id).first<{ status: string }>())!.status).toBe("draft");
  });
});

describe("site sync", () => {
  it("a short read of proverbs does not delete the proverbs it did not read", async () => {
    for (const w of ["One", "Two", "Three"]) await env.DB.prepare("INSERT INTO proverbs (kind, paite, english, explainer, explainer_en, entered_from, status) VALUES ('idiom', ?1, ?1, NULL, NULL, 'pai2en', 'live')").bind(w).run();
    await syncSiteSources(env, NOW);
    const count = async () => (await env.WIKI.prepare("SELECT COUNT(*) AS n FROM kb_sources WHERE site_key LIKE 'proverb:%'").first<{ n: number }>())!.n;
    expect(await count()).toBe(3);
    const DB = new Proxy(env.DB, {
      get: (t, k) => k === "prepare" ? (sql: string) => {
        const st = t.prepare(sql);
        return sql.includes("FROM proverbs WHERE status = 'live' ORDER") ? new Proxy(st, { get: (s, m) => m === "all" ? async () => { const r = await s.all<any>(); return { ...r, results: r.results.slice(0, 1) }; } : (s as any)[m].bind(s) }) : st;
      } : (t as any)[k].bind(t),
    });
    await syncSiteSources({ ...env, DB } as typeof env, NOW + 1);
    expect(await count()).toBe(3);
    await env.DB.prepare("DELETE FROM proverbs WHERE paite = 'Two'").run();
    await syncSiteSources(env, NOW + 2);
    expect(await count()).toBe(2);
  });
});

describe("review wiki page script", () => {
  it("saves unsaved edits before a status change", () => {
    expect(wikiJs).toContain("Save first");
    expect(wikiJs).toMatch(/dirty[\s\S]{0,400}\/articles\/save/);
  });
  it("a stale source list response is ignored", () => {
    expect(wikiJs).toMatch(/mine !== sourcesCall\) return/);
  });
});
