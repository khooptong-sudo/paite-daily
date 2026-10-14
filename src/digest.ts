import type { Env } from "./types";

// Same rule as claimNext, ignoring locks: new answers on open or full sentences.
// With (email, now), sentences locked by another reviewer are left out, as in claimNext.
export async function waitingCounts(db: D1Database, email?: string, now?: number): Promise<{ answers: number; sentences: number }> {
  const lock = email === undefined ? "" : " AND NOT EXISTS (SELECT 1 FROM locks l WHERE l.sentence_id = s.id AND l.expires_at > ?1 AND l.reviewer_email <> ?2)";
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
  if (answers === 0) return null;
  let map: Record<string, string> = {};
  try { map = JSON.parse(env.REVIEWERS); } catch {}
  const to = [...new Set(Object.keys(map).map((e) => e.trim().toLowerCase()).filter(Boolean))];
  let sent = 0, failed = 0;
  for (const addr of to) {
    try {
      await env.ALERT_EMAIL.send({
        from: "alerts@alerts.lamkalabs.com",
        to: addr,
        subject: `Paite Daily: ${answers} answers waiting`,
        text: `${answers} answers are waiting for review, on ${sentences} sentences.\n\nhttps://paite.lamkalabs.com/review`,
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
