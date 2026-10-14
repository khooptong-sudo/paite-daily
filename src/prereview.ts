import type { Env } from "./types";

const FLAGS = ["ok", "tedim_style", "english", "junk"];

const SYSTEM = `You check Paite (Zomi, ISO 639-3 pck) translations of an English sentence for human reviewers. You never decide correctness; a human decides.
Reply with JSON only: {"answers":[{"id":<int>,"note":"<max 140 chars, English>","flag":"ok|tedim_style|english|junk"}],"agree":true|false}
flag "tedim_style": the answer uses Tedim/Bible-style markers: nong, hiam (question), zong (even), or a final hi on a statement. Modern Paite uses hia, le, and often no final hi.
flag "english": the answer is English instead of Paite.
flag "junk": gibberish, spam or unrelated text.
flag "ok": none of the above.
"agree": true when the answers mean the same thing.`;

type Row = { id: number; sentence_id: number; english: string; paite: string; ai_note: string | null };

async function noteSentence(env: Env, fetcher: typeof fetch, rows: Row[]): Promise<void> {
  const res = await fetcher("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: { authorization: `Bearer ${env.DEEPSEEK_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: "deepseek-chat",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: `English: ${rows[0].english}\nAnswers: ${JSON.stringify(rows.map((r) => ({ id: r.id, paite: r.paite })))}` },
      ],
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`DeepSeek ${res.status}`);
  const out = JSON.parse(((await res.json()) as any).choices[0].message.content);
  const sent = new Set(rows.map((r) => r.id));
  const stmts: D1PreparedStatement[] = [];
  for (const a of Array.isArray(out.answers) ? out.answers : []) {
    if (!sent.has(a?.id) || rows.find((r) => r.id === a.id)!.ai_note !== null || typeof a.note !== "string" || !FLAGS.includes(a.flag)) continue;
    stmts.push(env.DB.prepare("UPDATE answers SET ai_note = ?1, ai_flag = ?2 WHERE id = ?3 AND ai_note IS NULL").bind(a.note.trim().slice(0, 140), a.flag, a.id));
  }
  if (!stmts.length) throw new Error("no valid answers");
  if (typeof out.agree === "boolean") stmts.push(env.DB.prepare("UPDATE sentences SET ai_agree = ?1 WHERE id = ?2").bind(out.agree ? 1 : 0, rows[0].sentence_id));
  await env.DB.batch(stmts);
}

export async function runPrereview(env: Env, fetcher: typeof fetch): Promise<{ noted: number; failed: number } | null> {
  if (!env.DEEPSEEK_API_KEY) return null;
  const { results } = await env.DB.prepare(
    `SELECT a.id, a.sentence_id, s.english, a.paite, a.ai_note FROM answers a JOIN sentences s ON s.id = a.sentence_id
     WHERE a.status IN ('new', 'accepted') AND a.sentence_id IN
       (SELECT sentence_id FROM (SELECT sentence_id FROM answers WHERE ai_note IS NULL AND status = 'new' ORDER BY id LIMIT 50))
     ORDER BY a.id`,
  ).all<Row>();
  if (!results.some((r) => r.ai_note === null)) return null;
  const bySentence = new Map<number, Row[]>();
  for (const r of results) bySentence.set(r.sentence_id, [...(bySentence.get(r.sentence_id) ?? []), r]);
  let noted = 0, failed = 0;
  for (const rows of bySentence.values()) {
    try { await noteSentence(env, fetcher, rows); noted += rows.filter((r) => r.ai_note === null).length; } catch (e) { console.error("prereview", String(e)); failed += rows.filter((r) => r.ai_note === null).length; }
  }
  return { noted, failed };
}
