import { isOwner } from "./access";
import { aiConfig, askJSON, AIHttpError, encryptSecret, forgetAIConfig, PRESETS } from "./ai";
import { hashIp, mail } from "./apply";
import { hex, ITERATIONS, MAX_PASSWORD, MIN_PASSWORD, pbkdf2, randomToken, sameBytes, sha256, unhex } from "./login";
import { json, type Deps, type Env } from "./types";

/**
 * The admin dashboard (/admin). Separate from reviewer sign-in: its own accounts, sessions,
 * links and cookie, so a reviewer session never opens it.
 *
 * - The super-user is the owner (OWNER_EMAIL). Only the super-user adds or removes admins.
 * - Admins (and the owner) choose the AI that serves the site: provider, model and API key.
 *   The key is stored encrypted and is never sent back; the page sees only its last four characters.
 * - Sign-in is email and password; a one-time emailed link sets or resets the password. An owner
 *   with no password yet starts with "Email me a link".
 * POSTs need the X-Admin header and a same-origin Origin, on top of the SameSite=Strict cookie.
 */
export const ADMIN_COOKIE = "__Host-paite_admin";
const SESSION_MS = 7 * 24 * 3_600_000, LINK_MS = 3_600_000, INVITE_MS = 7 * 24 * 3_600_000;
const WINDOW_MS = 15 * 60_000, MAX_LOGIN_PER_EMAIL = 8, MAX_LOGIN_PER_IP = 20, MAX_LINK_PER_EMAIL = 3, MAX_LINK_PER_IP = 10;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

export async function isAdmin(env: Env, email: string): Promise<boolean> {
  email = email.toLowerCase();
  if (isOwner(env, email)) return true;
  return !!(await env.DB.prepare("SELECT 1 AS x FROM admins WHERE email = ?1").bind(email).first());
}

async function checkPassword(env: Env, email: string, password: string): Promise<boolean> {
  const row = await env.DB.prepare("SELECT hash, salt, iterations FROM admin_passwords WHERE email = ?1").bind(email).first<{ hash: string; salt: string; iterations: number }>();
  const got = await pbkdf2(password, row ? unhex(row.salt) : new Uint8Array(16), row?.iterations ?? ITERATIONS);
  return row ? sameBytes(got, unhex(row.hash)) : false;
}

async function setPassword(env: Env, email: string, password: string, now: number): Promise<void> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  await env.DB.prepare(
    "INSERT INTO admin_passwords (email, hash, salt, iterations, updated_at) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT (email) DO UPDATE SET hash = excluded.hash, salt = excluded.salt, iterations = excluded.iterations, updated_at = excluded.updated_at",
  ).bind(email, hex(await pbkdf2(password, salt, ITERATIONS)), hex(salt), ITERATIONS, now).run();
}

async function createSession(env: Env, email: string, now: number): Promise<string> {
  const token = randomToken();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM admin_sessions WHERE expires_at <= ?1").bind(now),
    env.DB.prepare("INSERT INTO admin_sessions (token_hash, email, created_at, expires_at) VALUES (?1, ?2, ?3, ?4)").bind(await sha256(token), email, now, now + SESSION_MS),
  ]);
  return token;
}

function readCookie(req: Request): string | null {
  for (const part of (req.headers.get("Cookie") ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === ADMIN_COOKIE) return part.slice(i + 1).trim();
  }
  return null;
}
const cookie = (token: string, maxAge: number) => `${ADMIN_COOKIE}=${token}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Strict`;

/** The signed-in admin's email, if the session is live and the person is still an admin. */
export async function verifyAdmin(req: Request, env: Env, now: number): Promise<string | null> {
  const token = readCookie(req);
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return null;
  const row = await env.DB.prepare("SELECT email FROM admin_sessions WHERE token_hash = ?1 AND expires_at > ?2").bind(await sha256(token), now).first<{ email: string }>();
  return row && (await isAdmin(env, row.email)) ? row.email : null;
}

async function createLink(env: Env, email: string, now: number, ttl: number): Promise<string> {
  const token = randomToken();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM admin_links WHERE expires_at <= ?1").bind(now),
    env.DB.prepare("INSERT INTO admin_links (token_hash, email, expires_at) VALUES (?1, ?2, ?3)").bind(await sha256(token), email, now + ttl),
  ]);
  // The token rides in the fragment, which browsers never send to a server or pass on as a referrer.
  return `https://paite.lamkalabs.com/admin/login#set=${token}`;
}

async function tooMany(env: Env, key: string, max: number, now: number): Promise<boolean> {
  const r = await env.DB.prepare("SELECT COUNT(*) AS n FROM admin_attempts WHERE key = ?1 AND at > ?2").bind(key, now - WINDOW_MS).first<{ n: number }>();
  return (r?.n ?? 0) >= max;
}
async function note(env: Env, keys: string[], now: number): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM admin_attempts WHERE at <= ?1").bind(now - WINDOW_MS),
    ...keys.map((k) => env.DB.prepare("INSERT INTO admin_attempts (key, at) VALUES (?1, ?2)").bind(k, now)),
  ]);
}
const signedIn = (token: string) => { const r = json({ ok: true }); r.headers.set("Set-Cookie", cookie(token, SESSION_MS / 1000)); return r; };

/** What the dashboard shows about the AI: never the key itself. */
async function aiView(env: Env) {
  const row = await env.DB.prepare("SELECT provider, base_url, model, key_hint, updated_by, updated_at FROM ai_settings WHERE id = 1")
    .first<{ provider: string; base_url: string; model: string; key_hint: string; updated_by: string; updated_at: number }>();
  const presets = Object.entries(PRESETS).map(([id, p]) => ({ id, label: p.label, baseUrl: p.baseUrl, model: p.model }));
  if (row) return { source: "dashboard", provider: row.provider, baseUrl: row.base_url, model: row.model, keyHint: row.key_hint, updatedBy: row.updated_by, updatedAt: row.updated_at, presets };
  if (env.DEEPSEEK_API_KEY) return { source: "env", provider: "deepseek", baseUrl: PRESETS.deepseek.baseUrl, model: PRESETS.deepseek.model, keyHint: env.DEEPSEEK_API_KEY.slice(-4), presets };
  return { source: "none", presets };
}

export async function handleAdmin(req: Request, env: Env, deps: Deps, ctx?: ExecutionContext): Promise<Response> {
  const { pathname, origin } = new URL(req.url);
  if (req.method === "POST") {
    const from = req.headers.get("Origin");
    if ((from !== null && from !== origin) || req.headers.get("X-Admin") !== "1") return json({ error: "cross_site" }, 403);
  }
  let b: Record<string, unknown> = {};
  if (req.method === "POST") { try { b = ((await req.json()) ?? {}) as Record<string, unknown>; } catch {} }
  if (!b || typeof b !== "object") b = {};
  const now = deps.now();
  const str = (k: string, max: number) => (typeof b[k] === "string" ? (b[k] as string).trim().slice(0, max) : "");

  // ---- signing in: no session needed ----
  if (pathname === "/admin/api/login" && req.method === "POST") {
    const email = str("email", 254).toLowerCase(), password = typeof b.password === "string" ? b.password.slice(0, MAX_PASSWORD) : "";
    if (!email || !password) return json({ error: "bad_request" }, 400);
    const ip = await hashIp(req.headers.get("CF-Connecting-IP") ?? "unknown", env.SESSION_SECRET);
    if ((await tooMany(env, `login:${email}`, MAX_LOGIN_PER_EMAIL, now)) || (await tooMany(env, `login-ip:${ip}`, MAX_LOGIN_PER_IP, now))) return json({ error: "slow_down" }, 429);
    // One answer for a wrong password, no password yet, and not an admin.
    if (!(await checkPassword(env, email, password)) || !(await isAdmin(env, email))) { await note(env, [`login:${email}`, `login-ip:${ip}`], now); return json({ error: "bad_login" }, 401); }
    return signedIn(await createSession(env, email, now));
  }
  if (pathname === "/admin/api/logout" && req.method === "POST") {
    const token = readCookie(req);
    if (token) await env.DB.prepare("DELETE FROM admin_sessions WHERE token_hash = ?1").bind(await sha256(token)).run();
    const r = json({ ok: true }); r.headers.set("Set-Cookie", cookie("", 0)); return r;
  }
  if (pathname === "/admin/api/password/link" && req.method === "POST") {
    const email = str("email", 254).toLowerCase();
    if (!email) return json({ error: "bad_request" }, 400);
    const ip = await hashIp(req.headers.get("CF-Connecting-IP") ?? "unknown", env.SESSION_SECRET);
    if ((await tooMany(env, `link:${email}`, MAX_LINK_PER_EMAIL, now)) || (await tooMany(env, `link-ip:${ip}`, MAX_LINK_PER_IP, now))) return json({ error: "slow_down" }, 429);
    await note(env, [`link:${email}`, `link-ip:${ip}`], now);
    // The same answer for anyone, so the page cannot be used to find out who is an admin.
    if (await isAdmin(env, email)) {
      const sent = createLink(env, email, now, LINK_MS).then((link) => mail(env, email, "Paite Daily admin: choose your password", `Open this link to choose your Paite Daily admin password:\n\n${link}\n\nThe link works once, for one hour. If you did not ask for it, ignore this email.\n`));
      if (ctx) ctx.waitUntil(sent); else await sent;
    }
    return json({ ok: true });
  }
  if (pathname === "/admin/api/password/set" && req.method === "POST") {
    const token = str("token", 64), password = typeof b.password === "string" ? b.password : "";
    if (!/^[0-9a-f]{64}$/.test(token)) return json({ error: "bad_request" }, 400);
    if (password.length < MIN_PASSWORD || password.length > MAX_PASSWORD) return json({ error: "weak_password", min: MIN_PASSWORD }, 400);
    const link = await env.DB.prepare("UPDATE admin_links SET used_at = ?2 WHERE token_hash = ?1 AND used_at IS NULL AND expires_at > ?2 RETURNING email").bind(await sha256(token), now).first<{ email: string }>();
    if (!link || !(await isAdmin(env, link.email))) return json({ error: "bad_link" }, 400);
    await setPassword(env, link.email, password, now);
    await env.DB.batch([
      env.DB.prepare("DELETE FROM admin_sessions WHERE email = ?1").bind(link.email),
      env.DB.prepare("DELETE FROM admin_links WHERE email = ?1").bind(link.email),
      env.DB.prepare("DELETE FROM admin_attempts WHERE key = ?1").bind(`login:${link.email}`),
    ]);
    return signedIn(await createSession(env, link.email, now));
  }

  // ---- everything else needs an admin session ----
  const me = await verifyAdmin(req, env, now);
  if (!me) return json({ error: "sign_in" }, 401);
  const owner = isOwner(env, me);

  if (pathname === "/admin/api/me" && req.method === "GET") return json({ email: me, superuser: owner });

  if (pathname === "/admin/api/ai" && req.method === "GET") return json(await aiView(env));
  if (pathname === "/admin/api/ai" && req.method === "POST") {
    const provider = str("provider", 40), preset = PRESETS[provider];
    if (!preset) return json({ error: "bad_provider" }, 400);
    const baseUrl = (provider === "custom" ? str("baseUrl", 300) : preset.baseUrl).replace(/\/+$/, "");
    const model = str("model", 120) || preset.model;
    const key = typeof b.key === "string" ? b.key.trim() : "";
    if (!/^https:\/\/[a-z0-9.-]+(:\d+)?(\/[\w./%-]*)?$/i.test(baseUrl)) return json({ error: "bad_url", message: "The endpoint must be an https:// address." }, 400);
    if (!/^[\w./:@-]{1,120}$/.test(model)) return json({ error: "bad_model" }, 400);
    if (key && (key.length < 8 || key.length > 500 || /\s/.test(key))) return json({ error: "bad_key" }, 400);
    const old = await env.DB.prepare("SELECT key_cipher, key_iv, key_hint FROM ai_settings WHERE id = 1").first<{ key_cipher: string; key_iv: string; key_hint: string }>();
    if (!key && !old) return json({ error: "need_key", message: "Paste the API key the first time." }, 400);
    const sealed = key ? await encryptSecret(env, key) : { cipher: old!.key_cipher, iv: old!.key_iv };
    await env.DB.prepare(
      "INSERT INTO ai_settings (id, provider, base_url, model, key_cipher, key_iv, key_hint, updated_by, updated_at) VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8) ON CONFLICT (id) DO UPDATE SET provider = excluded.provider, base_url = excluded.base_url, model = excluded.model, key_cipher = excluded.key_cipher, key_iv = excluded.key_iv, key_hint = excluded.key_hint, updated_by = excluded.updated_by, updated_at = excluded.updated_at",
    ).bind(provider, baseUrl, model, sealed.cipher, sealed.iv, key ? key.slice(-4) : old!.key_hint, me, now).run();
    forgetAIConfig();
    return json(await aiView(env));
  }
  if (pathname === "/admin/api/ai/clear" && req.method === "POST") {
    await env.DB.prepare("DELETE FROM ai_settings WHERE id = 1").run();
    forgetAIConfig();
    return json(await aiView(env));
  }
  if (pathname === "/admin/api/ai/test" && req.method === "POST") {
    forgetAIConfig();
    const cfg = await aiConfig(env);
    if (!cfg) return json({ ok: false, error: "No AI is set up yet." });
    const t0 = Date.now();
    try {
      const out = await askJSON(env, deps.fetch ?? fetch, { user: 'Reply with this JSON exactly: {"ok": true}', timeoutMs: 20_000 }, cfg);
      return json({ ok: out?.ok === true, ms: Date.now() - t0, provider: cfg.provider, model: cfg.model, ...(out?.ok === true ? {} : { error: "The model answered, but not with the expected JSON." }) });
    } catch (e) {
      // Never echo a provider's raw error: it can contain request details.
      const msg = e instanceof AIHttpError ? (e.status === 401 || e.status === 403 ? "The provider refused the key (HTTP " + e.status + ")." : `The provider answered HTTP ${e.status}.`) : "Could not reach the provider, or its reply was unreadable.";
      return json({ ok: false, ms: Date.now() - t0, error: msg });
    }
  }

  // ---- the super-user alone manages admins ----
  if (pathname.startsWith("/admin/api/admins")) {
    if (!owner) return json({ error: "owner_only" }, 403);
    if (pathname === "/admin/api/admins" && req.method === "GET") {
      const { results } = await env.DB.prepare("SELECT email, added_by, added_at FROM admins ORDER BY added_at").all<{ email: string; added_by: string; added_at: number }>();
      return json({ admins: results ?? [] });
    }
    const email = str("email", 254).toLowerCase();
    if (!EMAIL.test(email)) return json({ error: "bad_email" }, 400);
    if (pathname === "/admin/api/admins/add" && req.method === "POST") {
      if (isOwner(env, email)) return json({ error: "already_owner" }, 400);
      await env.DB.prepare("INSERT OR IGNORE INTO admins (email, added_by, added_at) VALUES (?1, ?2, ?3)").bind(email, me, now).run();
      const sent = createLink(env, email, now, INVITE_MS).then((link) => mail(env, email, "You are an admin on Paite Daily", `${me} added you as an admin of Paite Daily.\n\nOpen this link to choose your password (it works once, for seven days):\n\n${link}\n`));
      if (ctx) ctx.waitUntil(sent); else await sent;
      return json({ ok: true });
    }
    if (pathname === "/admin/api/admins/remove" && req.method === "POST") {
      if (isOwner(env, email)) return json({ error: "cannot_remove_owner" }, 400);
      await env.DB.batch([
        env.DB.prepare("DELETE FROM admins WHERE email = ?1").bind(email),
        env.DB.prepare("DELETE FROM admin_sessions WHERE email = ?1").bind(email),
        env.DB.prepare("DELETE FROM admin_links WHERE email = ?1").bind(email),
        env.DB.prepare("DELETE FROM admin_passwords WHERE email = ?1").bind(email),
      ]);
      return json({ ok: true });
    }
  }
  return json({ error: "not_found" }, 404);
}
