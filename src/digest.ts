import { activeReviewers } from "./access";
import type { Env } from "./types";

// Same rule as claimNext, ignoring locks and skips: new answers on open or full sentences.
// With (email, now), sentences locked by another reviewer or skipped by this one are left out, as in claimNext.
export async function waitingCounts(db: D1Database, email?: string, now?: number): Promise<{ answers: number; sentences: number }> {
  const lock = email === undefined ? "" : " AND NOT EXISTS (SELECT 1 FROM locks l WHERE l.sentence_id = s.id AND l.expires_at > ?1 AND l.reviewer_email <> ?2)"
    + " AND NOT EXISTS (SELECT 1 FROM skips k WHERE k.sentence_id = s.id AND k.reviewer_email = ?2 AND k.until > ?1)";
  const q = db.prepare(
    `SELECT COUNT(*) AS answers, COUNT(DISTINCT a.sentence_id) AS sentences FROM answers a
     JOIN sentences s ON s.id = a.sentence_id WHERE a.status = 'new' AND s.status IN ('open', 'full')${lock}`,
  );
  const r = await (email === undefined ? q : q.bind(now, email)).first<{ answers: number; sentences: number }>();
  return { answers: r?.answers ?? 0, sentences: r?.sentences ?? 0 };
}

// One email per distinct reviewer address. Returns null (no job row) when there is nothing to send.
export async function runDigest(env: Env): Promise<{ sent: number } | null> {
  if (!env.ALERT_EMAIL) return null;
  const { answers, sentences } = await waitingCounts(env.DB);
  const words = (await env.DB.prepare("SELECT count(*) AS n FROM word_submissions WHERE status = 'pending'").first<{ n: number }>())?.n ?? 0;
  if (answers === 0 && words === 0) return null;
  const what = [answers && `${answers} answers`, words && `${words} new words`].filter(Boolean).join(" and ");
  const to = (await activeReviewers(env)).filter((r) => r.listed).map((r) => r.email);
  let sent = 0, failed = 0;
  for (const addr of to) {
    try {
      await env.ALERT_EMAIL.send({
        from: "alerts@alerts.lamkalabs.com",
        to: addr,
        subject: `Paite Daily: ${what} waiting`,
        text: `${what} waiting for review${answers ? `, on ${sentences} sentences` : ""}.

https://paite.lamkalabs.com/review`,
      });
      sent++;
    } catch (e) {
      failed++;
      console.error("digest email", e);
    }
  }
  if (failed) throw new Error(`digest: ${failed} of ${to.length} emails failed`);
  return { sent };
}
