import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import wikiJs from "../public/review/wiki.js?raw";
import reviewHtml from "../public/review/wiki.html?raw";
import adminHtml from "../public/admin/wiki.html?raw";
import { createApp } from "../src/index";
import { sha256Hex } from "../src/kb";
import { ART, checkBlocks, draftArticle, getArticle, listArticles, saveArticle, setStatus, slugify } from "../src/kbarticle";
import { buildLexicon } from "../src/kbask";
import { syncSiteSources } from "../src/kbsite";
import { call, fakeDeps, NOW } from "./helpers";

const keyed = { ...env, DEEPSEEK_API_KEY: "k" };
const reply = (o: unknown) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(o) } }] }));
const model = (o: unknown, bodies: string[] = []) => (async (_u: string, init: RequestInit) => { bodies.push(init.body as string); return reply(o); }) as unknown as typeof fetch;

const SAY = "Testword alpha";
const TITLE = "What brings strength";
const TOPIC = "strength";
const WHO = { email: "creator@example.org" };
const lex = buildLexicon([{ paite: "Testword", english: "word" }], []);

async function seed() {
  await env.DB.prepare("INSERT INTO proverbs (kind, paite, english, explainer, explainer_en, entered_from, status) VALUES ('idiom', ?1, 'Two heads', NULL, 'Sharing brings strength', 'pai2en', 'live')").bind(SAY).run();
  await syncSiteSources(env, NOW);
}
async function chunkOf(text: string) {
  return (await env.WIKI.prepare("SELECT c.id AS chunk FROM kb_chunks c WHERE c.text LIKE ?1").bind(`%${text}%`).first<{ chunk: number }>())!.chunk;
}
async function addBook(title: string, text: string, rights: string, status: string) {
  const s = await env.WIKI.prepare("INSERT INTO kb_sources (kind, title, url, rights, trust, status, added_by, created_at, updated_at) VALUES ('book', ?1, 'https://example.org/b', ?2, 2, ?3, 'x', 1, 1) RETURNING id").bind(title, rights, status).first<{ id: number }>();
  const c = await env.WIKI.prepare("INSERT INTO kb_chunks (source_id, ordinal, locator, text, sha256) VALUES (?1, 1, 'p. 1', ?2, ?3) RETURNING id").bind(s!.id, text, await sha256Hex(text)).first<{ id: number }>();
  return c!.id;
}
const blocksFor = (chunk: number) => ({ blocks: [{ type: "heading", text: "Overview" }, { type: "text", text: "Sharing brings strength.", cites: [chunk] }, { type: "quote", chunk, text: SAY }] });
async function drafted(title = TITLE, who = WHO) {
  await seed();
  const chunk = await chunkOf(SAY);
  const r = await draftArticle(keyed, model(blocksFor(chunk)), { title, topic: TOPIC }, who, NOW);
  return { chunk, id: (r as { id: number }).id, r };
}
async function published(title = TITLE) {
  const d = await drafted(title);
  await setStatus(env, d.id, "submit", { ...WHO, owner: false }, NOW);
  expect(await setStatus(env, d.id, "publish", { email: "rev@example.org", owner: false }, NOW)).toEqual({ ok: true });
  return d;
}
const page = (path: string, e: any = env) => createApp(fakeDeps())(new Request(`https://paite.lamkalabs.com${path}`), e);

describe("articles", () => {
  it("1. slugify", () => {
    expect(slugify("Respect for Elders!")).toBe("respect-for-elders");
    expect(slugify("Placeholder’ âline")).toBe("placeholder-aline");
    expect(slugify("")).toBe("article");
    expect(slugify("!!!")).toBe("article");
  });

  it("2. checkBlocks accepts good blocks and returns the passage's own span", () => {
    const passages = new Map([[1, "Testword  alpha beta"]]);
    const r = checkBlocks([{ type: "heading", text: "Overview" }, { type: "text", text: "It is said.", cites: [1] }, { type: "quote", chunk: 1, text: "Testword alpha" }], passages, "Title", lex);
    expect(r).toEqual({ ok: true, blocks: [{ type: "heading", text: "Overview" }, { type: "text", text: "It is said.", cites: [1] }, { type: "quote", chunk: 1, text: "Testword alpha" }], cited: [1] });
    const spaced = checkBlocks([{ type: "text", text: "x", cites: [1] }, { type: "quote", chunk: 1, text: "Testword   alpha" }], passages, "T", lex);
    expect(spaced.ok && spaced.blocks[1]).toEqual({ type: "quote", chunk: 1, text: "Testword alpha" });
  });

  it("3. checkBlocks refuses what it must", () => {
    const passages = new Map([[1, "Testword alpha beta"]]);
    const t = (cites: number[]) => ({ type: "text", text: "Fine.", cites });
    const why = (raw: unknown, title = "T") => { const r = checkBlocks(raw, passages, title, lex); return r.ok ? "ok" : r.reason; };
    expect(why([t([9])])).toBe("unknown_chunk");
    expect(why([t([1]), { type: "quote", chunk: 7, text: "Testword" }])).toBe("unknown_chunk");
    expect(why([t([1]), { type: "quote", chunk: 1, text: "Testword gamma" }])).toBe("quote_mismatch");
    expect(why([t([])])).toBe("uncited_text");
    expect(why([{ type: "heading", text: "About Testword" }, t([1])])).toBe("paite_in_text:testword");
    expect(why([{ type: "heading", text: "About Testword" }, t([1])], "Testword")).toBe("ok");
    expect(why(Array.from({ length: 41 }, () => t([1])))).toBe("bad_shape");
    expect(why([{ type: "heading", text: "Only a heading" }])).toBe("bad_shape");
  });

  it("4. a good draft is stored with its revision and cited hashes", async () => {
    const { chunk, id, r } = await drafted();
    expect(r).toEqual({ id });
    const a = await env.WIKI.prepare("SELECT slug, status, created_by, rev_id FROM kb_articles WHERE id = ?1").bind(id).first<any>();
    expect(a).toMatchObject({ slug: "what-brings-strength", status: "draft", created_by: WHO.email });
    const rev = await env.WIKI.prepare("SELECT id, author, cited FROM kb_article_revs WHERE article_id = ?1").bind(id).all<any>();
    expect(rev.results).toHaveLength(1);
    expect(rev.results[0].author).toBe("ai:deepseek-chat");
    expect(a.rev_id).toBe(rev.results[0].id);
    const sha = (await env.WIKI.prepare("SELECT sha256 FROM kb_chunks WHERE id = ?1").bind(chunk).first<{ sha256: string }>())!.sha256;
    expect(JSON.parse(rev.results[0].cited)).toEqual([[chunk, sha]]);
  });

  it("5. a failing draft stores nothing; the model sees title and topic as JSON and no index-only text", async () => {
    await seed();
    await addBook("Hidden book", "strength secretindexonly words", "index-only", "approved");
    const chunk = await chunkOf(SAY);
    const bodies: string[] = [];
    const bad = { blocks: [{ type: "text", text: "x", cites: [chunk] }, { type: "quote", chunk, text: "Testword wrong" }] };
    const r = await draftArticle(keyed, model(bad, bodies), { title: TITLE, topic: TOPIC }, WHO, NOW);
    expect(r).toEqual({ error: "draft_failed", reason: "quote_mismatch" });
    expect((await env.WIKI.prepare("SELECT COUNT(*) AS n FROM kb_articles").first<{ n: number }>())!.n).toBe(0);
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toContain(JSON.stringify(JSON.stringify(TITLE)).slice(1, -1));
    expect(bodies[0]).toContain(JSON.stringify(JSON.stringify(TOPIC)).slice(1, -1));
    expect(bodies[0]).not.toContain("secretindexonly");
  });

  it("6. a second article with the same title gets -2", async () => {
    const first = await drafted();
    const r = await draftArticle(keyed, model(blocksFor(first.chunk)), { title: TITLE, topic: TOPIC }, WHO, NOW);
    const b = await getArticle(env, (r as { id: number }).id);
    expect(b!.slug).toBe("what-brings-strength-2");
  });

  it("7. the daily cap stops a draft before the model is called", async () => {
    await seed();
    await env.WIKI.prepare("INSERT INTO kb_counters (name, n) VALUES (?1, ?2)").bind("art:d:" + new Date(NOW).toISOString().slice(0, 10), ART.draftsPerDay).run();
    const bodies: string[] = [];
    expect(await draftArticle(keyed, model({}, bodies), { title: TITLE, topic: TOPIC }, WHO, NOW)).toEqual({ error: "limited" });
    expect(bodies).toHaveLength(0);
  });

  it("8. save keeps rewording and removals, refuses new passages, and keeps pending pending", async () => {
    const { chunk, id } = await drafted();
    const other = await addBook("Other book", "strength elsewhere", "open", "approved");
    const ed = { email: "editor@example.org" };
    const ok = await saveArticle(env, { id, blocks: [{ type: "text", text: "Reworded paragraph.", cites: [chunk] }], note: "tidy" }, ed, NOW);
    expect(ok).toEqual({ ok: true });
    const a = await getArticle(env, id);
    expect(a!.blocks).toEqual([{ type: "text", text: "Reworded paragraph.", cites: [chunk] }]);
    expect(a!.revs[0]).toMatchObject({ author: ed.email, note: "tidy" });
    expect(a!.revs).toHaveLength(2);
    expect(await saveArticle(env, { id, blocks: [{ type: "text", text: "New.", cites: [other] }], note: null }, ed, NOW)).toEqual({ error: "check_failed", reason: "unknown_chunk" });
    await setStatus(env, id, "submit", { ...WHO, owner: false }, NOW);
    expect((await getArticle(env, id))!.status).toBe("pending");
    expect(await saveArticle(env, { id, blocks: [{ type: "text", text: "Again.", cites: [chunk] }], note: null }, ed, NOW)).toEqual({ ok: true });
    expect((await getArticle(env, id))!.status).toBe("pending");
    expect(await saveArticle(env, { id: 9999, blocks: [], note: null }, ed, NOW)).toEqual({ error: "not_found" });
  });

  it("9. nobody but another reviewer publishes, the owner excepted", async () => {
    const { id } = await drafted();
    const me = (email: string, owner = false) => ({ email, owner });
    await setStatus(env, id, "submit", me(WHO.email), NOW);
    expect(await setStatus(env, id, "publish", me("Creator@Example.org"), NOW)).toMatchObject({ error: "own_submission" });
    // Another reviewer edits; now they are the latest author and the creator may publish.
    const a = await getArticle(env, id);
    await saveArticle(env, { id, blocks: a!.blocks, note: null }, { email: "editor@example.org" }, NOW);
    await setStatus(env, id, "submit", me("editor@example.org"), NOW);
    expect(await setStatus(env, id, "publish", me("editor@example.org"), NOW)).toMatchObject({ error: "own_submission" });
    expect(await setStatus(env, id, "publish", me("third@example.org"), NOW)).toEqual({ ok: true });
    // The owner may publish their own work.
    const mine = await draftArticle(keyed, model(blocksFor(await chunkOf(SAY))), { title: "Owner article", topic: TOPIC }, { email: "owner@example.org" }, NOW);
    const oid = (mine as { id: number }).id;
    await setStatus(env, oid, "submit", me("owner@example.org", true), NOW);
    expect(await setStatus(env, oid, "publish", me("owner@example.org", true), NOW)).toEqual({ ok: true });
    expect(await setStatus(env, oid, "publish", me("x@example.org"), NOW)).toEqual({ error: "wrong_status" });
  });

  it("10. a changed passage makes the article stale: no publishing, no public page", async () => {
    const { id } = await drafted();
    await setStatus(env, id, "submit", { ...WHO, owner: false }, NOW);
    await env.DB.prepare("UPDATE proverbs SET explainer_en = 'Sharing brings great strength'").run();
    await syncSiteSources(env, NOW + 1000);
    expect((await listArticles(env))[0].stale).toBe(true);
    expect(await setStatus(env, id, "publish", { email: "rev@example.org", owner: false }, NOW)).toEqual({ error: "stale" });
    // A published article that goes stale also disappears.
    await env.WIKI.prepare("UPDATE kb_articles SET status = 'published' WHERE id = ?1").bind(id).run();
    expect((await page("/wiki/what-brings-strength", { ...env, WIKI_PUBLIC: "1" })).status).toBe(404);
  });

  it("11. the public pages are off without WIKI_PUBLIC", async () => {
    await published();
    expect((await page("/wiki/what-brings-strength")).status).toBe(404);
    expect((await page("/wiki")).status).toBe(404);
  });

  it("12. the public page shows the article, its sources and the reviewer's name, never an email", async () => {
    const { chunk } = await published();
    const on = { ...env, WIKI_PUBLIC: "1" };
    const res = await page("/wiki/what-brings-strength", on);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=300");
    const html = await res.text();
    expect(html).toContain(`<title>${TITLE} · Paite Wiki</title>`);
    expect(html).toContain("<h2>Overview</h2>");
    expect(html).toContain(`<blockquote lang="pck">${SAY}<sup><a href="#s-1">1</a></sup></blockquote>`);
    expect(html).toContain('<li id="s-1">');
    expect(html).toContain("https://creativecommons.org/licenses/by/4.0/");
    expect(html).toContain("checked by Rev One");
    expect(html).not.toContain("@example.org");
    expect(chunk).toBeGreaterThan(0);
    const index = await (await page("/wiki", on)).text();
    expect(index).toContain('<a href="/wiki/what-brings-strength">What brings strength</a>');
    expect(await (await page("/wiki/nope", on)).text()).not.toContain("Paite Wiki</h1>");
    expect((await page("/wiki/nope", on)).status).toBe(404);
  });

  it("13. a title with markup is escaped", async () => {
    await published("<script>alert(1)</script> strength");
    const html = await (await page("/wiki/script-alert-1-script-strength", { ...env, WIKI_PUBLIC: "1" })).text();
    expect(html).not.toContain("<script>alert(1)");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt; strength");
  });

  it("14. the routes work for a reviewer and an admin, and need a sign-in", async () => {
    await seed();
    const chunk = await chunkOf(SAY);
    const post = (path: string, who: string | null) => createApp(fakeDeps({ verifyReviewer: async () => who, fetch: model(blocksFor(chunk)) }))(
      new Request(`https://paite.lamkalabs.com${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: TITLE, topic: TOPIC }) }), keyed);
    const ok = await post("/review/api/wiki/articles/draft", "rev@example.org");
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ id: expect.any(Number) });
    expect((await post("/review/api/wiki/articles/draft", null)).status).toBe(401);
    const token = "a".repeat(64);
    const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)))].map((b) => b.toString(16).padStart(2, "0")).join("");
    await env.DB.prepare("INSERT INTO admin_links (token_hash, email, expires_at) VALUES (?1, ?2, ?3)").bind(hash, "owner@example.org", NOW + 60_000).run();
    const set = await call("/admin/api/password/set", { method: "POST", headers: { "X-Admin": "1", Origin: "https://paite.lamkalabs.com" }, body: JSON.stringify({ token, password: "correct horse" }) });
    const cookie = set.headers.get("Set-Cookie")!.split(";")[0];
    const list = await call("/admin/api/wiki/articles", { headers: { Cookie: cookie } });
    expect(list.status).toBe(200);
    expect((await list.json<{ articles: unknown[] }>()).articles).toHaveLength(1);
  });

  it("15. the review page code uses the article routes and never innerHTML", () => {
    for (const s of ["/articles/draft", "/articles/save", "/articles/publish"]) expect(wikiJs).toContain(s);
    expect(wikiJs).not.toMatch(/innerHTML|insertAdjacentHTML|outerHTML/);
    expect(reviewHtml).toContain('id="sec-articles"');
    expect(adminHtml).toContain('id="sec-articles"');
  });
});
