import { publicReviewerNames } from "./access";
import { addChunks, addSource, chunkText, decideSource, getSource, listSources, readChunks, readNewSource, sha256Hex, STATUSES, withdrawSource, type SourceStatus } from "./kb";
import { draftArticle, getArticle, listArticles, saveArticle, setStatus } from "./kbarticle";
import { dismissQuestion, listFlagged, listOpen } from "./kbask";
import { syncSiteSources } from "./kbsite";
import { addTests, autoTests, lastRuns, listTests, runReport, seedAttacks, setActive, startRun, stepRun } from "./kbtest";
import { cleanText, isId } from "./text";
import { json, type Env } from "./types";
const MAX_TEXT = 2_000_000;
const MAX_FILE = 52_428_800; // 50 MB
const CHUNKS_PER_CALL = 2000;
const FILE_TYPES = new Set([
  "application/pdf", "image/jpeg", "image/png", "image/tiff", "text/plain", "text/html",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);
const OWN_MESSAGE = "This is your own submission. Another reviewer will check it.";
const STATUS_OF: Record<string, number> = { not_found: 404, not_pending: 409, own_submission: 409, no_text: 409, already_withdrawn: 409, bad_request: 400 };
const ART_STATUS: Record<string, number> = { bad_request: 400, limited: 429, no_passages: 409, no_ai: 503, draft_failed: 422, not_found: 404, not_editable: 409, check_failed: 422, wrong_status: 409, own_submission: 409, stale: 409 };
function fail(error: string): Response {
  return json(error === "own_submission" ? { error, message: OWN_MESSAGE } : { error }, STATUS_OF[error] ?? 400);
}
/** Add a long list of passages in calls of at most 2,000, the most addChunks takes at once. */
async function addAll(env: Env, id: number, chunks: { text: string; locator: string | null }[]): Promise<number> {
  let added = 0;
  for (let i = 0; i < chunks.length; i += CHUNKS_PER_CALL) {
    const r = await addChunks(env, id, chunks.slice(i, i + CHUNKS_PER_CALL));
    if ("added" in r) added += r.added;
  }
  return added;
}
/**
 * The wiki endpoints shared by reviewers (/review/api/wiki/...) and admins (/admin/api/wiki/...).
 * The caller has already signed the person in; sub is the path after the prefix. Null means unknown path.
 */
export async function handleWikiApi(
  env: Env, method: string, sub: string, q: URLSearchParams, b: Record<string, unknown>, who: { email: string; owner: boolean }, now: number, fetcher: typeof fetch = fetch,
): Promise<Response | null> {
  if (!b || typeof b !== "object") b = {};
  // Who added, decided, wrote or published something goes out as the person's name, never their email.
  if (sub === "/sources" && method === "GET") {
    const status = q.get("status") ?? "pending";
    if (!STATUSES.includes(status as SourceStatus)) return json({ error: "bad_request" }, 400);
    const name = await publicReviewerNames(env);
    return json({ sources: (await listSources(env, status as SourceStatus)).map((s) => ({ ...s, added_by: name(s.added_by), decided_by: name(s.decided_by) })) });
  }
  if (sub === "/source" && method === "GET") {
    const id = Number(q.get("id"));
    const source = isId(id) ? await getSource(env, id) : null;
    if (!source) return json({ error: "not_found" }, 404);
    const name = await publicReviewerNames(env);
    return json({ source: { ...source, added_by: name(source.added_by), decided_by: name(source.decided_by) } });
  }
  if (sub === "/source" && method === "POST") {
    const s = readNewSource(b);
    if (!s) return json({ error: "bad_request" }, 400);
    let chunks: { text: string; locator: string | null }[] = [];
    if (b.text !== undefined && b.text !== null) {
      if (typeof b.text !== "string" || b.text.length > MAX_TEXT) return json({ error: "bad_request" }, 400);
      // Checked before the source is written, so a bad text never leaves an empty source behind.
      const ok = readChunks(chunkText(b.text).map((t) => ({ text: t })), Infinity);
      if (!ok) return json({ error: "bad_request" }, 400);
      chunks = ok;
    }
    const id = await addSource(env, s, who.email, now);
    return json({ id, chunks: await addAll(env, id, chunks) });
  }
  if (sub === "/sync" && method === "POST") return json({ result: await syncSiteSources(env, now) });
  if (sub === "/decide" && method === "POST") {
    if (!isId(b.id) || (b.decision !== "approve" && b.decision !== "reject")) return json({ error: "bad_request" }, 400);
    const r = await decideSource(env, b.id, b.decision, who, now);
    return "ok" in r ? json({ ok: true }) : fail(r.error);
  }
  if (sub === "/withdraw" && method === "POST") {
    if (!isId(b.id)) return json({ error: "bad_request" }, 400);
    let reason: string | null = null;
    if (b.reason !== undefined && b.reason !== null && b.reason !== "") {
      reason = cleanText(b.reason, 500);
      if (!reason) return json({ error: "bad_request" }, 400);
    }
    const r = await withdrawSource(env, b.id, who, reason, now);
    return "ok" in r ? json({ ok: true }) : fail(r.error);
  }
  if (sub === "/articles" && method === "GET") {
    const name = await publicReviewerNames(env);
    return json({ articles: (await listArticles(env)).map((a) => ({ ...a, createdBy: name(a.createdBy), publishedBy: name(a.publishedBy) })) });
  }
  if (sub === "/article" && method === "GET") {
    const id = Number(q.get("id"));
    const article = isId(id) ? await getArticle(env, id) : null;
    if (!article) return json({ error: "not_found" }, 404);
    const name = await publicReviewerNames(env);
    return json({ article: { ...article, createdBy: name(article.createdBy), publishedBy: name(article.publishedBy), revs: article.revs.map((v) => ({ ...v, author: name(v.author) })) } });
  }
  if (sub === "/articles/draft" && method === "POST") {
    const r = await draftArticle(env, fetcher, { title: b.title, topic: b.topic }, who, now);
    return "id" in r ? json({ id: r.id }) : json(r, ART_STATUS[r.error] ?? 400);
  }
  if (sub === "/articles/save" && method === "POST") {
    const r = await saveArticle(env, { id: b.id, blocks: b.blocks, note: b.note }, who, now);
    return "ok" in r ? json({ ok: true }) : json(r, ART_STATUS[r.error] ?? 400);
  }
  const act = /^\/articles\/(submit|publish|return|withdraw)$/.exec(sub);
  if (act && method === "POST") {
    const r = await setStatus(env, b.id, act[1] as "submit" | "publish" | "return" | "withdraw", who, now);
    return "ok" in r ? json({ ok: true }) : json(r, ART_STATUS[r.error] ?? 400);
  }
  if (sub === "/asks/flagged" && method === "GET") return json({ asks: await listFlagged(env) });
  if (sub === "/asks/open" && method === "GET") return json({ questions: await listOpen(env) });
  if (sub === "/asks/dismiss" && method === "POST") {
    return (await dismissQuestion(env, b.qKey, who.email, now)) ? json({ ok: true }) : json({ error: "bad_request" }, 400);
  }
  if (sub === "/tests" && method === "GET") return json({ tests: await listTests(env) });
  if (sub === "/tests/add" && method === "POST") {
    const r = await addTests(env, b.lines, who, now);
    return "error" in r ? json(r, 400) : json(r);
  }
  if (sub === "/tests/auto" && method === "POST") return json(await autoTests(env, b.n === undefined ? 20 : Number(b.n), who, now));
  if (sub === "/tests/attacks" && method === "POST") return json(await seedAttacks(env, who, now));
  if (sub === "/tests/active" && method === "POST") {
    return (await setActive(env, b.id, b.active)) ? json({ ok: true }) : json({ error: "bad_request" }, 400);
  }
  if (sub === "/tests/run" && method === "POST") {
    const r = await startRun(env, who, now);
    return "error" in r ? json(r, 409) : json(r);
  }
  if (sub === "/tests/step" && method === "POST") {
    const r = await stepRun(env, fetcher, b.runId, now);
    return "error" in r ? json(r, 404) : json(r);
  }
  if (sub === "/tests/runs" && method === "GET") return json({ runs: await lastRuns(env) });
  if (sub === "/tests/report" && method === "GET") {
    const report = await runReport(env, Number(q.get("run")));
    return report ? json({ report }) : json({ error: "not_found" }, 404);
  }
  return null;
}
/** Hash both sides first, so the comparison takes the same time whatever the token's length or content. */
async function sameToken(given: string, expected: string): Promise<boolean> {
  const [a, b] = await Promise.all([sha256Hex(given), sha256Hex(expected)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
/**
 * Ingest API for the owner's local scripts (plan 006). Off unless WIKI_INGEST_TOKEN is set to at least 32 characters.
 * Everything it creates is pending, added by "ingest", and still needs a reviewer's approval.
 */
export async function handleIngest(req: Request, env: Env, now: number): Promise<Response> {
  const notFound = () => json({ error: "not_found" }, 404);
  const token = env.WIKI_INGEST_TOKEN;
  if (!token || token.length < 32) return notFound();
  const auth = req.headers.get("Authorization") ?? "";
  const given = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!given || !(await sameToken(given, token))) return json({ error: "bad_token" }, 401);
  const url = new URL(req.url);
  const path = url.pathname;
  const body = async (): Promise<Record<string, unknown> | null> => {
    try {
      const v = await req.json();
      return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  };
  if (path === "/wiki/api/ingest/source" && req.method === "POST") {
    const b = await body();
    const s = b && readNewSource(b);
    if (!b || !s) return json({ error: "bad_request" }, 400);
    let chunks: { text: string; locator: string | null }[] = [];
    if (b.chunks !== undefined && b.chunks !== null) {
      const ok = readChunks(b.chunks);
      if (!ok) return json({ error: "bad_request" }, 400);
      chunks = ok;
    }
    const id = await addSource(env, s, "ingest", now);
    return json({ id, chunks: await addAll(env, id, chunks) });
  }
  if (path === "/wiki/api/ingest/chunks" && req.method === "POST") {
    const b = await body();
    if (!b || !isId(b.sourceId) || !Array.isArray(b.chunks)) return json({ error: "bad_request" }, 400);
    const r = await addChunks(env, b.sourceId, b.chunks as { text: string; locator?: string | null }[]);
    return "added" in r ? json({ added: r.added }) : fail(r.error);
  }
  if (path === "/wiki/api/ingest/file" && req.method === "PUT") {
    const id = Number(url.searchParams.get("sourceId"));
    if (!isId(id)) return json({ error: "bad_request" }, 400);
    const type = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!FILE_TYPES.has(type)) return json({ error: "bad_type" }, 415);
    const declared = Number(req.headers.get("content-length") ?? "0");
    if (declared > MAX_FILE) return json({ error: "too_large" }, 413);
    const src = await env.WIKI.prepare("SELECT kind, status, r2_key FROM kb_sources WHERE id = ?1").bind(id)
      .first<{ kind: string; status: string; r2_key: string | null }>();
    if (!src || src.kind === "site") return notFound();
    if (src.status !== "pending") return json({ error: "not_pending" }, 409);
    const data = await req.arrayBuffer();
    if (data.byteLength > MAX_FILE) return json({ error: "too_large" }, 413);
    const sha256 = await sha256Hex(data);
    const key = `sources/${id}/${sha256}`;
    await env.WIKI_FILES.put(key, data, { httpMetadata: { contentType: type } });
    await env.WIKI.prepare("UPDATE kb_sources SET r2_key = ?2, sha256 = ?3, updated_at = ?4 WHERE id = ?1").bind(id, key, sha256, now).run();
    // A replaced file is removed, so the bucket only ever holds what the row points to.
    if (src.r2_key && src.r2_key !== key) await env.WIKI_FILES.delete(src.r2_key);
    return json({ key, sha256, bytes: data.byteLength });
  }
  return notFound();
}
