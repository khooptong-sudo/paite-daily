import { searchChunks, type Hit } from "./kb";
import type { Env } from "./types";

export const VEC = { model: "@cf/baai/bge-m3", perRun: 300, batch: 50, topK: 20, minScore: 0.45, maxChars: 2000 } as const;

/** One 1,024-number vector per text, or null when Workers AI is not bound. */
export async function embed(env: Env, texts: string[]): Promise<number[][] | null> {
  if (!env.AI) return null;
  const out = (await env.AI.run(VEC.model, { text: texts.map((t) => t.slice(0, VEC.maxChars)) })) as { data?: number[][] };
  if (!Array.isArray(out?.data) || out.data.length !== texts.length) throw new Error("embedding reply has the wrong shape");
  return out.data;
}

const NEEDS = `FROM kb_chunks c JOIN kb_sources s ON s.id = c.source_id LEFT JOIN kb_vectors v ON v.chunk_id = c.id
  WHERE s.status = 'approved' AND (v.chunk_id IS NULL OR v.sha256 <> c.sha256)`;

/** Keep the vector index in step with the approved passages. Null when there was nothing to do. */
export async function syncVectors(env: Env, now: number, limit: number = VEC.perRun): Promise<{ embedded: number; removed: number; left: number } | null> {
  const ai = env.AI, index = env.WIKI_VECTORS;
  if (!ai || !index) return null;
  let removed = 0, embedded = 0;

  const gone = (await env.WIKI.prepare(
    `SELECT v.chunk_id AS id FROM kb_vectors v LEFT JOIN kb_chunks c ON c.id = v.chunk_id LEFT JOIN kb_sources s ON s.id = c.source_id
      WHERE c.id IS NULL OR s.status <> 'approved' LIMIT 1000`,
  ).all<{ id: number }>()).results.map((r) => r.id);
  if (gone.length) {
    await index.deleteByIds(gone.map(String));
    await env.WIKI.batch(gone.map((id) => env.WIKI.prepare("DELETE FROM kb_vectors WHERE chunk_id = ?1").bind(id)));
    removed = gone.length;
  }

  const todo = (await env.WIKI.prepare(`SELECT c.id, c.text, c.sha256 ${NEEDS} ORDER BY c.id LIMIT ?1`).bind(limit).all<{ id: number; text: string; sha256: string }>()).results;
  for (let i = 0; i < todo.length; i += VEC.batch) {
    const group = todo.slice(i, i + VEC.batch);
    const vectors = (await embed(env, group.map((c) => c.text)))!;
    await index.upsert(group.map((c, j) => ({ id: String(c.id), values: vectors[j] })));
    await env.WIKI.batch(group.map((c) => env.WIKI.prepare("INSERT OR REPLACE INTO kb_vectors (chunk_id, sha256, at) VALUES (?1, ?2, ?3)").bind(c.id, c.sha256, now)));
    embedded += group.length;
  }

  const left = (await env.WIKI.prepare(`SELECT COUNT(*) AS n ${NEEDS}`).first<{ n: number }>())!.n;
  return embedded + removed === 0 ? null : { embedded, removed, left };
}

/** Reciprocal rank fusion of two ranked id lists; ties keep keyword order, then vector order. */
export function fuse(keywordIds: number[], vectorIds: number[]): number[] {
  const score = new Map<number, number>();
  for (const list of [keywordIds, vectorIds]) list.forEach((id, i) => score.set(id, (score.get(id) ?? 0) + 1 / (60 + i + 1)));
  const order = [...new Set([...keywordIds, ...vectorIds])];
  return order.map((id, i) => ({ id, i })).sort((a, b) => score.get(b.id)! - score.get(a.id)! || a.i - b.i).map((x) => x.id);
}

/** Keyword search merged with meaning search. Without the bindings, or if they fail, keyword hits only. */
export async function hybridSearch(env: Env, terms: string[], question: string, limit = 30): Promise<{ hits: Hit[]; vector: "used" | "off" | "failed" }> {
  const keyword = await searchChunks(env, terms, limit);
  if (!env.AI || !env.WIKI_VECTORS) return { hits: keyword, vector: "off" };
  let ids: number[];
  try {
    const [qv] = (await embed(env, [question]))!;
    const res = await env.WIKI_VECTORS.query(qv, { topK: VEC.topK });
    ids = res.matches.filter((m) => m.score >= VEC.minScore).map((m) => Number(m.id));
  } catch (e) {
    console.error("vector search", String(e));
    return { hits: keyword, vector: "failed" };
  }
  const have = new Set(keyword.map((h) => h.chunkId));
  const extra = ids.filter((id) => !have.has(id));
  const byId = new Map<number, Hit>(keyword.map((h) => [h.chunkId, h]));
  if (extra.length) {
    const { results } = await env.WIKI.prepare(
      `SELECT c.id AS chunkId, c.text, c.locator, s.id AS sourceId, s.title, s.kind, s.trust, s.url, s.author, s.year, s.rights, 0 AS score
         FROM kb_chunks c JOIN kb_sources s ON s.id = c.source_id
        WHERE c.id IN (${extra.map((_, i) => `?${i + 1}`).join(",")}) AND s.status = 'approved'`,
    ).bind(...extra).all<Hit>();
    for (const h of results) byId.set(h.chunkId, h);
  }
  const vectorIds = ids.filter((id) => byId.has(id));
  const hits = fuse(keyword.map((h) => h.chunkId), vectorIds).slice(0, limit).map((id) => byId.get(id)!);
  return { hits, vector: "used" };
}
