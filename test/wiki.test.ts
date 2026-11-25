import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/index";
import { addChunks, addSource, chunkText, ftsQuery, getSource, searchChunks, type NewSource } from "../src/kb";
import type { Env } from "../src/types";
import { call, fakeDeps, NOW } from "./helpers";
const REV = "rev@example.org";
const OWNER = "owner@example.org";
const TOKEN = "test-ingest-token-0123456789abcdef";
const H = { "X-Admin": "1", Origin: "https://paite.lamkalabs.com" };
// A reviewer identity for the /review/api routes.
const rev = (path: string, body?: unknown, email = REV) =>
  call(path, body === undefined ? {} : { method: "POST", body: JSON.stringify(body) }, fakeDeps({ verifyReviewer: async () => email }));
const BOOK: NewSource = { kind: "book", title: "A test book", author: "Someone", language: "en", rights: "open" };
async function sourceWithText(by: string, text: string, s: NewSource = BOOK): Promise<number> {
  const id = await addSource(env, s, by, NOW);
  expect(await addChunks(env, id, [{ text, locator: "p. 1" }])).toEqual({ added: 1 });
  return id;
}
/** Sign someone in through the real link flow and return their cookie (copied from admin.test.ts). */
async function signIn(email: string): Promise<string> {
  const token = "a".repeat(63) + (email === OWNER ? "1" : "2");
  const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)))].map((b) => b.toString(16).padStart(2, "0")).join("");
  await env.DB.prepare("INSERT INTO admin_links (token_hash, email, expires_at) VALUES (?1, ?2, ?3)").bind(hash, email, NOW + 60_000).run();
  const r = await call("/admin/api/password/set", { method: "POST", headers: H, body: JSON.stringify({ token, password: "correct horse" }) });
  expect(r.status).toBe(200);
  return r.headers.get("Set-Cookie")!.split(";")[0];
}
const ingest = (path: string, init: RequestInit = {}, token: string | null = TOKEN) => {
  const headers = new Headers(init.headers);
  if (token !== null) headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  return call(path, { ...init, headers });
};
describe("wiki chunking", () => {
  it("packs short paragraphs, splits long ones at sentence ends without cutting words, and accepts CRLF", () => {
    expect(chunkText("First paragraph here.\n\nSecond one.")).toEqual(["First paragraph here.\n\nSecond one."]);
    const sentence = "The quick brown fox jumps over the lazy dog near the river bank today. ";
    const long = sentence.repeat(Math.ceil(3000 / sentence.length)).trim();
    expect(long.length).toBeGreaterThanOrEqual(3000);
    const parts = chunkText(long);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) {
      expect(p.length).toBeLessThanOrEqual(1200);
      expect(p.startsWith(" ") || p.endsWith(" ")).toBe(false);
    }
    const words = (s: string) => s.split(/\s+/).filter(Boolean);
    expect(parts.flatMap(words)).toEqual(words(long));
    // Every word in the chunks is a whole word of the original.
    const known = new Set(words(long));
    expect(parts.flatMap(words).every((w) => known.has(w))).toBe(true);
    expect(chunkText("One line.\r\n\r\nTwo   lines\r\nhere.")).toEqual(["One line.\n\nTwo lines here."]);
  });
});
describe("wiki search query", () => {
  it("quotes every term so visitor text never becomes FTS5 syntax", () => {
    expect(ftsQuery(['What does "lungdam" mean?'])).toBe('"what" OR "does" OR "lungdam" OR "mean"');
    expect(ftsQuery(["?!.,;:\"'()*"])).toBeNull();
    expect(ftsQuery(["OR AND NEAR("])).toBe('"or" OR "and" OR "near"');
    for (const q of [ftsQuery(["a* b^ \"c d\" -e NOT f:g"]), ftsQuery(["OR AND NEAR( x"])]) {
      if (q === null) continue;
      for (const part of q.split(" OR ")) expect(part).toMatch(/^"[\p{L}\p{N}]+"$/u);
    }
  });
});
describe("wiki sources for reviewers", () => {
  it("source and article lists carry names, never emails; the owner shows as OWNER_NAME", async () => {
    await sourceWithText(OWNER, "Owner text.", { ...BOOK, title: "Owner book" });
    await sourceWithText("stranger@example.org", "Stranger text.", { ...BOOK, title: "Stranger book" });
    const r = await rev("/review/api/wiki/sources?status=pending");
    const body = await r.text();
    expect(body).not.toContain("@");
    const by = new Map(JSON.parse(body).sources.map((s: { title: string; added_by: string }) => [s.title, s.added_by]));
    expect(by.get("Owner book")).toBe("Min Khooptong");
    expect(by.get("Stranger book")).toBe("a reviewer");
    const one = await (await rev("/review/api/wiki/source?id=" + JSON.parse(body).sources[0].id)).text();
    expect(one).not.toContain("@");
  });
  it("a reviewer's new source with text is pending and not searchable", async () => {
    const r = await rev("/review/api/wiki/source", { ...BOOK, title: "Pending book", text: "Elephants walk slowly through the forest.\n\nThey drink at dusk." });
    expect(r.status).toBe(200);
    const { id, chunks } = await r.json<{ id: number; chunks: number }>();
    expect(chunks).toBeGreaterThanOrEqual(1);
    const list = await (await rev("/review/api/wiki/sources?status=pending")).json<{ sources: { id: number; chunks: number }[] }>();
    expect(list.sources.map((s) => s.id)).toEqual([id]);
    expect(await searchChunks(env, ["elephants"])).toEqual([]);
  });
  it("nobody approves their own source; another reviewer's approval makes it searchable", async () => {
    const mine = await (await rev("/review/api/wiki/source", { ...BOOK, text: "Mangoes ripen in the hot season." })).json<{ id: number }>();
    const own = await rev("/review/api/wiki/decide", { id: mine.id, decision: "approve" });
    expect(own.status).toBe(409);
    expect(await own.json()).toMatchObject({ error: "own_submission" });
    const id = await sourceWithText("someone@example.org", "Hornbills nest high in old trees.");
    expect((await rev("/review/api/wiki/decide", { id, decision: "approve" })).status).toBe(200);
    const hits = await searchChunks(env, ["hornbills"]);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ sourceId: id, title: "A test book", rights: "open", locator: "p. 1" });
  });
  it("the owner may approve their own source", async () => {
    const id = await sourceWithText(OWNER, "Bamboo grows quickly on the hills.");
    expect((await rev("/review/api/wiki/decide", { id, decision: "approve" }, OWNER)).status).toBe(200);
    expect(await searchChunks(env, ["bamboo"])).toHaveLength(1);
  });
  it("a source with no text cannot be approved, and a decided source cannot be decided again", async () => {
    const empty = await addSource(env, BOOK, "someone@example.org", NOW);
    const r = await rev("/review/api/wiki/decide", { id: empty, decision: "approve" });
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ error: "no_text" });
    const id = await sourceWithText("someone@example.org", "Rivers flood in the monsoon.");
    expect((await rev("/review/api/wiki/decide", { id, decision: "approve" })).status).toBe(200);
    const again = await rev("/review/api/wiki/decide", { id, decision: "reject" });
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ error: "not_pending" });
  });
  it("withdrawing removes the text, the index entries and the file, and keeps the row", async () => {
    const id = await sourceWithText("someone@example.org", "Orchids bloom after the rains.");
    const key = `sources/${id}/abc`;
    await env.WIKI_FILES.put(key, "file bytes");
    await env.WIKI.prepare("UPDATE kb_sources SET r2_key = ?2 WHERE id = ?1").bind(id, key).run();
    expect((await rev("/review/api/wiki/decide", { id, decision: "approve" })).status).toBe(200);
    expect(await searchChunks(env, ["orchids"])).toHaveLength(1);
    expect((await rev("/review/api/wiki/withdraw", { id, reason: "The publisher asked us to." })).status).toBe(200);
    expect(await searchChunks(env, ["orchids"])).toEqual([]);
    const n = await env.WIKI.prepare("SELECT COUNT(*) AS n FROM kb_chunks WHERE source_id = ?1").bind(id).first<{ n: number }>();
    expect(n!.n).toBe(0);
    expect(await env.WIKI_FILES.get(key)).toBeNull();
    const s = await getSource(env, id);
    expect(s).toMatchObject({ status: "withdrawn", has_file: 0, chunks: [] });
    const row = await env.WIKI.prepare("SELECT withdrawn_reason, r2_key FROM kb_sources WHERE id = ?1").bind(id).first();
    expect(row).toEqual({ withdrawn_reason: "The publisher asked us to.", r2_key: null });
    expect((await rev("/review/api/wiki/withdraw", { id })).status).toBe(409);
  });
  it("admins reach the same endpoints, and admin writes need the admin header", async () => {
    await sourceWithText("someone@example.org", "Tea grows on the slopes.");
    const cookie = await signIn(OWNER);
    const r = await call("/admin/api/wiki/sources", { headers: { Cookie: cookie } });
    expect(r.status).toBe(200);
    expect((await r.json<{ sources: unknown[] }>()).sources).toHaveLength(1);
    const noHeader = await call("/admin/api/wiki/source", { method: "POST", headers: { Cookie: cookie, Origin: "https://paite.lamkalabs.com" }, body: JSON.stringify(BOOK) });
    expect(noHeader.status).toBe(403);
  });
  it("needs a signed-in reviewer", async () => {
    expect((await call("/review/api/wiki/sources")).status).toBe(401);
  });
  it("refuses bad input", async () => {
    for (const bad of [
      { ...BOOK, title: undefined },
      { ...BOOK, rights: "public" },
      { ...BOOK, url: "javascript:alert(1)" },
      { ...BOOK, kind: "site" },
    ]) {
      const r = await rev("/review/api/wiki/source", bad);
      expect(r.status).toBe(400);
    }
    const n = await env.WIKI.prepare("SELECT COUNT(*) AS n FROM kb_sources").first<{ n: number }>();
    expect(n!.n).toBe(0);
  });
});
describe("wiki ingest API", () => {
  it("needs the token, creates pending sources from ingest, stores files, and refuses late chunks", async () => {
    const body = JSON.stringify({ ...BOOK, title: "Ingested book", chunks: [{ text: "Hill paths wind between villages.", locator: "ch. 1" }] });
    expect((await ingest("/wiki/api/ingest/source", { method: "POST", body }, null)).status).toBe(401);
    expect((await ingest("/wiki/api/ingest/source", { method: "POST", body }, "wrong-token-wrong-token-wrong-token")).status).toBe(401);
    const r = await ingest("/wiki/api/ingest/source", { method: "POST", body });
    expect(r.status).toBe(200);
    const { id, chunks } = await r.json<{ id: number; chunks: number }>();
    expect(chunks).toBe(1);
    expect(await getSource(env, id)).toMatchObject({ added_by: "ingest", status: "pending" });
    const pdf = await ingest(`/wiki/api/ingest/file?sourceId=${id}`, { method: "PUT", headers: { "content-type": "application/pdf" }, body: "%PDF-1.4 test" });
    expect(pdf.status).toBe(200);
    const { key, bytes } = await pdf.json<{ key: string; bytes: number }>();
    expect(bytes).toBe(13);
    expect(await (await env.WIKI_FILES.get(key))!.text()).toBe("%PDF-1.4 test");
    expect(await getSource(env, id)).toMatchObject({ has_file: 1 });
    const exe = await ingest(`/wiki/api/ingest/file?sourceId=${id}`, { method: "PUT", headers: { "content-type": "application/x-msdownload" }, body: "MZ" });
    expect(exe.status).toBe(415);
    const big = await ingest(`/wiki/api/ingest/file?sourceId=${id}`, { method: "PUT", headers: { "content-type": "application/pdf", "content-length": "60000000" }, body: "x" });
    expect(big.status).toBe(413);
    expect((await rev("/review/api/wiki/decide", { id, decision: "approve" })).status).toBe(200);
    const late = await ingest("/wiki/api/ingest/chunks", { method: "POST", body: JSON.stringify({ sourceId: id, chunks: [{ text: "More text." }] }) });
    expect(late.status).toBe(409);
  });
  it("is switched off when no token is configured", async () => {
    const off = { ...env, WIKI_INGEST_TOKEN: undefined } as Env;
    for (const [path, method] of [["/wiki/api/ingest/source", "POST"], ["/wiki/api/ingest/chunks", "POST"], ["/wiki/api/ingest/file?sourceId=1", "PUT"], ["/wiki/api/ingest/other", "GET"]]) {
      const req = new Request(`https://paite.lamkalabs.com${path}`, { method, headers: { Authorization: `Bearer ${TOKEN}`, "content-type": "application/json" }, body: method === "GET" ? undefined : "{}" });
      expect((await createApp(fakeDeps())(req, off)).status).toBe(404);
    }
  });
});
