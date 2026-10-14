import type { Env } from "./types";

export async function verifyTurnstile(token: string, ip: string | null, env: Env, fetcher: typeof fetch = fetch): Promise<boolean> {
  if (!token) return false;
  const form = new FormData();
  form.append("secret", env.TURNSTILE_SECRET);
  form.append("response", token);
  if (ip) form.append("remoteip", ip);
  try {
    const r = await fetcher("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form, signal: AbortSignal.timeout(5000) });
    const data = await r.json<{ success?: boolean }>();
    return data.success === true;
  } catch {
    return false;
  }
}
