import { normaliseEnglish } from "./text";
import { gapWords } from "./gaps";
import type { Env } from "./types";

export const TOPICS = ["home", "market", "church", "farming", "school", "health", "weather", "travel", "family", "feelings", "food and cooking", "animals", "festivals", "work", "money", "sports", "the village", "the city", "phone and internet", "children", "elders", "greetings", "time and days", "clothes", "the body", "nature and forest", "rain and seasons", "friendship", "shopping", "the road and transport"];

// One refill at a time across the cron and on-demand paths. Atomic: the upsert only takes an expired lock.
export async function acquireRefillLock(db: D1Database, now: number): Promise<boolean> {
  const r = await db.prepare("INSERT INTO job_locks (name, expires_at) VALUES ('refill', ?1 + 120000) ON CONFLICT(name) DO UPDATE SET expires_at = excluded.expires_at WHERE job_locks.expires_at < ?1").bind(now).run();
  return r.meta.changes === 1;
}

const releaseRefillLock = (db: D1Database) => db.prepare("UPDATE job_locks SET expires_at = 0 WHERE name = 'refill'").run();

// Daily safety cap on forced refills (40 x 50 = about 2,000 sentences). The count lives in job_locks.expires_at of a per-UTC-day row.
export const FORCED_PER_DAY = 40;
export async function takeForcedSlot(db: D1Database, now: number): Promise<boolean> {
  const r = await db.prepare("INSERT INTO job_locks (name, expires_at) VALUES (?1, 1) ON CONFLICT(name) DO UPDATE SET expires_at = expires_at + 1 WHERE expires_at < ?2")
    .bind("forced:" + new Date(now).toISOString().slice(0, 10), FORCED_PER_DAY).run();
  return r.meta.changes === 1;
}

// Returns null (no job row) when another refill holds the lock.
export async function lockedRefill(env: Env, fetcher: typeof fetch, now: number, topic?: string) {
  if (!env.DEEPSEEK_API_KEY || !(await acquireRefillLock(env.DB, now))) return null;
  try { return await runRefill(env, fetcher, now, topic); } finally { await releaseRefillLock(env.DB); }
}

// Phone ran out: refill in the background. True when a refill started or is already running.
export async function refillOnDemand(env: Env, now: number, ctx?: ExecutionContext): Promise<boolean> {
  if (!env.DEEPSEEK_API_KEY) return false;
  if (!(await acquireRefillLock(env.DB, now))) return true;
  if (!(await takeForcedSlot(env.DB, now))) { await releaseRefillLock(env.DB); return false; }
  const job = (async () => {
    // Short call: waitUntil lasts about 30 s after the response. No job_runs row: only cron runs count toward the failure alert.
    try { await runRefill(env, fetch, now, undefined, true, 20_000, 25); } catch (e) { console.error("refill on demand", e); } finally { await releaseRefillLock(env.DB); }
  })();
  if (ctx) ctx.waitUntil(job); else await job;
  return true;
}

export async function runRefill(env: Env, fetcher: typeof fetch, now: number, topic?: string, force = false, timeoutMs = 30_000, count = 50): Promise<{ topic: string; received: number; inserted: number } | null> {
  if (!env.DEEPSEEK_API_KEY) return null;
  const open = (await env.DB.prepare("SELECT count(*) AS n FROM sentences WHERE status = 'open' AND answer_count < 2 AND direction = 'en2pai'").first<{ n: number }>())!.n;
  if (!force && open >= 300) return null;
  // Every other unthemed refill asks for the common words that still have no verified
  // Paite example, so new sentences close the gaps instead of repeating covered words.
  const gaps = topic === undefined && Math.random() < .5 ? await gapWords(env.DB, now) : [];
  topic ??= gaps.length ? "gaps" : TOPICS[Math.floor(Math.random() * TOPICS.length)];
  const about = gaps.length ? `everyday life, each one using at least one of these words: ${gaps.join(", ")}` : `"${topic}"`;
  const res = await fetcher("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: { authorization: `Bearer ${env.DEEPSEEK_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: "deepseek-chat",
      response_format: { type: "json_object" },
      messages: [{
        role: "user",
        content: `Write exactly ${count} short, simple, everyday English sentences about ${about} for native Paite speakers to translate. Each sentence has 4-12 words, in the present or simple past tense. Use no names of real people, no religious doctrine, no numbers above twenty and no slang. Reply with JSON only: {"sentences":["..."]}`,
      }],
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`DeepSeek ${res.status}`);
  const out = JSON.parse(((await res.json()) as any).choices[0].message.content);
  const list: unknown[] = Array.isArray(out.sentences) ? out.sentences : [];
  const seen = new Set<string>();
  const keep: string[] = [];
  for (const x of list) {
    if (typeof x !== "string") continue;
    const t = x.trim();
    const k = normaliseEnglish(t);
    if (!t || t.length > 120 || /https?:|www\./i.test(t) || /\d+/.test(t) && (t.match(/\d+/g) ?? []).some((n) => Number(n) > 20) || seen.has(k)) continue;
    seen.add(k);
    keep.push(t);
    if (keep.length === count) break;
  }
  let inserted = 0;
  if (keep.length) {
    const rs = await env.DB.batch(keep.map((t) => env.DB.prepare("INSERT OR IGNORE INTO sentences (english, english_key, source) VALUES (?1, ?2, 'deepseek')").bind(t, normaliseEnglish(t))));
    inserted = rs.reduce((n, r) => n + (r.meta.changes ?? 0), 0);
  }
  return { topic, received: list.length, inserted };
}
