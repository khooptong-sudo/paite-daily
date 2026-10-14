import { reviewerName } from "./access";
import { normaliseEnglish } from "./text";
import type { Env } from "./types";

export function toBase64Utf8(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

type Row = {
  review_id: number; sentence_id: number; english: string; final_paite: string; register: string;
  reviewer_email: string; created_at: string; contributor_name: string | null; explanation: string | null;
};

const ghHeaders = (env: Env) => ({
  authorization: `Bearer ${env.GITHUB_TOKEN}`,
  accept: "application/vnd.github+json",
  "user-agent": "paite-daily",
});

// Build the file for reviews first..last and PUT it. Marks the exports row done only when GitHub holds the file.
async function putRange(env: Env, fetcher: typeof fetch, exportId: number, first: number, last: number): Promise<{ n: number; path: string }> {
  const path = `community/verified-${first}-${last}.jsonl`;
  const { results } = await env.DB.prepare(
    `SELECT r.id AS review_id, s.id AS sentence_id, s.english, r.final_paite, r.register, r.reviewer_email, r.created_at,
            a.contributor_name, a.explanation
     FROM reviews r
     JOIN sentences s ON s.id = r.sentence_id
     LEFT JOIN answers a ON a.id = r.accepted_answer_id
     WHERE r.id BETWEEN ?1 AND ?2 AND r.decision = 'accept' AND r.undone_at IS NULL
     ORDER BY r.id`,
  ).bind(first, last).all<Row>();
  if (results.length === 0) {
    await env.DB.prepare("UPDATE exports SET done = 1 WHERE id = ?1").bind(exportId).run();
    return { n: 0, path };
  }

  // one query per 50 sentences for the also-correct answers
  const also = new Map<number, string[]>();
  const sids = [...new Set(results.map((r) => r.sentence_id))];
  for (let i = 0; i < sids.length; i += 50) {
    const chunk = sids.slice(i, i + 50);
    const rows = await env.DB.prepare(
      `SELECT sentence_id, paite FROM answers WHERE status = 'also_correct' AND sentence_id IN (${chunk.map((_, j) => `?${j + 1}`).join(",")}) ORDER BY id`,
    ).bind(...chunk).all<{ sentence_id: number; paite: string }>();
    for (const x of rows.results) also.set(x.sentence_id, [...(also.get(x.sentence_id) ?? []), x.paite]);
  }
  const lines = results.map((row) => JSON.stringify({
    id: `community:${row.sentence_id}`,
    english: row.english,
    paite: row.final_paite,
    register: row.register,
    contributor: row.contributor_name ?? "",
    verified_by: reviewerName(env, row.reviewer_email.toLowerCase()) ?? "Reviewer",
    verified_at: row.created_at,
    licence: "CC0-1.0",
    also_correct: also.get(row.sentence_id) ?? [],
    explanation: row.explanation,
  }));

  const url = `https://api.github.com/repos/${env.CORPUS_REPO}/contents/${path}`;
  const res = await fetcher(url, {
    method: "PUT",
    headers: { ...ghHeaders(env), "content-type": "application/json" },
    body: JSON.stringify({
      message: `community: ${results.length} verified sentences (reviews ${first}-${last})`,
      content: toBase64Utf8(lines.join("\n") + "\n"),
      branch: env.CORPUS_BRANCH,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    // 422 can mean "file exists" (an earlier run saved it). Trust it only if the file can be read back.
    if (res.status !== 422) throw new Error(`GitHub PUT ${res.status}`);
    const check = await fetcher(`${url}?ref=${encodeURIComponent(env.CORPUS_BRANCH)}`, { headers: ghHeaders(env), signal: AbortSignal.timeout(15_000) });
    if (check.status !== 200) throw new Error("GitHub PUT 422");
  }
  await env.DB.prepare("UPDATE exports SET done = 1 WHERE id = ?1").bind(exportId).run();
  return { n: results.length, path };
}

export async function exportVerified(env: Env, fetcher: typeof fetch): Promise<{ exported: number; path: string | null }> {
  let exported = 0;
  let path: string | null = null;
  // First finish every reserved range that GitHub may not hold yet.
  const pending = await env.DB.prepare("SELECT id, first_review_id, last_review_id FROM exports WHERE done = 0 ORDER BY id")
    .all<{ id: number; first_review_id: number; last_review_id: number }>();
  for (const p of pending.results) {
    const r = await putRange(env, fetcher, p.id, p.first_review_id, p.last_review_id);
    exported += r.n;
    if (r.n) path = r.path;
  }

  const last = (await env.DB.prepare("SELECT COALESCE(MAX(last_review_id), 0) AS n FROM exports").first<{ n: number }>())!.n;
  const range = await env.DB.prepare(
    "SELECT MIN(id) AS first, MAX(id) AS last FROM reviews WHERE id > ?1 AND decision = 'accept' AND undone_at IS NULL",
  ).bind(last).first<{ first: number | null; last: number | null }>();
  if (range?.first == null || range.last == null) return { exported, path };

  // Reserve the range BEFORE the PUT so a crash can never publish these reviews under a second path.
  // A tiny race remains: an undo between the SELECT above and this INSERT can still land. Out of scope.
  const { first, last: lastId } = range;
  const row = await env.DB.prepare("INSERT INTO exports (first_review_id, last_review_id, path, done) VALUES (?1, ?2, ?3, 0) RETURNING id")
    .bind(first, lastId, `community/verified-${first}-${lastId}.jsonl`).first<{ id: number }>();
  const r = await putRange(env, fetcher, row!.id, first, lastId);
  return { exported: exported + r.n, path: r.path };
}

export async function retireOwnerTranslations(env: Env, fetcher: typeof fetch): Promise<number> {
  const url = `https://raw.githubusercontent.com/${env.CORPUS_REPO}/${env.CORPUS_BRANCH}/corrections.json`;
  const res = await fetcher(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`corrections.json ${res.status}`);
  const data = (await res.json()) as { corrections: { english: string; status: string }[] };
  const keys = [...new Set(data.corrections.filter((c) => c.status === "verified").map((c) => normaliseEnglish(c.english)))];
  let retired = 0;
  for (let i = 0; i < keys.length; i += 50) {
    const chunk = keys.slice(i, i + 50);
    const r = await env.DB.prepare(
      `UPDATE sentences SET status = 'retired'
       WHERE status = 'open' AND answer_count = 0 AND english_key IN (${chunk.map((_, j) => `?${j + 1}`).join(",")})`,
    ).bind(...chunk).run();
    retired += r.meta.changes;
  }
  return retired;
}

export async function logged(env: Env, job: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    const result = await fn();
    if (result === null) return; // nothing ran, no row
    await env.DB.prepare("INSERT INTO job_runs (job, ok, detail) VALUES (?1, 1, ?2)").bind(job, JSON.stringify(result)).run();
  } catch (e) {
    console.error(job, e);
    await env.DB.prepare("INSERT INTO job_runs (job, ok, detail) VALUES (?1, 0, ?2)").bind(job, String(e)).run();
    await alertIfSecondFailure(env, job);
  }
}

// Jobs whose two most recent runs both failed.
export async function failingJobs(db: D1Database): Promise<{ job: string; lastDetail: string; lastAt: string }[]> {
  const { results } = await db.prepare(
    `SELECT job, ok, detail, created_at FROM (
       SELECT job, ok, detail, created_at, ROW_NUMBER() OVER (PARTITION BY job ORDER BY id DESC) AS rn FROM job_runs
     ) WHERE rn <= 2 ORDER BY job, rn`,
  ).all<{ job: string; ok: number; detail: string | null; created_at: string }>();
  const out: { job: string; lastDetail: string; lastAt: string }[] = [];
  for (let i = 0; i + 1 < results.length; i++) {
    const [a, b] = [results[i], results[i + 1]];
    if (a.job === b.job && a.ok === 0 && b.ok === 0) out.push({ job: a.job, lastDetail: (a.detail ?? "").slice(0, 200), lastAt: a.created_at });
  }
  return out;
}

// One email per failure streak: sent on the 2nd consecutive failure only. Never throws.
async function alertIfSecondFailure(env: Env, job: string): Promise<void> {
  try {
    const to = (env.OWNER_EMAIL ?? "").split(",").map((o) => o.trim()).filter(Boolean);
    if (!env.ALERT_EMAIL || to.length === 0) return;
    const { results } = await env.DB.prepare("SELECT ok, detail, created_at FROM job_runs WHERE job = ?1 ORDER BY id DESC LIMIT 3")
      .bind(job).all<{ ok: number; detail: string | null; created_at: string }>();
    if (results.length < 2 || results[0].ok !== 0 || results[1].ok !== 0 || results[2]?.ok === 0) return;
    await env.ALERT_EMAIL.send({
      from: "alerts@alerts.lamkalabs.com",
      to,
      subject: `Paite Daily: ${job} failed twice`,
      text: `Job: ${job}
Time: ${results[0].created_at}
Detail: ${(results[0].detail ?? "").slice(0, 200)}

https://paite.lamkalabs.com/review`,
    });
  } catch (e) {
    console.error("alert email", e);
  }
}

export async function runNightly(env: Env, fetcher: typeof fetch): Promise<void> {
  await logged(env, "export", () => exportVerified(env, fetcher));
  await logged(env, "retire_owner", () => retireOwnerTranslations(env, fetcher));
}
