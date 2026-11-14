import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/index";
import { ask, flagAnswer } from "../src/kbask";
import { syncSiteSources } from "../src/kbsite";
import { sha256Hex } from "../src/kb";
import { fakeDeps, NOW } from "./helpers";

const keyed = { ...env, DEEPSEEK_API_KEY: "k" };
const reply = (o: unknown) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(o) } }] }));
const model = (o: unknown, bodies: string[] = []) => (async (_u: string, init: RequestInit) => { bodies.push(init.body as string); return reply(o); }) as unknown as typeof fetch;
const broken = (async () => new Response("no", { status: 500 })) as unknown as typeof fetch;

const Q = "What brings strength?";
const REV = { via: "review" as const, key: "rev:a@example.org" };
const SAY = "Testword alpha";

async function saying(paite: string, english: string, explainerEn: string | null) {
  await env.DB.prepare("INSERT INTO proverbs (kind, paite, english, explainer, explainer_en, entered_from, status) VALUES ('idiom', ?1, ?2, NULL, ?3, 'pai2en', 'live')").bind(paite, english, explainerEn).run();
}
async function word(paite: string, english: string) {
  await env.DB.prepare("INSERT INTO glossary (paite, english, note, source, reviewed_by, hidden) VALUES (?1, ?2, NULL, 'test', 'rev@example.org', 0)").bind(paite, english).run();
}
async function seed() {
  await saying(SAY, "Two heads", "Sharing brings strength");
  await syncSiteSources(env, NOW);
}
async function sourceOf(text: string) {
  return (await env.WIKI.prepare("SELECT c.id AS chunk, c.source_id AS source FROM kb_chunks c WHERE c.text LIKE ?1").bind(`%${text}%`).first<{ chunk: number; source: number }>())!;
}
async function addBook(title: string, text: string, rights: string, status: string) {
  const s = await env.WIKI.prepare("INSERT INTO kb_sources (kind, title, url, rights, trust, status, added_by, created_at, updated_at) VALUES ('book', ?1, 'https://example.org/b', ?2, 2, ?3, 'x', 1, 1) RETURNING id").bind(title, rights, status).first<{ id: number }>();
  await env.WIKI.prepare("INSERT INTO kb_chunks (source_id, ordinal, locator, text, sha256) VALUES (?1, 1, 'p. 1', ?2, ?3)").bind(s!.id, text, await sha256Hex(text)).run();
  return s!.id;
}
const asks = async () => (await env.WIKI.prepare("SELECT * FROM kb_asks ORDER BY id").all<any>()).results;
const good = (chunk: number, quote = SAY) => ({ status: "answer", parts: [{ type: "text", text: "It says this." }, { type: "quote", chunk, text: quote }], sources: [chunk] });

describe("ask engine", () => {
  it("1. a good answer carries the passage's own quote, its source, and a log row without an IP", async () => {
    await seed();
    const c = await sourceOf(SAY);
    const a = await ask(keyed, model(good(c.chunk)), Q, REV, NOW);
    expect(a.status).toBe("answer");
    expect(a.parts[1]).toEqual({ type: "quote", chunk: c.chunk, text: SAY });
    expect(a.sources[0].title).toBe(`Saying: ${SAY}`);
    expect(a.sources[0].url).toMatch(/^\/proverbs#p-/);
    const row = (await asks())[0];
    expect(row.status).toBe("answer");
    expect(JSON.parse(row.retrieved).length).toBeGreaterThan(0);
    expect(row.model).toBeTruthy();
    const cols = (await env.WIKI.prepare("PRAGMA table_info(kb_asks)").all<{ name: string }>()).results.map((r) => r.name);
    expect(cols.filter((n) => n.includes("ip"))).toEqual([]);
  });
  it("2. the model sees the question as a JSON string and the passages, never index-only text", async () => {
    await seed();
    await addBook("Closed book", "Hiddenindexed words on strength", "index-only", "approved");
    const bodies: string[] = [];
    await ask(keyed, model({ status: "none" }, bodies), Q, REV, NOW);
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toContain(JSON.stringify(JSON.stringify(Q)).slice(1, -1));
    expect(bodies[0]).toContain(SAY);
    expect(bodies[0]).not.toContain("Hiddenindexed");
  });
  it("3. a quote with one letter changed fails, shows nothing and is not cached", async () => {
    await seed();
    const c = await sourceOf(SAY);
    const a = await ask(keyed, model(good(c.chunk, "Testword alphb")), Q, REV, NOW);
    expect(a).toMatchObject({ status: "none", parts: [] });
    expect((await asks())[0]).toMatchObject({ status: "failed", reason: "quote_mismatch" });
    expect((await env.WIKI.prepare("SELECT COUNT(*) AS n FROM kb_ask_cache").first<{ n: number }>())!.n).toBe(0);
  });
  it("4. a quote from a chunk that was not retrieved fails", async () => {
    await seed();
    const a = await ask(keyed, model(good(999999)), Q, REV, NOW);
    expect(a.status).toBe("none");
    expect((await asks())[0]).toMatchObject({ status: "failed", reason: "unknown_chunk" });
  });
  it("5. a Paite-only word in English text fails, unless the question or a quote has it", async () => {
    await seed();
    await word("Testword", "obscure thing");
    await syncSiteSources(env, NOW + 1);
    const c = await sourceOf(SAY);
    const withText = (t: string) => ({ status: "answer", parts: [{ type: "text", text: t }, { type: "quote", chunk: c.chunk, text: "Sharing brings strength" }], sources: [c.chunk] });
    await ask(keyed, model(withText("The word Testword is used.")), Q, REV, NOW);
    expect((await asks())[0]).toMatchObject({ status: "failed", reason: "paite_in_text:testword" });
    // The same word is fine when the visitor asked with it.
    const inQ = await ask(keyed, model(withText("The word Testword is used.")), "What is Testword about strength?", REV, NOW);
    expect(inQ.status).toBe("answer");
    // And when the same answer quotes it: a text part with no quote of it fails, with one passes.
    const quotedOnly = { status: "answer", parts: [{ type: "text", text: "Testword appears here." }, { type: "quote", chunk: c.chunk, text: "Testword" }], sources: [c.chunk] };
    const ok = await ask(keyed, model(quotedOnly), "Which saying shares strength?", REV, NOW);
    expect(ok.status).toBe("answer");
  });
  it("6. doubled spaces and a decomposed letter still match, and the passage's own form is returned", async () => {
    await saying("Placeholder’ âline", "Two heads", "Sharing brings strength");
    await syncSiteSources(env, NOW);
    const c = await sourceOf("Placeholder");
    const a = await ask(keyed, model(good(c.chunk, "Placeholder’   âline")), Q, REV, NOW);
    expect(a.status).toBe("answer");
    expect((a.parts[1] as any).text).toBe("Placeholder’ âline");
  });
  it("7. a model that says none is logged as none", async () => {
    await seed();
    const a = await ask(keyed, model({ status: "none" }), Q, REV, NOW);
    expect(a.status).toBe("none");
    expect((await asks())[0].status).toBe("none");
  });
  it("8. a model error gives none and is logged as an error", async () => {
    await seed();
    const a = await ask(keyed, broken, Q, REV, NOW);
    expect(a.status).toBe("none");
    expect((await asks())[0].status).toBe("error");
  });
  it("9. an index-only match is listed by title only", async () => {
    await seed();
    await addBook("Closed book", "Hiddenindexed words on strength", "index-only", "approved");
    const bodies: string[] = [];
    const a = await ask(keyed, model(good((await sourceOf(SAY)).chunk), bodies), Q, REV, NOW);
    expect(a.seeAlso).toEqual([{ title: "Closed book", url: "https://example.org/b" }]);
    expect(JSON.stringify(a.sources)).not.toContain("Closed book");
    expect(JSON.stringify(a)).not.toContain("Hiddenindexed");
    expect(bodies[0]).not.toContain("Hiddenindexed");
  });
  it("10. pending and withdrawn sources are never retrieved", async () => {
    await addBook("Pending book", "Quokkaword is here", "open", "pending");
    await addBook("Gone book", "Quokkaword is there", "open", "withdrawn");
    const bodies: string[] = [];
    const a = await ask(keyed, model(good(1), bodies), "Tell me about Quokkaword", REV, NOW);
    expect(a.status).toBe("none");
    expect(bodies).toHaveLength(0);
    expect((await asks())[0]).toMatchObject({ status: "none", reason: "no_passages" });
  });
  it("11. a repeat question is answered from the cache until the passage changes", async () => {
    await seed();
    const c = await sourceOf(SAY);
    const bodies: string[] = [];
    const m = model(good(c.chunk), bodies);
    await ask(keyed, m, Q, REV, NOW);
    const again = await ask(keyed, m, "WHAT brings strength", REV, NOW + 1000);
    expect(again.cached).toBe(true);
    expect(again.status).toBe("answer");
    expect(bodies).toHaveLength(1);
    expect((await asks())[1].status).toBe("cached");
    await env.DB.prepare("UPDATE proverbs SET explainer_en = 'Sharing brings strength today'").run();
    await syncSiteSources(env, NOW + 2000);
    const third = await ask(keyed, m, Q, REV, NOW + 3000);
    expect(third.cached).toBe(false);
    expect(bodies).toHaveLength(2);
  });
  it("12. the cache is dropped when the cited source stops being approved", async () => {
    await seed();
    const c = await sourceOf(SAY);
    const bodies: string[] = [];
    const m = model(good(c.chunk), bodies);
    await ask(keyed, m, Q, REV, NOW);
    await env.WIKI.prepare("UPDATE kb_sources SET status = 'withdrawn' WHERE id = ?1").bind(c.source).run();
    const a = await ask(keyed, m, Q, REV, NOW + 1000);
    expect(a.cached).toBe(false);
    expect(a.status).toBe("none");
    expect(bodies).toHaveLength(1);
  });
  it("13. the hourly limit is per key", async () => {
    for (let i = 0; i < 60; i++) expect((await ask(keyed, broken, `Number ${i} nothing`, REV, NOW)).status).toBe("none");
    expect((await ask(keyed, broken, "Number 61 nothing", REV, NOW)).status).toBe("limited");
    expect((await ask(keyed, broken, "Number 61 nothing", { via: "review", key: "rev:b@example.org" }, NOW)).status).toBe("none");
    expect((await asks()).some((r) => r.status === "limited" && r.reason === "hour")).toBe(true);
  });
  it("14. the daily cap stops new model calls but not cached answers", async () => {
    await seed();
    const c = await sourceOf(SAY);
    const bodies: string[] = [];
    const m = model(good(c.chunk), bodies);
    await ask(keyed, m, Q, REV, NOW);
    await env.WIKI.prepare("INSERT INTO kb_counters (name, n) VALUES (?1, 300) ON CONFLICT(name) DO UPDATE SET n = 300").bind(`ask:d:${new Date(NOW).toISOString().slice(0, 10)}`).run();
    expect((await ask(keyed, m, Q, REV, NOW + 1000)).cached).toBe(true);
    const a = await ask(keyed, m, "Another strength question", REV, NOW + 2000);
    expect(a.status).toBe("limited");
    expect(bodies).toHaveLength(1);
  });
  it("15. an English word reaches a passage through the glossary", async () => {
    await saying(SAY, "Slow stuff", null);
    await word("Testword", "river");
    await syncSiteSources(env, NOW);
    const bodies: string[] = [];
    await ask(keyed, model({ status: "none" }, bodies), "Tell me about a river", REV, NOW);
    expect(bodies[0]).toContain("Paite saying (Pau Upa, idiom): Testword alpha");
  });
  it("16. the reviewer route needs sign-in; the public route needs WIKI_PUBLIC", async () => {
    await seed();
    const post = (path: string, e: any, deps = fakeDeps()) => createApp(deps)(new Request(`https://paite.lamkalabs.com${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ q: Q }) }), e);
    const signed = fakeDeps({ verifyReviewer: async () => "rev@example.org", fetch: model({ status: "none" }) });
    const r = await post("/review/api/ask", keyed, signed);
    expect(r.status).toBe(200);
    expect(((await r.json()) as any).status).toBe("none");
    expect((await post("/review/api/ask", keyed)).status).toBe(401);
    const off = await post("/api/ask", keyed, fakeDeps({ fetch: model({ status: "none" }) }));
    expect(off.status).not.toBe(200);
    const on = await post("/api/ask", { ...keyed, WIKI_PUBLIC: "1" }, fakeDeps({ fetch: model({ status: "none" }) }));
    expect(on.status).toBe(200);
    expect(((await on.json()) as any).status).toBe("none");
  });
  it("17. flags are one per person per answer and bad input is refused", async () => {
    await seed();
    const a = await ask(keyed, model({ status: "none" }), Q, REV, NOW);
    expect(await flagAnswer(env, a.askId, true, "good", "rev:a", NOW)).toBe(true);
    expect(await flagAnswer(env, a.askId, false, null, "rev:a", NOW + 1)).toBe(true);
    expect(await flagAnswer(env, a.askId, true, null, "rev:b", NOW)).toBe(true);
    const rows = (await env.WIKI.prepare("SELECT by_key, right FROM kb_flags ORDER BY by_key").all<any>()).results;
    expect(rows).toEqual([{ by_key: "rev:a", right: 0 }, { by_key: "rev:b", right: 1 }]);
    expect(await flagAnswer(env, 999999, true, null, "rev:a", NOW)).toBe(false);
    expect(await flagAnswer(env, a.askId, "yes", null, "rev:a", NOW)).toBe(false);
    expect(await flagAnswer(env, "1", true, null, "rev:a", NOW)).toBe(false);
  });
});
