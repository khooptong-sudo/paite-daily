import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import "./helpers";
import { NOW } from "./helpers";
import { ask } from "../src/kbask";
import { sha256Hex, withdrawSource } from "../src/kb";

const keyed = { ...env, DEEPSEEK_API_KEY: "k" };
const TEXT = "Quokkaword zanzibar strength passage";

describe("withdrawal completeness", () => {
  it("after withdrawSource no copy of the withdrawn text remains in answer logs/cache", async () => {
    const s = await env.WIKI.prepare("INSERT INTO kb_sources (kind, title, url, rights, trust, status, added_by, created_at, updated_at) VALUES ('book','B','https://example.org/b','quote-only',2,'approved','x',1,1) RETURNING id").first<{ id: number }>();
    const c = await env.WIKI.prepare("INSERT INTO kb_chunks (source_id, ordinal, locator, text, sha256) VALUES (?1,1,'p. 1',?2,?3) RETURNING id").bind(s!.id, TEXT, await sha256Hex(TEXT)).first<{ id: number }>();
    const reply = { status: "answer", parts: [{ type: "text", text: "It says this." }, { type: "quote", chunk: c!.id, text: "zanzibar strength" }], sources: [c!.id] };
    const f = (async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(reply) } }] }))) as unknown as typeof fetch;
    const a = await ask(keyed, f, "What is zanzibar strength?", { via: "review", key: "rev:a" }, NOW);
    expect(a.status).toBe("answer");
    const art = await env.WIKI.prepare("INSERT INTO kb_articles (slug, title, status, created_by, created_at, updated_at) VALUES ('t','T','published','x',1,1) RETURNING id").first<{ id: number }>();
    const blocks = [{ type: "text", text: "It says this.", cites: [c!.id] }, { type: "quote", chunk: c!.id, text: "zanzibar strength" }];
    await env.WIKI.prepare("INSERT INTO kb_article_revs (article_id, body, cited, author, created_at) VALUES (?1, ?2, ?3, 'x', 1)").bind(art!.id, JSON.stringify(blocks), JSON.stringify([[c!.id, "s"]])).run();
    await withdrawSource(env, s!.id, { email: "o@example.org" }, "takedown", NOW);
    const logs = (await env.WIKI.prepare("SELECT answer FROM kb_asks").all<{ answer: string | null }>()).results.map((r) => r.answer ?? "");
    const cache = (await env.WIKI.prepare("SELECT answer FROM kb_ask_cache").all<{ answer: string }>()).results.map((r) => r.answer);
    const revs = (await env.WIKI.prepare("SELECT body FROM kb_article_revs").all<{ body: string }>()).results.map((r) => r.body);
    expect(await env.WIKI.prepare("SELECT COUNT(*) AS n FROM kb_asks WHERE answer IS NULL AND q <> ''").first<{ n: number }>()).toEqual({ n: 1 }); // the log row stays
    expect([...logs, ...cache, ...revs].filter((x) => x.includes("zanzibar"))).toEqual([]);
  });
});
