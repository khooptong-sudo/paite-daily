/**
 * Whole-card save for a saying, mirroring the sentence reviewer's Save.
 *
 * The sentence card lets a reviewer: correct the text in place (final_paite),
 * tick other answers as "also correct" variants, accept one, reject the rest,
 * or reject the lot, or retire the prompt. This does the same for a saying,
 * with one difference: the first accept only records the review, and a second
 * reviewer publishes.
 */
import type { Env } from "./types";

export type CardSave = {
  proverbId: number;
  acceptAnswerId?: number;
  finalPaite?: string;
  alsoCorrect?: number[];
  note?: string;
  rejectAll?: boolean;
  retire?: boolean;
};

const clip = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");
const cleanText = (v: unknown, n: number) => clip(v, n).replace(/\s+/g, " ");

export async function saveProverbReview(
  env: Env,
  email: string,
  p: CardSave,
): Promise<"ok" | "waiting" | "not_found" | "bad_answer" | "duplicate"> {
  const note = p.note ? cleanText(p.note, 300) : null;

  const saying = await env.DB.prepare(
    "SELECT id, paite, status, accepting_more FROM proverbs WHERE id = ?1 AND (status IN ('open', 'pending') OR (status = 'live' AND accepting_more = 1))",
  )
    .bind(p.proverbId)
    .first<{ id: number; paite: string | null; status: string; accepting_more: number }>();
  if (!saying) return "not_found";

  const open = (
    await env.DB.prepare("SELECT id FROM proverb_answers WHERE proverb_id = ?1 AND status = 'new'")
      .bind(p.proverbId)
      .all<{ id: number }>()
  ).results ?? [];
  const openIds = new Set(open.map((r) => r.id));

  if (p.retire) {
    await env.DB.batch([
      env.DB.prepare("UPDATE proverbs SET status = 'hidden' WHERE id = ?1 AND status IN ('open', 'pending')").bind(p.proverbId),
      env.DB.prepare("UPDATE proverb_answers SET status = 'rejected' WHERE proverb_id = ?1 AND status = 'new'").bind(p.proverbId),
    ]);
    return "ok";
  }

  if (p.rejectAll) {
    await env.DB.prepare("UPDATE proverb_answers SET status = 'rejected' WHERE proverb_id = ?1 AND status = 'new'")
      .bind(p.proverbId)
      .run();
    return "ok";
  }

  if (p.acceptAnswerId === undefined || !openIds.has(p.acceptAnswerId)) return "bad_answer";

  const variants = (p.alsoCorrect ?? []).filter((x) => x !== p.acceptAnswerId && openIds.has(x));
  const losers = [...openIds].filter((x) => x !== p.acceptAnswerId && !variants.includes(x));

  // No correction offered means NULL, so a correction from the other reviewer survives.
  const finalPaite = p.finalPaite !== undefined ? cleanText(p.finalPaite, 300) : null;
  if (p.finalPaite !== undefined && !finalPaite) return "bad_answer";

  const touched = JSON.stringify([p.acceptAnswerId, ...variants, ...losers]);

  await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO proverb_reviews (proverb_id, answer_id, reviewer_email, decision, final_paite, note, answer_ids)
       VALUES (?1, ?2, ?3, 'accept', ?4, ?5, ?6)`,
    ).bind(p.proverbId, p.acceptAnswerId, email, finalPaite, note, touched),
    ...variants.map((id) =>
      env.DB.prepare(
        "INSERT OR IGNORE INTO proverb_reviews (proverb_id, answer_id, reviewer_email, decision) VALUES (?1, ?2, ?3, 'variant')",
      ).bind(p.proverbId, id, email),
    ),
    ...(variants.length
      ? [
          env.DB.prepare(
            "UPDATE proverb_answers SET status = 'also_correct' WHERE proverb_id = ?1 AND status = 'new' AND id IN (SELECT value FROM json_each(?2))",
          ).bind(p.proverbId, JSON.stringify(variants)),
        ]
      : []),
    ...(losers.length
      ? [
          env.DB.prepare(
            "UPDATE proverb_answers SET status = 'rejected' WHERE proverb_id = ?1 AND status = 'new' AND id IN (SELECT value FROM json_each(?2))",
          ).bind(p.proverbId, JSON.stringify(losers)),
        ]
      : []),
  ]);

  const n = await env.DB.prepare(
    `SELECT count(DISTINCT lower(reviewer_email)) AS n FROM proverb_reviews
      WHERE answer_id = ?1 AND decision = 'accept' AND undone_at IS NULL`,
  )
    .bind(p.acceptAnswerId)
    .first<{ n: number }>();
  if ((n?.n ?? 0) < 2) return "waiting";

  const settled = await env.DB.prepare(
    `SELECT final_paite FROM proverb_reviews
      WHERE answer_id = ?1 AND decision = 'accept' AND undone_at IS NULL AND final_paite IS NOT NULL
      ORDER BY id DESC LIMIT 1`,
  )
    .bind(p.acceptAnswerId)
    .first<{ final_paite: string | null }>();
  const chosen = await env.DB.prepare("SELECT paite FROM proverb_answers WHERE id = ?1")
    .bind(p.acceptAnswerId)
    .first<{ paite: string }>();

  try {
    const text = settled?.final_paite || chosen?.paite || "";
    await env.DB.batch([
      // A saying that already published keeps its primary line. The new rendering
      // is accepted as an alternative beside it, which is the whole point of
      // putting the saying back in the pool.
      saying.status === "live"
        ? env.DB.prepare(
            `UPDATE proverbs SET reviewed_by = ?2, reviewed_at = datetime('now') WHERE id = ?1`,
          ).bind(p.proverbId, email)
        : env.DB.prepare(
            `UPDATE proverbs
                SET paite = ?2, status = 'live', accepting_more = 1,
                    reviewed_by = ?3, reviewed_at = datetime('now')
              WHERE id = ?1`,
          ).bind(p.proverbId, text, email),
      env.DB.prepare("UPDATE proverb_answers SET status = 'accepted' WHERE id = ?1").bind(p.acceptAnswerId),
      ...(saying.status === "live"
        ? []
        : [
            env.DB.prepare(
              `UPDATE proverb_reviews SET published = 1
                WHERE id = (SELECT max(id) FROM proverb_reviews
                             WHERE proverb_id = ?1 AND answer_id = ?2 AND decision = 'accept'
                               AND undone_at IS NULL AND lower(reviewer_email) = lower(?3))`,
            ).bind(p.proverbId, p.acceptAnswerId, email),
          ]),
    ]);
  } catch (e) {
    if (/UNIQUE constraint failed/i.test(String(e))) return "duplicate";
    throw e;
  }
  return "ok";
}
