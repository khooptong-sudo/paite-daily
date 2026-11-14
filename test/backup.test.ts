import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { runBackup, runWikiBackup } from "../src/backup";
import { addChunks, addSource } from "../src/kb";
import { addSentences, NOW, PHONE_A } from "./helpers";

const gunzip = async (b: ArrayBuffer) => JSON.parse(await new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream("gzip"))).text());

describe("nightly backup", () => {
  it("writes every table gzipped and prunes backups older than 30 days", async () => {
    const [sid] = await addSentences("Backup me.");
    await env.DB.prepare("INSERT INTO answers (sentence_id, phone_id, paite, register, status) VALUES (?1, ?2, 'Ka kem', 'both', 'new')").bind(sid, PHONE_A).run();
    const now = Date.UTC(2026, 5, 30, 12);
    await env.AUDIO.put("backups/2026-05-30.json.gz", "x"); // 31 days old
    await env.AUDIO.put("backups/2026-06-05.json.gz", "x"); // recent

    const r = await runBackup(env, now);
    expect(r.key).toBe("backups/2026-06-30.json.gz");
    expect(r.deleted).toBe(1);
    expect(await env.AUDIO.get("backups/2026-05-30.json.gz")).toBeNull();
    expect(await env.AUDIO.get("backups/2026-06-05.json.gz")).not.toBeNull();

    const obj = await env.AUDIO.get(r.key);
    const data = await gunzip(await obj!.arrayBuffer());
    expect(data.createdAt).toBe("2026-06-30T12:00:00.000Z");
    expect(data.tables.sentences.some((s: { english: string }) => s.english === "Backup me.")).toBe(true);
    expect(data.tables.answers.some((a: { paite: string }) => a.paite === "Ka kem")).toBe(true);
    expect(data.tables.d1_migrations).toBeUndefined();
  });
  it("backs up the wiki into its own bucket, without the full-text index tables", async () => {
    const id = await addSource(env, { kind: "book", title: "Backup book", language: "en", rights: "open" }, "someone@example.org", NOW);
    await addChunks(env, id, [{ text: "Some passage to keep." }]);
    const now = Date.UTC(2026, 5, 30, 12);
    const r = await runWikiBackup(env, now);
    expect(r.key).toBe("backups/2026-06-30.json.gz");
    const data = await gunzip(await (await env.WIKI_FILES.get(r.key))!.arrayBuffer());
    expect(data.tables.kb_sources.map((s: { title: string }) => s.title)).toEqual(["Backup book"]);
    expect(data.tables.kb_chunks.map((c: { text: string }) => c.text)).toEqual(["Some passage to keep."]);
    expect(Object.keys(data.tables).filter((t) => t.startsWith("kb_chunks_fts"))).toEqual([]);
  });
});
