import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { ask } from "../src/kbask";
import { sha256Hex, withdrawSource } from "../src/kb";
import { syncSiteSources } from "../src/kbsite";
import { fuse, hybridSearch, syncVectors } from "../src/kbvec";
import type { Env } from "../src/types";
import { NOW } from "./helpers";

// Bag-of-words hash vector: each lower-cased word adds 1 at hash(word) % 1024, then L2-normalised.
function vec(t: string): number[] {
  const v = new Array<number>(1024).fill(0);
  for (const w of t.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean)) {
    let h = 2166136261;
    for (const ch of w) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
    v[h % 1024] += 1;
  }
  const n = Math.sqrt(v.reduce((a, b) => a + b * b, 0)) || 1;
  return v.map((x) => x / n);
}
function fakes(opts: { aiThrows?: boolean } = {}) {
  const aiCalls: string[][] = [];
  const store = new Map<string, number[]>();
  const AI = { run: async (_m: string, { text }: { text: string[] }) => { aiCalls.push(text); if (opts.aiThrows) throw new Error("ai down"); return { data: text.map(vec) }; } };
  const WIKI_VECTORS = {
    upsert: async (items: { id: string; values: number[] }[]) => { for (const i of items) store.set(i.id, i.values); },
    deleteByIds: async (ids: string[]) => { for (const i of ids) store.delete(i); },
    query: async (v: number[], { topK }: { topK: number }) => ({
      matches: [...store].map(([id, w]) => ({ id, score: w.reduce((a, x, i) => a + x * v[i], 0) })).sort((a, b) => b.score - a.score).slice(0, topK),
    }),
  };
  return { e: { ...env, AI, WIKI_VECTORS } as unknown as Env, store, aiCalls };
}

async function saying(paite: string, english: string) {
  await env.DB.prepare("INSERT INTO proverbs (kind, paite, english, explainer, explainer_en, entered_from, status) VALUES ('idiom', ?1, ?2, NULL, NULL, 'pai2en', 'live')").bind(paite, english).run();
}
async function word(paite: string, english: string) {
  return (await env.DB.prepare("INSERT INTO glossary (paite, english, note, source, reviewed_by, hidden) VALUES (?1, ?2, NULL, 'test', 'rev@example.org', 0) RETURNING id").bind(paite, english).first<{ id: number }>())!.id;
}
async function addBook(title: string, text: string, status = "approved") {
  const s = await env.WIKI.prepare("INSERT INTO kb_sources (kind, title, url, rights, trust, status, added_by, created_at, updated_at) VALUES ('book', ?1, 'https://example.org/b', 'open', 2, ?2, 'x', 1, 1) RETURNING id").bind(title, status).first<{ id: number }>();
  const c = await env.WIKI.prepare("INSERT INTO kb_chunks (source_id, ordinal, locator, text, sha256) VALUES (?1, 1, 'p. 1', ?2, ?3) RETURNING id").bind(s!.id, text, await sha256Hex(text)).first<{ id: number }>();
  return { source: s!.id, chunk: c!.id };
}
const vecRows = async () => (await env.WIKI.prepare("SELECT chunk_id FROM kb_vectors ORDER BY chunk_id").all<{ chunk_id: number }>()).results.map((r) => r.chunk_id);
const three = async () => { await saying("Testword alpha", "Two heads"); await saying("Testword beta", "One road"); await saying("Testword gamma", "Many hands"); await syncSiteSources(env, NOW); };

describe("meaning search", () => {
  it("1. without the bindings the job is off and search is keyword only", async () => {
    await three();
    expect(await syncVectors(env, NOW)).toBeNull();
    const r = await hybridSearch(env, ["alpha"], "anything", 30);
    expect(r.vector).toBe("off");
    expect(r.hits).toHaveLength(1);
  });
  it("2. the first run embeds every passage; a second run does nothing", async () => {
    await three();
    const { e, store } = fakes();
    expect(await syncVectors(e, NOW)).toEqual({ embedded: 3, removed: 0, left: 0 });
    expect(store.size).toBe(3);
    expect(await syncVectors(e, NOW)).toBeNull();
  });
  it("3. an edited saying is re-embedded, only that one", async () => {
    await three();
    const { e } = fakes();
    await syncVectors(e, NOW);
    await env.DB.prepare("UPDATE proverbs SET english = 'Two good heads' WHERE paite = 'Testword alpha'").run();
    await syncSiteSources(env, NOW + 1);
    expect(await syncVectors(e, NOW + 2)).toEqual({ embedded: 1, removed: 0, left: 0 });
  });
  it("4. a hidden word and a withdrawn source are removed from the index and the table", async () => {
    const wid = await word("Testword delta", "Delta");
    await syncSiteSources(env, NOW);
    const book = await addBook("Book", "Some book words");
    const { e, store } = fakes();
    await syncVectors(e, NOW);
    expect(store.size).toBe(2);
    await env.DB.prepare("UPDATE glossary SET hidden = 1 WHERE id = ?1").bind(wid).run();
    await syncSiteSources(env, NOW + 1);
    await withdrawSource(env, book.source, { email: "rev@example.org" }, null, NOW + 1);
    expect(await syncVectors(e, NOW + 2)).toEqual({ embedded: 0, removed: 2, left: 0 });
    expect(store.size).toBe(0);
    expect(await vecRows()).toEqual([]);
  });
  it("5. the per-run limit is respected", async () => {
    for (let i = 1; i <= 5; i++) await saying(`Testword n${i}`, `English ${i}`);
    await syncSiteSources(env, NOW);
    const { e } = fakes();
    expect(await syncVectors(e, NOW, 2)).toEqual({ embedded: 2, removed: 0, left: 3 });
    expect(await syncVectors(e, NOW, 2)).toEqual({ embedded: 2, removed: 0, left: 1 });
    expect(await syncVectors(e, NOW, 2)).toEqual({ embedded: 1, removed: 0, left: 0 });
    expect(await syncVectors(e, NOW, 2)).toBeNull();
  });
  it("6. a passage with no shared keyword is found by meaning", async () => {
    // The terms match nothing, so keyword search is empty. The question shares words with one passage
    // ("respect", "elders"), so the fake bag-of-words vectors put that passage nearest.
    const near = await addBook("Elders", "Elders deserve respect always");
    await addBook("Rain", "Rain falls on the hills");
    const { e } = fakes();
    await syncVectors(e, NOW);
    const r = await hybridSearch(e, ["zzzz"], "respect for elders", 30);
    expect(r.vector).toBe("used");
    expect(r.hits.map((h) => h.chunkId)).toEqual([near.chunk]);
    expect((await hybridSearch(env, ["zzzz"], "respect for elders", 30)).hits).toEqual([]);
  });
  it("7. a vector for a withdrawn or pending source is never returned", async () => {
    const a = await addBook("A", "Elders deserve respect always");
    const b = await addBook("B", "Respect elders every day");
    const { e } = fakes();
    await syncVectors(e, NOW);
    expect((await hybridSearch(e, ["zzzz"], "respect elders", 30)).hits).toHaveLength(2);
    await env.WIKI.prepare("UPDATE kb_sources SET status = 'withdrawn' WHERE id = ?1").bind(a.source).run();
    await env.WIKI.prepare("UPDATE kb_sources SET status = 'pending' WHERE id = ?1").bind(b.source).run();
    expect((await hybridSearch(e, ["zzzz"], "respect elders", 30)).hits).toEqual([]);
  });
  it("8. fuse ranks by reciprocal rank, the shared id first", () => {
    // 3: 1/63 + 1/61; 1: 1/61; 4: 1/62; 2: 1/62 -> 3, 1, 2, 4 (1/61 > 1/62; 2 and 4 tie, keyword first)
    expect(fuse([1, 2, 3], [3, 4])).toEqual([3, 1, 2, 4]);
  });
  it("9. when the model is down, keyword hits still come back and ask still answers", async () => {
    await saying("Testword alpha", "Sharing brings strength");
    await syncSiteSources(env, NOW);
    const { e } = fakes({ aiThrows: true });
    const r = await hybridSearch(e, ["strength"], "What brings strength?", 30);
    expect(r.vector).toBe("failed");
    expect(r.hits).toHaveLength(1);
    const chunk = r.hits[0].chunkId;
    const reply = { status: "answer", parts: [{ type: "text", text: "It says this." }, { type: "quote", chunk, text: "Testword alpha" }], sources: [chunk] };
    const fetcher = (async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(reply) } }] }))) as unknown as typeof fetch;
    const a = await ask({ ...e, DEEPSEEK_API_KEY: "k" } as Env, fetcher, "What brings strength?", { via: "review", key: "rev:a@example.org" }, NOW);
    expect(a.status).toBe("answer");
  });
  it("10. a failing model throws and records nothing", async () => {
    await three();
    const { e } = fakes({ aiThrows: true });
    await expect(syncVectors(e, NOW)).rejects.toThrow("ai down");
    expect(await vecRows()).toEqual([]);
  });
});
