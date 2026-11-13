import { isOwner, reviewerName } from "./access";
import type { Env } from "./types";

// A reviewer does not check their own work. A submission is theirs when it came from a phone
// linked to their reviewer account (reviewer_phones), or carries their public name (case and
// spaces ignored). Such a card (a sentence, saying, word or recording) goes to the other
// reviewers. If nobody else has checked it after OWN_DAYS, it comes back to its author, so a
// quiet week cannot strand it. The owner is exempt.

export const OWN_DAYS = 14;

/** Who is reviewing, ready to bind into the own-submission SQL. */
export type Me = { email: string; name: string; owner: 0 | 1; now: number };

export const normName = (s: string) => s.toLowerCase().replace(/\s+/g, "");

export async function whoReviews(env: Env, email: string, now: number): Promise<Me> {
  const e = email.trim().toLowerCase();
  const owner = isOwner(env, e);
  return { email: e, name: owner ? "" : normName((await reviewerName(env, e)) ?? ""), owner: owner ? 1 : 0, now };
}

/**
 * SQL that is true when a row is this reviewer's own, fresh submission. The four numbers are the
 * parameter slots holding me.email, me.name, me.owner and me.now. Every column is COALESCEd, so
 * NOT (...) never turns NULL and drops a row by accident.
 */
export function ownSql(phone: string, name: string, created: string, slot: { e: number; n: number; o: number; t: number }): string {
  return `(?${slot.o} = 0
    AND COALESCE(${created}, '') > datetime(?${slot.t} / 1000, 'unixepoch', '-${OWN_DAYS} days')
    AND (COALESCE(lower(${phone}), '') IN (SELECT lower(phone_id) FROM reviewer_phones WHERE lower(reviewer_email) = ?${slot.e})
      OR (?${slot.n} <> '' AND lower(replace(COALESCE(${name}, ''), ' ', '')) = ?${slot.n})))`;
}

/** The values for those slots, in slot order e, n, o, t when the slots are consecutive. */
export const ownBinds = (me: Me) => [me.email, me.name, me.owner, me.now];

/** How many of this reviewer's own submissions are waiting for someone else, across every queue. */
export async function ownWaiting(db: D1Database, me: Me): Promise<number> {
  if (me.owner) return 0;
  const s = { e: 1, n: 2, o: 3, t: 4 };
  const r = await db.prepare(
    `SELECT
       (SELECT count(*) FROM answers a JOIN sentences x ON x.id = a.sentence_id
          WHERE a.status = 'new' AND x.status IN ('open', 'full') AND ${ownSql("a.phone_id", "a.contributor_name", "a.created_at", s)})
     + (SELECT count(*) FROM word_submissions w WHERE w.status = 'pending' AND ${ownSql("w.phone_id", "w.contributor_name", "w.created_at", s)})
     + (SELECT count(*) FROM proverb_answers a JOIN proverbs p ON p.id = a.proverb_id
          WHERE a.status = 'new' AND (p.status IN ('open', 'pending') OR (p.status = 'live' AND p.accepting_more = 1))
            AND ${ownSql("a.phone_id", "a.contributor_name", "a.created_at", s)})
     + (SELECT count(*) FROM proverbs p WHERE p.status = 'pending' AND ${ownSql("p.submitted_by", "p.contributor_name", "p.created_at", s)})
     + (SELECT count(*) FROM recordings r WHERE r.status = 'pending' AND ${ownSql("r.phone_id", "r.contributor_name", "r.created_at", s)}) AS n`,
  ).bind(...ownBinds(me)).first<{ n: number }>();
  return r?.n ?? 0;
}
