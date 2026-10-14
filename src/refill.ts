import { normaliseEnglish } from "./text";
import type { Env } from "./types";

const TOPICS = ["home", "market", "church", "farming", "school", "health", "weather", "travel", "family", "feelings"];

export async function runRefill(env: Env, fetcher: typeof fetch, now: number): Promise<{ topic: string; received: number; inserted: number } | null> {
  if (!env.DEEPSEEK_API_KEY) return null;
  const open = (await env.DB.prepare("SELECT count(*) AS n FROM sentences WHERE status = 'open' AND direction = 'en2pai'").first<{ n: number }>())!.n;
  if (open >= 300) return null;
  const topic = TOPICS[Math.floor(now / 86_400_000) % TOPICS.length];
  const res = await fetcher("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: { authorization: `Bearer ${env.DEEPSEEK_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: "deepseek-chat",
      response_format: { type: "json_object" },
      messages: [{
        role: "user",
        content: `Write exactly 50 short, simple, everyday English sentences about "${topic}" for native Paite speakers to translate. Each sentence has 4-12 words, in the present or simple past tense. Use no names of real people, no religious doctrine, no numbers above twenty and no slang. Reply with JSON only: {"sentences":["..."]}`,
      }],
    }),
    signal: AbortSignal.timeout(30_000),
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
    if (keep.length === 50) break;
  }
  let inserted = 0;
  if (keep.length) {
    const rs = await env.DB.batch(keep.map((t) => env.DB.prepare("INSERT OR IGNORE INTO sentences (english, english_key, source) VALUES (?1, ?2, 'deepseek')").bind(t, normaliseEnglish(t))));
    inserted = rs.reduce((n, r) => n + (r.meta.changes ?? 0), 0);
  }
  return { topic, received: list.length, inserted };
}
