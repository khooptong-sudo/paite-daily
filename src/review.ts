import { isOwner, reviewerName } from "./access";
import { failingJobs } from "./export";
import { waitingCounts } from "./digest";
import { getGlossary } from "./glossary";
import { isPhoneId } from "./text";
import { claimNext, decide, undo, type Decision } from "./reviewdb";
import { json, type Deps, type Env } from "./types";

export async function handleReview(req: Request, env: Env, deps: Deps): Promise<Response> {
  const email = await deps.verifyAccess(req, env);
  if (!email) return json({ error: "sign_in" }, 401);
  if (!reviewerName(env, email)) return json({ error: "not_a_reviewer" }, 403);
  const { pathname } = new URL(req.url);
  let b: Record<string, unknown> = {};
  if (req.method === "POST") { try { b = (await req.json()) as Record<string, unknown>; } catch {} }

  if (pathname === "/review/api/next" && req.method === "GET") {
    const card = await claimNext(env.DB, email, deps.now());
    return card ? json(card) : new Response(null, { status: 204 });
  }
  if (pathname === "/review/api/queue" && req.method === "GET") return json({ waiting: (await waitingCounts(env.DB, email, deps.now())).answers });
  if (pathname === "/review/api/glossary" && req.method === "GET") return json({ entries: await getGlossary(env, 20) });
  if (pathname === "/review/api/glossary/hide" && req.method === "POST") {
    if (!Number.isInteger(b.id)) return json({ error: "bad_request" }, 400);
    const r = await env.DB.prepare("UPDATE glossary SET hidden = 1 WHERE id = ?1").bind(b.id).run();
    return r.meta.changes ? json({ ok: true }) : json({ error: "not_found" }, 404);
  }
  if (pathname === "/review/api/decide" && req.method === "POST") {
    const ints = (x: unknown) => Array.isArray(x) && x.every(Number.isInteger);
    if (!Number.isInteger(b.sentenceId) || !["accept", "reject", "retire"].includes(b.decision as string) || !ints(b.answerIds) || (b.alsoCorrect !== undefined && !ints(b.alsoCorrect))) return json({ error: "bad_request" }, 400);
    const result = await decide(env.DB, email, deps.now(), b as unknown as Decision);
    if (result === "no_lock") return json({ error: "lock_lost" }, 409);
    if (result === "bad_answer") return json({ error: "bad_answer" }, 400);
    return json({ ok: true, reviewId: result });
  }
  if (pathname === "/review/api/undo" && req.method === "POST") {
    if (!isOwner(env, email)) return json({ error: "owner_only" }, 403);
    if (!Number.isInteger(b.reviewId)) return json({ error: "bad_request" }, 400);
    const result = await undo(env.DB, b.reviewId as number);
    return result === "ok" ? json({ ok: true }) : json({ error: result, reason: result }, result === "missing" ? 404 : 409);
  }
  if (pathname === "/review/api/me" && req.method === "GET") {
    return json({ name: reviewerName(env, email), owner: isOwner(env, email) });
  }
  if (pathname === "/review/api/link-phone" && req.method === "POST") {
    if (!isPhoneId(b.phoneId)) return json({ error: "bad_request" }, 400);
    await env.DB.prepare("INSERT INTO reviewer_phones (phone_id, reviewer_email) VALUES (?1, ?2) ON CONFLICT (phone_id) DO UPDATE SET reviewer_email = excluded.reviewer_email")
      .bind(b.phoneId.toLowerCase(), email).run();
    return json({ ok: true });
  }
  if (pathname === "/review/api/health" && req.method === "GET") {
    if (!isOwner(env, email)) return json({ error: "owner_only" }, 403);
    return json({ failing: (await failingJobs(env.DB)).map((f) => ({ job: f.job, lastAt: f.lastAt, detail: f.lastDetail })) });
  }
  return json({ error: "not_found" }, 404);
}
