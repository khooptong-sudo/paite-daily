import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { aiConfig, askJSON, forgetAIConfig } from "../src/ai";
import { call, fakeDeps, NOW } from "./helpers";

const OWNER = "owner@example.org";
const H = { "X-Admin": "1", Origin: "https://paite.lamkalabs.com" };
const reply = (o: unknown) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(o) } }] }));

/** Sign someone in through the real link flow and return their cookie. */
async function signIn(email: string): Promise<string> {
  const token = "a".repeat(63) + (email === OWNER ? "1" : "2");
  const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)))].map((b) => b.toString(16).padStart(2, "0")).join("");
  await env.DB.prepare("INSERT INTO admin_links (token_hash, email, expires_at) VALUES (?1, ?2, ?3)").bind(hash, email, NOW + 60_000).run();
  const r = await call("/admin/api/password/set", { method: "POST", headers: H, body: JSON.stringify({ token, password: "correct horse" }) });
  expect(r.status).toBe(200);
  return r.headers.get("Set-Cookie")!.split(";")[0];
}

describe("admin dashboard", () => {
  it("needs a session, and refuses a write without the admin header", async () => {
    expect((await call("/admin/api/me")).status).toBe(401);
    expect((await call("/admin/api/login", { method: "POST", body: JSON.stringify({ email: OWNER, password: "x" }) })).status).toBe(403);
  });

  it("a reviewer or stranger cannot sign in; the owner can, by password, after setting one", async () => {
    const bad = await call("/admin/api/login", { method: "POST", headers: H, body: JSON.stringify({ email: "someone@example.org", password: "whatever1" }) });
    expect(bad.status).toBe(401);
    const cookie = await signIn(OWNER);
    const me = await (await call("/admin/api/me", { headers: { Cookie: cookie } })).json();
    expect(me).toEqual({ email: OWNER, superuser: true });
    const again = await call("/admin/api/login", { method: "POST", headers: H, body: JSON.stringify({ email: OWNER, password: "correct horse" }) });
    expect(again.status).toBe(200);
  });

  it("only the owner adds and removes admins; an added admin can set the AI but not manage admins", async () => {
    const owner = await signIn(OWNER);
    expect((await call("/admin/api/admins/add", { method: "POST", headers: { ...H, Cookie: owner }, body: JSON.stringify({ email: "Helper@Example.org" }) })).status).toBe(200);
    const list = await (await call("/admin/api/admins", { headers: { Cookie: owner } })).json() as { admins: { email: string }[] };
    expect(list.admins.map((a) => a.email)).toEqual(["helper@example.org"]);
    const helper = await signIn("helper@example.org");
    expect((await call("/admin/api/admins", { headers: { Cookie: helper } })).status).toBe(403);
    expect((await call("/admin/api/ai", { method: "POST", headers: { ...H, Cookie: helper }, body: JSON.stringify({ provider: "glm", key: "glm-secret-key-1234" }) })).status).toBe(200);
    // Removing an admin ends their session at once.
    await call("/admin/api/admins/remove", { method: "POST", headers: { ...H, Cookie: owner }, body: JSON.stringify({ email: "helper@example.org" }) });
    expect((await call("/admin/api/me", { headers: { Cookie: helper } })).status).toBe(401);
  });

  it("stores the key encrypted, never returns it, and the whole site then uses that provider", async () => {
    const owner = await signIn(OWNER);
    const saved = await (await call("/admin/api/ai", { method: "POST", headers: { ...H, Cookie: owner }, body: JSON.stringify({ provider: "anthropic", model: "claude-opus-5-5", key: "sk-ant-secret-abcd" }) })).json() as Record<string, unknown>;
    expect(saved).toMatchObject({ source: "dashboard", provider: "anthropic", model: "claude-opus-5-5", keyHint: "abcd" });
    expect(JSON.stringify(saved)).not.toContain("sk-ant-secret");
    const row = await env.DB.prepare("SELECT key_cipher FROM ai_settings WHERE id = 1").first<{ key_cipher: string }>();
    expect(row!.key_cipher).not.toContain("sk-ant");
    forgetAIConfig();
    const cfg = await aiConfig(env);
    expect(cfg).toMatchObject({ provider: "anthropic", kind: "anthropic", key: "sk-ant-secret-abcd" });
    const seen: { url: string; headers: Headers; body: any }[] = [];
    const f = (async (u: string, init: RequestInit) => {
      seen.push({ url: u, headers: new Headers(init.headers), body: JSON.parse(init.body as string) });
      return new Response(JSON.stringify({ stop_reason: "end_turn", content: [{ type: "thinking", thinking: "" }, { type: "text", text: '{"id": 2}' }] }));
    }) as unknown as typeof fetch;
    expect(await askJSON(env, f, { user: "pick", timeoutMs: 1000 })).toEqual({ id: 2 });
    expect(seen[0].url).toBe("https://api.anthropic.com/v1/messages");
    expect(seen[0].headers.get("x-api-key")).toBe("sk-ant-secret-abcd");
    expect(seen[0].body.model).toBe("claude-opus-5-5");
    forgetAIConfig();
  });

  it("switching to an OpenAI-compatible provider (GLM) uses its endpoint and model", async () => {
    const owner = await signIn(OWNER);
    await call("/admin/api/ai", { method: "POST", headers: { ...H, Cookie: owner }, body: JSON.stringify({ provider: "glm", model: "glm-4.6", key: "glm-key-0000-9999" }) });
    forgetAIConfig();
    let url = "", auth = "";
    const f = (async (u: string, init: RequestInit) => { url = u; auth = new Headers(init.headers).get("authorization") ?? ""; return reply({ ok: true }); }) as unknown as typeof fetch;
    const t = await (await call("/admin/api/ai/test", { method: "POST", headers: { ...H, Cookie: owner } }, fakeDeps({ fetch: f }))).json();
    expect(t).toMatchObject({ ok: true, provider: "glm", model: "glm-4.6" });
    expect(url).toBe("https://open.bigmodel.cn/api/paas/v4/chat/completions");
    expect(auth).toBe("Bearer glm-key-0000-9999");
    forgetAIConfig();
  });

  it("rejects a non-https endpoint for a custom provider", async () => {
    const owner = await signIn(OWNER);
    const r = await call("/admin/api/ai", { method: "POST", headers: { ...H, Cookie: owner }, body: JSON.stringify({ provider: "custom", baseUrl: "http://evil.example", model: "m", key: "abcdefgh123" }) });
    expect(r.status).toBe(400);
  });
});
