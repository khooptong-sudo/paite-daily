import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import type { Env } from "./types";

let remote: { domain: string; get: JWTVerifyGetKey } | null = null;

export async function verifyAccess(req: Request, env: Env, getKey?: JWTVerifyGetKey): Promise<string | null> {
  const jwt = req.headers.get("Cf-Access-Jwt-Assertion");
  if (!jwt || !env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) return null;
  if (!getKey) {
    if (remote?.domain !== env.ACCESS_TEAM_DOMAIN) {
      remote = { domain: env.ACCESS_TEAM_DOMAIN, get: createRemoteJWKSet(new URL(`https://${env.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`)) };
    }
    getKey = remote.get;
  }
  try {
    const { payload } = await jwtVerify(jwt, getKey, { algorithms: ["RS256"], issuer: `https://${env.ACCESS_TEAM_DOMAIN}`, audience: env.ACCESS_AUD });
    return typeof payload.email === "string" ? payload.email.toLowerCase() : null;
  } catch {
    return null;
  }
}

export function isOwner(env: Env, email: string): boolean {
  return (env.OWNER_EMAIL ?? "").split(",").some((o) => o.trim() !== "" && o.trim().toLowerCase() === email);
}

export function reviewerName(env: Env, email: string): string | null {
  try {
    const map = JSON.parse(env.REVIEWERS) as Record<string, string>;
    for (const [k, v] of Object.entries(map)) if (k.toLowerCase() === email) return v;
  } catch {}
  return null;
}
