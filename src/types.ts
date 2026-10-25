export interface Env {
  DB: D1Database;
  AUDIO: R2Bucket;
  ASSETS: Fetcher;
  TURNSTILE_SECRET: string;
  SESSION_SECRET: string;
  GITHUB_TOKEN: string;
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
  TURNSTILE_SITE_KEY: string;
  REVIEWERS: string;
  OWNER_EMAIL: string;
  CORPUS_REPO: string;
  CORPUS_BRANCH: string;
  COMMUNITY_GOAL: string;
  DEEPSEEK_API_KEY?: string;
  ALERT_EMAIL?: SendEmail;
}

export interface Deps {
  verifyTurnstile(token: string, ip: string | null, env: Env): Promise<boolean>;
  verifyAccess(req: Request, env: Env): Promise<string | null>;
  now(): number;
}

export function json(data: unknown, status = 200, cache = "no-store"): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": cache },
  });
}
