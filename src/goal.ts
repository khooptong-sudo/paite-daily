import type { Env } from "./types";

// Verified = distinct sentences with at least one accepted/also_correct answer. Goal doubles each time it is reached.
export async function getGoal(env: Env): Promise<{ verified: number; goal: number }> {
  const r = await env.DB.prepare("SELECT COUNT(DISTINCT sentence_id) AS n FROM answers WHERE status IN ('accepted', 'also_correct')").first<{ n: number }>();
  const verified = r?.n ?? 0;
  let goal = Number.parseInt(env.COMMUNITY_GOAL, 10);
  if (!(goal > 0)) goal = 1000;
  while (verified >= goal) goal *= 2;
  return { verified, goal };
}
