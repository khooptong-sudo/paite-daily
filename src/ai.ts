import type { Env } from "./types";

/**
 * One AI client for the whole site, whichever provider serves it. The owner (or an admin)
 * picks the provider, model and API key on the admin dashboard; the key is stored encrypted
 * (AES-GCM, key derived from SESSION_SECRET) and never sent back to a browser. Without a
 * dashboard setting, a DEEPSEEK_API_KEY secret still works, as before.
 *
 * Every caller asks for JSON and validates what comes back itself; nothing here trusts the model.
 * Most providers speak the OpenAI chat-completions dialect; Claude speaks the Anthropic Messages
 * API, so it has its own request shape (raw fetch: this Worker uses no SDKs).
 */

export type Kind = "openai" | "anthropic";
export type Preset = { label: string; kind: Kind; baseUrl: string; model: string };
export const PRESETS: Record<string, Preset> = {
  deepseek: { label: "DeepSeek", kind: "openai", baseUrl: "https://api.deepseek.com", model: "deepseek-chat" },
  glm: { label: "GLM (Zhipu, bigmodel.cn)", kind: "openai", baseUrl: "https://open.bigmodel.cn/api/paas/v4", model: "glm-4.6" },
  zai: { label: "GLM (Z.ai, international)", kind: "openai", baseUrl: "https://api.z.ai/api/paas/v4", model: "glm-4.6" },
  anthropic: { label: "Claude (Anthropic)", kind: "anthropic", baseUrl: "https://api.anthropic.com", model: "claude-opus-5-5" },
  openai: { label: "OpenAI", kind: "openai", baseUrl: "https://api.openai.com/v1", model: "gpt-4.1-mini" },
  qwen: { label: "Qwen (Alibaba DashScope, international)", kind: "openai", baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1", model: "qwen-plus" },
  openrouter: { label: "OpenRouter", kind: "openai", baseUrl: "https://openrouter.ai/api/v1", model: "deepseek/deepseek-chat" },
  custom: { label: "Other (OpenAI-compatible)", kind: "openai", baseUrl: "", model: "" },
};

export type AIConfig = { provider: string; kind: Kind; baseUrl: string; model: string; key: string; source: "dashboard" | "env" };

/** A provider answered with an HTTP error (as opposed to a network failure or unreadable reply). */
export class AIHttpError extends Error {
  constructor(public status: number) { super(`AI ${status}`); }
}

// ---- encryption of the stored key ----
const enc = new TextEncoder(), dec = new TextDecoder();
const hex = (b: ArrayBuffer | Uint8Array) => [...new Uint8Array(b as ArrayBuffer)].map((x) => x.toString(16).padStart(2, "0")).join("");
const unhex = (s: string) => new Uint8Array((s.match(/../g) ?? []).map((h) => parseInt(h, 16)));
async function sealKey(env: Env): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", enc.encode(env.SESSION_SECRET), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: enc.encode("paite-daily ai key v1"), info: enc.encode("ai_settings.key") }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
export async function encryptSecret(env: Env, plain: string): Promise<{ cipher: string; iv: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const c = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await sealKey(env), enc.encode(plain));
  return { cipher: hex(c), iv: hex(iv) };
}
async function decryptSecret(env: Env, cipher: string, iv: string): Promise<string> {
  return dec.decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unhex(iv) }, await sealKey(env), unhex(cipher)));
}

type Row = { provider: string; base_url: string; model: string; key_cipher: string; key_iv: string };
let cache: { at: number; cfg: AIConfig | null } | null = null;
export const forgetAIConfig = () => { cache = null; };

/** The active AI setup, or null when none is configured. Cached for 30 s per isolate. */
export async function aiConfig(env: Env): Promise<AIConfig | null> {
  if (cache && Date.now() - cache.at < 30_000) return cache.cfg;
  let cfg: AIConfig | null = null;
  try {
    const r = await env.DB.prepare("SELECT provider, base_url, model, key_cipher, key_iv FROM ai_settings WHERE id = 1").first<Row>();
    if (r?.key_cipher) {
      const p = PRESETS[r.provider] ?? PRESETS.custom;
      cfg = { provider: r.provider, kind: p.kind, baseUrl: r.base_url, model: r.model, key: await decryptSecret(env, r.key_cipher, r.key_iv), source: "dashboard" };
    }
  } catch (e) {
    // No table yet, or the key no longer decrypts (SESSION_SECRET changed): fall back to the secret.
    console.error("ai settings unreadable", e);
  }
  if (!cfg && env.DEEPSEEK_API_KEY) cfg = { provider: "deepseek", ...PRESETS.deepseek, key: env.DEEPSEEK_API_KEY, source: "env" };
  // Tests swap env per call: only cache what came from the dashboard.
  cache = cfg?.source === "dashboard" ? { at: Date.now(), cfg } : null;
  return cfg;
}

/** The first JSON object in a reply, even when a model wraps it in prose or a code fence. */
export function parseJSON(text: string): any {
  try { return JSON.parse(text); } catch {}
  const a = text.indexOf("{"), b = text.lastIndexOf("}");
  if (a >= 0 && b > a) return JSON.parse(text.slice(a, b + 1));
  throw new Error("AI reply was not JSON");
}

export type Ask = { system?: string; user: string; timeoutMs: number; exact?: boolean };

/** Ask the configured model for a JSON object. Throws when no AI is set up, on HTTP errors and on unreadable replies. */
export async function askJSON(env: Env, fetcher: typeof fetch, ask: Ask, cfg?: AIConfig | null): Promise<any> {
  cfg ??= await aiConfig(env);
  if (!cfg) throw new Error("no AI configured");
  const signal = AbortSignal.timeout(ask.timeoutMs);
  if (cfg.kind === "anthropic") {
    const res = await fetcher(`${cfg.baseUrl.replace(/\/+$/, "")}/v1/messages`, {
      method: "POST",
      headers: { "x-api-key": cfg.key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: cfg.model,
        max_tokens: 16000,
        output_config: { effort: "low" },
        ...(ask.system ? { system: `${ask.system}\n\nReply with the JSON object only.` } : { system: "Reply with the JSON object only." }),
        messages: [{ role: "user", content: ask.user }],
      }),
      signal,
    });
    if (!res.ok) throw new AIHttpError(res.status);
    const body = (await res.json()) as { stop_reason?: string; content?: { type: string; text?: string }[] };
    if (body.stop_reason === "refusal") throw new Error("AI declined");
    return parseJSON((body.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join(""));
  }
  const exactOk = cfg.provider === "deepseek" || cfg.provider === "openai";
  const res = await fetcher(`${cfg.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
    method: "POST",
    headers: { authorization: `Bearer ${cfg.key}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: cfg.model,
      ...(ask.exact && exactOk ? { temperature: 0 } : {}),
      response_format: { type: "json_object" },
      messages: [...(ask.system ? [{ role: "system", content: ask.system }] : []), { role: "user", content: ask.user }],
    }),
    signal,
  });
  if (!res.ok) throw new AIHttpError(res.status);
  return parseJSON(((await res.json()) as any).choices[0].message.content);
}
