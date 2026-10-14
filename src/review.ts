import { isOwner, reviewerName } from "./access";
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
  if (pathname === "/review/api/decide" && req.method === "POST") {
    const ints = (x: unknown) => Array.isArray(x) && x.every(Number.isInteger);
    if (!Number.isInteger(b.sentenceId) || !["accept", "reject", "retire"].includes(b.decision as string) || !ints(b.answerIds) || (b.alsoCorrect !== undefined && !ints(b.alsoCorrect))) return json({ error: "bad_request" }, 400);
    const result = await decide(env.DB, email, deps.now(), b as unknown as Decision);
    if (result === "no_lock") return json({ error: "lock_lost" }, 409);
    if (result === "bad_answer") return json({ error: "bad_answer" }, 400);
    return json({ ok: true });
  }
  if (pathname === "/review/api/undo" && req.method === "POST") {
    if (!isOwner(env, email)) return json({ error: "owner_only" }, 403);
    if (!Number.isInteger(b.reviewId)) return json({ error: "bad_request" }, 400);
    const result = await undo(env.DB, b.reviewId as number);
    return result === "ok" ? json({ ok: true }) : json({ error: result }, result === "missing" ? 404 : 409);
  }
  if (pathname === "/review/api/me" && req.method === "GET") {
    return json({ name: reviewerName(env, email), owner: isOwner(env, email) });
  }
  return json({ error: "not_found" }, 404);
}
