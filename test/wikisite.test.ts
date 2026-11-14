import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { searchChunks } from "../src/kb";
import { syncSiteSources } from "../src/kbsite";
import { addSentences, call, fakeDeps, NOW, PHONE_A } from "./helpers";

const rev = (path: string, body?: unknown) =>
  call(path, body === undefined ? {} : { method: "POST", body: JSON.stringify(body) }, fakeDeps({ verifyReviewer: async () => "rev@example.org" }));
async function verified(english: string, paite: string) {
  const [id] = await addSentences(english);
  const a = await env.DB.prepare("INSERT INTO answers (sentence_id, paite, register, phone_id) VALUES (?1, ?2, 'both', ?3) RETURNING id").bind(id, paite, PHONE_A).first<{ id: number }>();
  await env.DB.prepare("INSERT INTO reviews (sentence_id, reviewer_email, decision, accepted_answer_id) VALUES (?1, 'rev@example.org', 'accept', ?2)").bind(id, a!.id).run();
  await env.DB.prepare("UPDATE sentences SET status = 'verified' WHERE id = ?1").bind(id).run();
  return id!;
}
async function saying(paite: string, english: string, explainer: string | null, explainerEn: string | null, status = "live") {
  const r = await env.DB.prepare("INSERT INTO proverbs (kind, paite, english, explainer, explainer_en, entered_from, status) VALUES ('idiom', ?1, ?2, ?3, ?4, 'pai2en', ?5) RETURNING id")
    .bind(paite, english, explainer, explainerEn, status).first<{ id: number }>();
  return r!.id;
}
async function word(paite: string, english: string, hidden = 0) {
  const r = await env.DB.prepare("INSERT INTO glossary (paite, english, note, source, reviewed_by, hidden) VALUES (?1, ?2, NULL, 'test', 'rev@example.org', ?3) RETURNING id").bind(paite, english, hidden).first<{ id: number }>();
  return r!.id;
}
async function seed() {
  const s1 = await saying("Alpha beta", "Two heads", "Paite one", "Sharing brings strength");
  await saying("Gamma delta", "Slow river", "Paite two", "Patience pays");
  await saying("Hidden zeta", "Hidden thing", "Paite three", "Zebrafish", "hidden");
  await saying("Open eta", "Open wording", null, "Quokka", "open");
  await word("Wordone", "first word");
  await word("Wordhidden", "secret word", 1);
  await verified("Where is the market?", "Paite market line");
  await verified("How are you today?", "Paite greeting line");
  return { s1 };
}
const count = async (t: string) => (await env.WIKI.prepare(`SELECT COUNT(*) AS n FROM ${t}`).first<{ n: number }>())!.n;

describe("site data in the wiki", () => {
  it("first sync adds every live item as an approved, trust 1, non-exportable source with one chunk", async () => {
    await seed();
    expect(await syncSiteSources(env, NOW)).toEqual({ added: 5, changed: 0, removed: 0, total: 5 });
    const { results } = await env.WIKI.prepare("SELECT s.kind, s.status, s.trust, s.exportable, (SELECT COUNT(*) FROM kb_chunks c WHERE c.source_id = s.id) AS n FROM kb_sources s").all<any>();
    expect(results).toHaveLength(5);
    for (const r of results) expect(r).toEqual({ kind: "site", status: "approved", trust: 1, exportable: 0, n: 1 });
  });
  it("search finds sayings and words with their anchors, and not hidden or open ones", async () => {
    const { s1 } = await seed();
    await syncSiteSources(env, NOW);
    const hit = await searchChunks(env, ["strength"]);
    expect(hit).toHaveLength(1);
    expect(hit[0].url).toBe(`/proverbs#p-${s1}`);
    expect((await searchChunks(env, ["Wordone"])).length).toBe(1);
    for (const t of ["Wordhidden", "Zebrafish", "Quokka"]) expect(await searchChunks(env, [t])).toEqual([]);
  });
  it("a second sync with no change returns null and writes nothing", async () => {
    await seed();
    await syncSiteSources(env, NOW);
    const before = [await count("kb_sources"), await count("kb_chunks")];
    expect(await syncSiteSources(env, NOW + 1000)).toBeNull();
    expect([await count("kb_sources"), await count("kb_chunks")]).toEqual(before);
  });
  it("an edited meaning is re-indexed", async () => {
    const { s1 } = await seed();
    await syncSiteSources(env, NOW);
    await env.DB.prepare("UPDATE proverbs SET explainer_en = 'Cooperation wins' WHERE id = ?1").bind(s1).run();
    expect(await syncSiteSources(env, NOW + 1000)).toEqual({ added: 0, changed: 1, removed: 0, total: 5 });
    expect((await searchChunks(env, ["Cooperation"])).length).toBe(1);
    expect(await searchChunks(env, ["strength"])).toEqual([]);
  });
  it("a hidden word and an undone pair are removed with their chunks", async () => {
    await seed();
    await syncSiteSources(env, NOW);
    await env.DB.prepare("UPDATE glossary SET hidden = 1 WHERE paite = 'Wordone'").run();
    await env.DB.prepare("UPDATE reviews SET undone_at = datetime('now') WHERE sentence_id = (SELECT id FROM sentences WHERE english = 'How are you today?')").run();
    expect(await syncSiteSources(env, NOW + 1000)).toEqual({ added: 0, changed: 0, removed: 2, total: 3 });
    expect(await searchChunks(env, ["Wordone"])).toEqual([]);
    expect(await searchChunks(env, ["greeting"])).toEqual([]);
    expect(await count("kb_chunks")).toBe(3);
  });
  it("refuses to empty the wiki when no site data is read", async () => {
    for (let i = 0; i < 51; i++) await word(`Word${i}x`, `meaning ${i}`);
    expect((await syncSiteSources(env, NOW))!.added).toBe(51);
    await env.DB.prepare("DELETE FROM glossary").run();
    await env.DB.prepare("DELETE FROM proverbs").run();
    await env.DB.prepare("DELETE FROM reviews").run();
    await env.DB.prepare("DELETE FROM answers").run();
    await env.DB.prepare("DELETE FROM sentences").run();
    await expect(syncSiteSources(env, NOW + 1000)).rejects.toThrow("refusing to empty");
    expect(await count("kb_sources")).toBe(51);
  });
  it("stores the Paite exactly as in the database", async () => {
    const paite = "Test’ âline";
    await saying(paite, "Placeholder", null, null);
    await syncSiteSources(env, NOW);
    const c = await env.WIKI.prepare("SELECT text FROM kb_chunks").first<{ text: string }>();
    expect(c!.text.split("\n")).toContain(`Paite saying (Pau Upa, idiom): ${paite}`);
  });
  it("POST /review/api/wiki/sync works for a reviewer and needs sign-in", async () => {
    await seed();
    const r = await rev("/review/api/wiki/sync", {});
    expect(r.status).toBe(200);
    expect(((await r.json()) as any).result.added).toBe(5);
    expect((await call("/review/api/wiki/sync", { method: "POST", body: "{}" })).status).toBe(401);
  });
  it("site sources cannot be decided or withdrawn", async () => {
    await seed();
    await syncSiteSources(env, NOW);
    const { id } = (await env.WIKI.prepare("SELECT id FROM kb_sources LIMIT 1").first<{ id: number }>())!;
    expect((await rev("/review/api/wiki/decide", { id, decision: "approve" })).status).toBe(404);
    expect((await rev("/review/api/wiki/withdraw", { id, reason: "x" })).status).toBe(404);
  });
});
