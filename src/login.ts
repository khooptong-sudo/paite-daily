import { reviewerName } from "./access";
import { hashIp, mail } from "./apply";
import { json, type Deps, type Env } from "./types";

/**
 * Reviewer sign-in: email and password, a session cookie, and a one-time emailed
 * link to choose or reset the password. Passwords are PBKDF2-SHA256 with a salt
 * per reviewer. Session and link tokens are random; only their SHA-256 is stored.
 */
export const COOKIE = "__Host-paite_review";
export const SESSION_MS = 30 * 24 * 3_600_000;
export const LINK_MS = 3_600_000;
export const INVITE_MS = 7 * 24 * 3_600_000;
export const MIN_PASSWORD = 8;
const MAX_PASSWORD = 200;
const ITERATIONS = 100_000; // the most Workers WebCrypto allows for PBKDF2
const WINDOW_MS = 15 * 60_000;
const MAX_LOGIN_PER_EMAIL = 10, MAX_LOGIN_PER_IP = 30;
const MAX_LINK_PER_EMAIL = 3, MAX_LINK_PER_IP = 10;

const enc = new TextEncoder();
const hex = (buf: ArrayBuffer | Uint8Array) => [...new Uint8Array(buf as ArrayBuffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
const unhex = (s: string) => new Uint8Array((s.match(/../g) ?? []).map((h) => parseInt(h, 16)));
const sha256 = async (s: string) => hex(await crypto.subtle.digest("SHA-256", enc.encode(s)));
const randomToken = () => hex(crypto.getRandomValues(new Uint8Array(32)));

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256));
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function setPassword(env: Env, email: string, password: string, now: number): Promise<void> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, ITERATIONS);
  await env.DB.prepare(
    "INSERT INTO reviewer_passwords (email, hash, salt, iterations, updated_at) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT (email) DO UPDATE SET hash = excluded.hash, salt = excluded.salt, iterations = excluded.iterations, updated_at = excluded.updated_at",
  ).bind(email, hex(hash), hex(salt), ITERATIONS, now).run();
}

// An unknown email costs the same work as a wrong password, so timing does not say which emails have one.
async function checkPassword(env: Env, email: string, password: string): Promise<boolean> {
  const row = await env.DB.prepare("SELECT hash, salt, iterations FROM reviewer_passwords WHERE email = ?1").bind(email).first<{ hash: string; salt: string; iterations: number }>();
  const got = await pbkdf2(password, row ? unhex(row.salt) : new Uint8Array(16), row?.iterations ?? ITERATIONS);
  return row ? sameBytes(got, unhex(row.hash)) : false;
}

export async function createSession(env: Env, email: string, now: number): Promise<string> {
  const token = randomToken();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM reviewer_sessions WHERE expires_at <= ?1").bind(now),
    env.DB.prepare("INSERT INTO reviewer_sessions (token_hash, email, created_at, expires_at) VALUES (?1, ?2, ?3, ?4)").bind(await sha256(token), email, now, now + SESSION_MS),
  ]);
  return token;
}

function readCookie(req: Request): string | null {
  for (const part of (req.headers.get("Cookie") ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === COOKIE) return part.slice(i + 1).trim();
  }
  return null;
}

const setCookie = (token: string, maxAgeSeconds: number) => `${COOKIE}=${token}; Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; Secure; SameSite=Strict`;

/** The signed-in reviewer's email, or null. Whether that email is still a reviewer is the caller's check. */
export async function verifyReviewer(req: Request, env: Env, now: number): Promise<string | null> {
  const token = readCookie(req);
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return null;
  const row = await env.DB.prepare("SELECT email FROM reviewer_sessions WHERE token_hash = ?1 AND expires_at > ?2").bind(await sha256(token), now).first<{ email: string }>();
  return row?.email ?? null;
}

/** A one-time link to choose a password. The token travels in the URL fragment, which browsers do not send to servers or pass on as a referrer. */
export async function createPasswordLink(env: Env, email: string, now: number, ttl = LINK_MS): Promise<string> {
  const token = randomToken();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM reviewer_password_links WHERE expires_at <= ?1").bind(now),
    env.DB.prepare("INSERT INTO reviewer_password_links (token_hash, email, expires_at) VALUES (?1, ?2, ?3)").bind(await sha256(token), email, now + ttl),
  ]);
  return `https://paite.lamkalabs.com/review/login#set=${token}`;
}

async function tooMany(env: Env, key: string, max: number, now: number): Promise<boolean> {
  const r = await env.DB.prepare("SELECT COUNT(*) AS n FROM reviewer_login_attempts WHERE key = ?1 AND at > ?2").bind(key, now - WINDOW_MS).first<{ n: number }>();
  return (r?.n ?? 0) >= max;
}

async function note(env: Env, keys: string[], now: number): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM reviewer_login_attempts WHERE at <= ?1").bind(now - WINDOW_MS),
    ...keys.map((k) => env.DB.prepare("INSERT INTO reviewer_login_attempts (key, at) VALUES (?1, ?2)").bind(k, now)),
  ]);
}

const signedIn = (token: string) => {
  const r = json({ ok: true });
  r.headers.set("Set-Cookie", setCookie(token, SESSION_MS / 1000));
  return r;
};

const LINK_TEXT = (link: string) => `Open this link to choose your Paite Daily reviewer password:

${link}

The link works once, for one hour. If you did not ask for it, ignore this email: your password stays as it is.
`;

/** The sign-in endpoints, which need no session. Null means the path is not one of them. */
export async function handleLogin(req: Request, env: Env, deps: Deps, pathname: string, ctx?: ExecutionContext): Promise<Response | null> {
  const mine = ["/review/api/login", "/review/api/logout", "/review/api/password/link", "/review/api/password/set"];
  if (!mine.includes(pathname)) return null;
  if (req.method !== "POST") return json({ error: "not_found" }, 404);
  let b: Record<string, unknown> = {};
  try { b = (await req.json()) as Record<string, unknown>; } catch {}
  if (!b || typeof b !== "object") b = {};
  const now = deps.now();
  const ip = await hashIp(req.headers.get("CF-Connecting-IP") ?? "unknown", env.SESSION_SECRET);
  const email = typeof b.email === "string" ? b.email.trim().toLowerCase().slice(0, 120) : "";

  if (pathname === "/review/api/login") {
    if (!email || typeof b.password !== "string" || !b.password) return json({ error: "bad_request" }, 400);
    if ((await tooMany(env, `login:${email}`, MAX_LOGIN_PER_EMAIL, now)) || (await tooMany(env, `login-ip:${ip}`, MAX_LOGIN_PER_IP, now))) return json({ error: "slow_down" }, 429);
    // One answer for a wrong password, an email with no password and a non-reviewer.
    const ok = (await checkPassword(env, email, b.password.slice(0, MAX_PASSWORD))) && (await reviewerName(env, email)) !== null;
    if (!ok) { await note(env, [`login:${email}`, `login-ip:${ip}`], now); return json({ error: "bad_login" }, 401); }
    return signedIn(await createSession(env, email, now));
  }

  if (pathname === "/review/api/logout") {
    const token = readCookie(req);
    if (token) await env.DB.prepare("DELETE FROM reviewer_sessions WHERE token_hash = ?1").bind(await sha256(token)).run();
    const r = json({ ok: true });
    r.headers.set("Set-Cookie", setCookie("", 0));
    return r;
  }

  if (pathname === "/review/api/password/link") {
    if (!email) return json({ error: "bad_request" }, 400);
    if ((await tooMany(env, `link:${email}`, MAX_LINK_PER_EMAIL, now)) || (await tooMany(env, `link-ip:${ip}`, MAX_LINK_PER_IP, now))) return json({ error: "slow_down" }, 429);
    await note(env, [`link:${email}`, `link-ip:${ip}`], now);
    // The same answer whether or not the email is a reviewer's, so the page cannot be used to find out.
    if ((await reviewerName(env, email)) !== null) {
      const sent = createPasswordLink(env, email, now).then((link) => mail(env, email, "Paite Daily: choose your reviewer password", LINK_TEXT(link)));
      if (ctx) ctx.waitUntil(sent); else await sent;
    }
    return json({ ok: true });
  }

  // /review/api/password/set
  if (typeof b.token !== "string" || !/^[0-9a-f]{64}$/.test(b.token) || typeof b.password !== "string") return json({ error: "bad_request" }, 400);
  if (b.password.length < MIN_PASSWORD || b.password.length > MAX_PASSWORD) return json({ error: "weak_password", min: MIN_PASSWORD }, 400);
  // Marking the link used and reading its email is one statement, so a link cannot be spent twice.
  const link = await env.DB.prepare("UPDATE reviewer_password_links SET used_at = ?2 WHERE token_hash = ?1 AND used_at IS NULL AND expires_at > ?2 RETURNING email")
    .bind(await sha256(b.token), now).first<{ email: string }>();
  if (!link || (await reviewerName(env, link.email)) === null) return json({ error: "bad_link" }, 400);
  await setPassword(env, link.email, b.password, now);
  // A new password signs out every other device and clears the failed-attempt count.
  await env.DB.batch([
    env.DB.prepare("DELETE FROM reviewer_sessions WHERE email = ?1").bind(link.email),
    env.DB.prepare("DELETE FROM reviewer_password_links WHERE email = ?1").bind(link.email),
    env.DB.prepare("DELETE FROM reviewer_login_attempts WHERE key = ?1").bind(`login:${link.email}`),
  ]);
  return signedIn(await createSession(env, link.email, now));
}
