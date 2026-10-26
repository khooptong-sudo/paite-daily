const DAY_MS = 86_400_000;
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Days in a row (UTC) this phone sent an answer, counting back from today. An empty today
 *  does not break it: the run may end yesterday, so nobody sees 0 in the morning. */
export async function streakFor(db: D1Database, phoneId: string, now: number): Promise<number> {
  const { results } = await db.prepare(
    `SELECT DISTINCT date(created_at) AS d FROM answers WHERE phone_id = ?1 AND date(created_at) >= ?2`,
  ).bind(phoneId, day(now - 365 * DAY_MS)).all<{ d: string }>();
  const days = new Set(results.map((r) => r.d));
  let t = days.has(day(now)) ? now : now - DAY_MS;
  let n = 0;
  while (days.has(day(t)) && n < 365) { n++; t -= DAY_MS; }
  return n;
}
