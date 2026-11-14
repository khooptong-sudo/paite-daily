import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import wikiJs from "../public/review/wiki.js?raw";
import reviewWiki from "../public/review/wiki.html?raw";
import adminWiki from "../public/admin/wiki.html?raw";
import reviewIndex from "../public/review/index.html?raw";
import { ask } from "../src/kbask";
import { syncSiteSources } from "../src/kbsite";
import { call, fakeDeps, NOW } from "./helpers";

const REV = "rev@example.org";
const OWNER = "owner@example.org";
const H = { "X-Admin": "1", Origin: "https://paite.lamkalabs.com" };
const rev = (path: string, body?: unknown, email = REV) =>
  call(path, body === undefined ? {} : { method: "POST", body: JSON.stringify(body) }, fakeDeps({ verifyReviewer: async () => email }));
async function signIn(email: string): Promise<string> {
  const token = "a".repeat(63) + (email === OWNER ? "1" : "2");
  const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)))].map((b) => b.toString(16).padStart(2, "0")).join("");
  await env.DB.prepare("INSERT INTO admin_links (token_hash, email, expires_at) VALUES (?1, ?2, ?3)").bind(hash, email, NOW + 60_000).run();
  const r = await call("/admin/api/password/set", { method: "POST", headers: H, body: JSON.stringify({ token, password: "correct horse" }) });
  expect(r.status).toBe(200);
  return r.headers.get("Set-Cookie")!.split(";")[0];
}

const ANSWER = JSON.stringify({ parts: [{ type: "text", text: "It says this." }], sources: [] });
async function addAsk(q: string, qKey: string, status: string, at: number, reason: string | null = null, answer: string | null = null): Promise<number> {
  const r = await env.WIKI.prepare("INSERT INTO kb_asks (q, q_key, via, retrieved, status, reason, at, answer) VALUES (?1, ?2, 'public', '[]', ?3, ?4, ?5, ?6) RETURNING id")
    .bind(q, qKey, status, reason, at, answer).first<{ id: number }>();
  return r!.id;
}
const vote = (askId: number, right: number, byKey: string, note: string | null = null) =>
  env.WIKI.prepare("INSERT INTO kb_flags (ask_id, right, note, by_key, at) VALUES (?1, ?2, ?3, ?4, ?5)").bind(askId, right, note, byKey, NOW).run();

describe("wiki review page", () => {
  it("1. an answered ask stores its answer; a none row stores null", async () => {
    await env.DB.prepare("INSERT INTO proverbs (kind, paite, english, explainer, explainer_en, entered_from, status) VALUES ('idiom', 'Testword alpha', 'Two heads', NULL, 'Sharing brings strength', 'pai2en', 'live')").run();
    await syncSiteSources(env, NOW);
    const c = (await env.WIKI.prepare("SELECT id FROM kb_chunks WHERE text LIKE '%Testword alpha%'").first<{ id: number }>())!;
    const fake = (o: unknown) => (async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(o) } }] }))) as unknown as typeof fetch;
    const keyed = { ...env, DEEPSEEK_API_KEY: "k" };
    const who = { via: "review" as const, key: "rev:a@example.org" };
    await ask(keyed, fake({ status: "answer", parts: [{ type: "text", text: "It says this." }, { type: "quote", chunk: c.id, text: "Testword alpha" }], sources: [c.id] }), "What brings strength?", who, NOW);
    await ask(keyed, fake({ status: "none", parts: [], sources: [] }), "Who sailed the moon?", who, NOW);
    const rows = (await env.WIKI.prepare("SELECT status, answer FROM kb_asks ORDER BY id").all<{ status: string; answer: string | null }>()).results;
    expect(rows[0].status).toBe("answer");
    const a = JSON.parse(rows[0].answer!);
    expect(a.parts).toHaveLength(2);
    expect(a.sources[0].chunk).toBe(c.id);
    expect(rows[1].answer).toBeNull();
  });
  it("2. flagged lists asks with a No vote, with answer and votes; Yes-only asks are not listed", async () => {
    const bad = await addAsk("Bad one?", "bad one", "answer", NOW - 10, null, ANSWER);
    const good = await addAsk("Good one?", "good one", "answer", NOW - 10, null, ANSWER);
    await vote(bad, 0, `rev:${REV}`, "Wrong date");
    await vote(bad, 1, "rev:other@example.org");
    await vote(good, 1, `rev:${REV}`);
    const r = await rev("/review/api/wiki/asks/flagged");
    expect(r.status).toBe(200);
    const { asks } = await r.json<{ asks: any[] }>();
    expect(asks).toHaveLength(1);
    expect(asks[0]).toMatchObject({ askId: bad, q: "Bad one?" });
    expect(asks[0].answer.parts[0].text).toBe("It says this.");
    expect(asks[0].votes).toHaveLength(2);
    expect(asks[0].votes).toContainEqual({ by: REV, right: false, note: "Wrong date", at: NOW });
  });
  it("3. a visitor vote shows as visitor and the hash never leaves", async () => {
    const id = await addAsk("Hidden hash?", "hidden hash", "answer", NOW - 10, null, null);
    const hash = "ip:" + "ab12cd34".repeat(8);
    await vote(id, 0, hash);
    const text = await (await rev("/review/api/wiki/asks/flagged")).text();
    expect(text).not.toContain("ab12cd34");
    expect(JSON.parse(text).asks[0]).toMatchObject({ answer: null, votes: [{ by: "visitor", right: false }] });
  });
  it("4. open groups none asks by question; an answered question is not listed", async () => {
    await addAsk("Old wording?", "k one", "none", NOW - 200, "no_passages");
    await addAsk("New wording?", "k one", "failed", NOW - 100, "quote_mismatch");
    await addAsk("Solved?", "k two", "none", NOW - 200, "no_passages");
    await addAsk("Solved?", "k two", "answer", NOW - 100, null, ANSWER);
    const { questions } = await (await rev("/review/api/wiki/asks/open")).json<{ questions: any[] }>();
    expect(questions).toHaveLength(1);
    expect(questions[0]).toMatchObject({ qKey: "k one", q: "New wording?", asks: 2, lastAt: NOW - 100 });
    expect([...questions[0].reasons].sort()).toEqual(["no_passages", "quote_mismatch"]);
  });
  it("5. dismiss removes the item; asking again afterwards brings it back", async () => {
    await addAsk("Open?", "k open", "none", NOW - 100, "no_passages");
    expect((await rev("/review/api/wiki/asks/dismiss", { qKey: "k open" })).status).toBe(200);
    const list = async () => (await (await rev("/review/api/wiki/asks/open")).json<{ questions: unknown[] }>()).questions;
    expect(await list()).toHaveLength(0);
    await addAsk("Open?", "k open", "none", NOW + 100, "no_passages");
    expect(await list()).toHaveLength(1);
  });
  it("6. dismiss with an unknown or empty qKey is a 400", async () => {
    expect((await rev("/review/api/wiki/asks/dismiss", { qKey: "nope" })).status).toBe(400);
    expect((await rev("/review/api/wiki/asks/dismiss", { qKey: "" })).status).toBe(400);
    expect((await rev("/review/api/wiki/asks/dismiss", {})).status).toBe(400);
  });
  it("7. the admin mount serves the same routes", async () => {
    const cookie = await signIn(OWNER);
    expect((await call("/admin/api/wiki/asks/open", { headers: { Cookie: cookie } })).status).toBe(200);
    expect((await call("/admin/api/wiki/asks/open")).status).toBe(401);
  });
  it("8. the script calls every endpoint and never uses HTML strings", () => {
    for (const s of ["/asks/flagged", "/asks/open", "/asks/dismiss", "/decide", "/withdraw", "X-Admin"]) expect(wikiJs).toContain(s);
    expect(wikiJs).not.toMatch(/innerHTML|insertAdjacentHTML|outerHTML/);
  });
  it("9. both pages load the script with the right api, are noindex, and the review index links the page", () => {
    expect(reviewWiki).toContain('src="/review/wiki.js"');
    expect(reviewWiki).toContain('data-api="/review/api/wiki"');
    expect(adminWiki).toContain('src="/review/wiki.js"');
    expect(adminWiki).toContain('data-api="/admin/api/wiki"');
    expect(reviewWiki).toContain("noindex");
    expect(adminWiki).toContain("noindex");
    expect(reviewIndex).toContain('href="/review/wiki"');
  });
});
