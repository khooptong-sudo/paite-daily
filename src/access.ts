import type { Env } from "./types";

// Who is a reviewer. Signing in is in login.ts.

export function isOwner(env: Env, email: string): boolean {
  return (env.OWNER_EMAIL ?? "").split(",").some((o) => o.trim() !== "" && o.trim().toLowerCase() === email);
}

/** The owner's name from the OWNER_NAME var; when set it wins over any reviewer entry for an owner email. */
const ownerName = (env: Env) => env.OWNER_NAME?.trim() || null;

let warned = false;
function secretMap(env: Env): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    const m = JSON.parse(env.REVIEWERS);
    if (!m || typeof m !== "object" || Array.isArray(m)) throw new Error("not an object");
    for (const [k, v] of Object.entries(m)) if (typeof v === "string" && k.trim()) out[k.trim().toLowerCase()] = v;
  } catch (e) {
    if (!warned) { warned = true; console.error("REVIEWERS secret is invalid, treated as empty", e); }
  }
  return out;
}

export type ReviewerEntry = { email: string; name: string; source: "secret" | "db" | "owner"; listed: boolean };

// listed = named in the secret or DB; owners without a name are reviewers but stay out of the public page and the digest.
// A reviewer is: a REVIEWERS secret entry, or an active reviewers row, or an owner. DB name wins. Read fresh on every call.
export async function activeReviewers(env: Env): Promise<ReviewerEntry[]> {
  const out = new Map<string, ReviewerEntry>();
  // A removed reviewers row wins over the REVIEWERS secret.
  const { results: rows } = await env.DB.prepare("SELECT email, name, removed_at FROM reviewers").all<{ email: string; name: string; removed_at: string | null }>();
  const removed = new Set(rows.filter((r) => r.removed_at).map((r) => r.email.toLowerCase()));
  for (const [email, name] of Object.entries(secretMap(env))) if (!removed.has(email)) out.set(email, { email, name, source: "secret", listed: true });
  const results = rows.filter((r) => !r.removed_at);
  for (const r of results) out.set(r.email.toLowerCase(), { email: r.email.toLowerCase(), name: r.name, source: "db", listed: true });
  for (const o of (env.OWNER_EMAIL ?? "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean)) {
    out.set(o, { email: o, name: ownerName(env) ?? out.get(o)?.name ?? "Owner", source: "owner", listed: out.has(o) });
  }
  return [...out.values()];
}

/**
 * For public output (the word list, the sayings page, their JSON, the corpus repo):
 * glossary.reviewed_by and proverbs.reviewed_by hold the reviewer's email, which must
 * never be shown. This turns one into the reviewer's name. Removed reviewers keep their
 * name on past work. An email with no known name becomes "a reviewer"; a value that is
 * not an email is already a name and passes through.
 */
export async function publicReviewerNames(env: Env): Promise<(v: string | null) => string | null> {
  const names = new Map<string, string>();
  const { results } = await env.DB.prepare("SELECT email, name FROM reviewers").all<{ email: string; name: string }>();
  for (const r of results) names.set(r.email.toLowerCase(), r.name);
  for (const r of await activeReviewers(env)) if (r.listed || !names.has(r.email) || (r.source === "owner" && ownerName(env))) names.set(r.email, r.name);
  return (v) => (v === null || v === "" ? null : !v.includes("@") ? v : names.get(v.trim().toLowerCase()) ?? "a reviewer");
}

export async function reviewerName(env: Env, email: string): Promise<string | null> {
  email = email.toLowerCase();
  if (isOwner(env, email) && ownerName(env)) return ownerName(env);
  const row = await env.DB.prepare("SELECT name, removed_at FROM reviewers WHERE email = ?1").bind(email).first<{ name: string; removed_at: string | null }>();
  if (row && !row.removed_at) return row.name;
  const s = row ? undefined : secretMap(env)[email];
  if (s !== undefined) return s;
  return isOwner(env, email) ? "Owner" : null;
}
