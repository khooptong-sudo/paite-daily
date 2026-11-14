import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import wikiJs from "../public/review/wiki.js?raw";
import reviewHtml from "../public/review/wiki.html?raw";
import adminHtml from "../public/admin/wiki.html?raw";
import { renderAbout } from "../src/about";
import { createApp } from "../src/index";
import { ask } from "../src/kbask";
import { syncSiteSources } from "../src/kbsite";
import { ATTACKS, addTests, autoTests, runReport, seedAttacks, startRun, stepRun } from "../src/kbtest";
import { call, fakeDeps, NOW } from "./helpers";

const keyed = { ...env, DEEPSEEK_API_KEY: "k" };
const reply = (o: unknown) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(o) } }] }));
const WHO = { email: "rev@example.org" };
const OWNER = "owner@example.org";
const H = { "X-Admin": "1", Origin: "https://paite.lamkalabs.com" };
const DAY = new Date(NOW).toISOString().slice(0, 10);

async function saying(paite: string, english: string) {
  await env.DB.prepare("INSERT INTO proverbs (kind, paite, english, explainer, explainer_en, entered_from, status) VALUES ('idiom', ?1, ?2, NULL, NULL, 'pai2en', 'live')").bind(paite, english).run();
}
async function word(paite: string, english: string) {
  await env.DB.prepare("INSERT INTO glossary (paite, english, note, source, reviewed_by, hidden) VALUES (?1, ?2, NULL, 'test', 'rev@example.org', 0)").bind(paite, english).run();
}
const chunkOf = async (text: string) => (await env.WIKI.prepare("SELECT c.id AS chunk, s.site_key AS key FROM kb_chunks c JOIN kb_sources s ON s.id = c.source_id WHERE c.text LIKE ?1").bind(`%${text}%`).first<{ chunk: number; key: string }>())!;
const rev = (path: string, body?: unknown) =>
  call(path, body === undefined ? {} : { method: "POST", body: JSON.stringify(body) }, fakeDeps({ verifyReviewer: async () => WHO.email }));
async function signIn(email: string): Promise<string> {
  const token = "a".repeat(63) + "1";
  const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)))].map((b) => b.toString(16).padStart(2, "0")).join("");
  await env.DB.prepare("INSERT INTO admin_links (token_hash, email, expires_at) VALUES (?1, ?2, ?3)").bind(hash, email, NOW + 60_000).run();
  const r = await call("/admin/api/password/set", { method: "POST", headers: H, body: JSON.stringify({ token, password: "correct horse" }) });
  expect(r.status).toBe(200);
  return r.headers.get("Set-Cookie")!.split(";")[0];
}

describe("launch gate", () => {
  it("1. the visitor share stops visitors, not reviewers", async () => {
    await saying("Testword", "Two heads");
    await syncSiteSources(env, NOW);
    await env.WIKI.prepare("INSERT INTO kb_counters (name, n) VALUES (?1, 240)").bind(`ask:dp:${DAY}`).run();
    let calls = 0;
    const fetcher = (async () => { calls++; return reply({ status: "none" }); }) as unknown as typeof fetch;
    const a = await ask(keyed, fetcher, "Testword two heads?", { via: "public", key: "ip:x" }, NOW);
    expect(a.status).toBe("limited");
    expect(calls).toBe(0);
    expect((await env.WIKI.prepare("SELECT reason FROM kb_asks WHERE status = 'limited'").first<{ reason: string }>())!.reason).toBe("day_public");
    const r = await ask(keyed, fetcher, "Testword two heads?", { via: "review", key: "rev:a@example.org" }, NOW);
    expect(r.status).toBe("none");
    expect(calls).toBe(1);
  });

  it("2. addTests parses lines, skips bad ones and duplicates, refuses more than 200", async () => {
    const r = await addTests(env, "What is it? | proverb:5 | a note\nJust a question\nBad expect | nope:1\nJust a question\nxy", WHO, NOW);
    expect(r).toEqual({ added: 2, skipped: 3 });
    const rows = (await env.WIKI.prepare("SELECT q, kind, expect, note FROM kb_tests ORDER BY id").all<any>()).results;
    expect(rows).toEqual([
      { q: "What is it?", kind: "owner", expect: "proverb:5", note: "a note" },
      { q: "Just a question", kind: "owner", expect: null, note: null },
    ]);
    expect(await addTests(env, Array.from({ length: 201 }, (_, i) => `Question number ${i}`).join("\n"), WHO, NOW)).toEqual({ error: "bad_request" });
    expect(await addTests(env, 5, WHO, NOW)).toEqual({ error: "bad_request" });
  });

  it("3. autoTests uses English lines of approved site sources only, and never repeats", async () => {
    await saying("Testword", "Two heads");
    await saying("Testword placeholder line", "One hand");
    await word("Testword", "Gate");
    await word("Placeholder’ âline", "River");
    await syncSiteSources(env, NOW);
    await env.WIKI.prepare("INSERT INTO kb_sources (kind, site_key, title, rights, trust, status, added_by, created_at, updated_at) VALUES ('site', 'proverb:abc', 't', 'open', 1, 'pending', 'site', 1, 1)").run();
    await env.WIKI.prepare("INSERT INTO kb_chunks (source_id, ordinal, text, sha256) VALUES ((SELECT id FROM kb_sources WHERE site_key = 'proverb:abc'), 1, 'English: Hidden pending', 'x')").run();
    expect(await autoTests(env, 10, WHO, NOW)).toEqual({ added: 4 });
    const rows = (await env.WIKI.prepare("SELECT q, kind, expect FROM kb_tests").all<{ q: string; kind: string; expect: string }>()).results;
    expect(rows).toHaveLength(4);
    for (const r of rows) {
      expect(r.kind).toBe("auto");
      expect(r.q).not.toContain("Testword");
      expect(r.q).not.toContain("Placeholder");
      expect(r.q).not.toContain("Hidden");
      expect(r.expect).toMatch(/^(proverb|glossary):/);
    }
    expect(rows.map((r) => r.q).sort()).toEqual([
      'What does the saying meaning "One hand" refer to?',
      'What does the saying meaning "Two heads" refer to?',
      'What is the Paite word for "Gate"?',
      'What is the Paite word for "River"?',
    ]);
    expect(rows.find((r) => r.q.includes("Two heads"))!.expect).toBe((await chunkOf("Two heads")).key);
    expect(await autoTests(env, 10, WHO, NOW)).toEqual({ added: 0 });
  });

  it("4. seedAttacks adds the twelve once", async () => {
    expect(ATTACKS).toHaveLength(12);
    expect(await seedAttacks(env, WHO, NOW)).toEqual({ added: 12 });
    expect(await seedAttacks(env, WHO, NOW)).toEqual({ added: 0 });
  });

  async function setup() {
    await saying("Testword", "Two heads");
    await saying("Testword placeholder line", "One hand");
    await syncSiteSources(env, NOW);
    const a = await chunkOf("Two heads");
    const b = await chunkOf("One hand");
    await addTests(env, `Testword one | ${a.key}\nTestword two | ${a.key}\nTestword three | ${a.key}\nTestword four | ${a.key}`, WHO, NOW);
    await seedAttacks(env, WHO, NOW);
    // Replies chosen by which test question the model was shown.
    const fetcher = (async (_u: string, init: RequestInit) => {
      const body = init.body as string;
      if (body.includes("Testword one")) return reply({ status: "answer", parts: [{ type: "quote", chunk: a.chunk, text: "Testword" }], sources: [a.chunk] });
      if (body.includes("Testword two")) return reply({ status: "answer", parts: [{ type: "quote", chunk: b.chunk, text: "Testword placeholder line" }], sources: [b.chunk] });
      if (body.includes("Testword three")) return reply({ status: "none" });
      if (body.includes("Testword four")) return reply({ status: "answer", parts: [{ type: "quote", chunk: a.chunk, text: "Testword gamma" }], sources: [a.chunk] });
      return reply({ status: "none" });
    }) as unknown as typeof fetch;
    return { a, b, fetcher };
  }
  async function fullRun(fetcher: typeof fetch) {
    const run = await startRun(env, WHO, NOW);
    if ("error" in run) throw new Error("no tests");
    let step = { done: 0, total: run.total };
    for (let i = 0; i < 20 && step.done < step.total; i++) {
      const s = await stepRun(keyed, fetcher, run.runId, NOW);
      if ("error" in s) throw new Error("not found");
      step = s;
    }
    expect(step.done).toBe(step.total);
    return run;
  }

  it("5. a full run counts hits, other sources, none and failed checks", async () => {
    const { fetcher } = await setup();
    const run = await fullRun(fetcher);
    expect(run.total).toBe(16);
    const rep = (await runReport(env, run.runId))!;
    const row = (q: string) => rep.rows.find((r) => r.q === q)!;
    expect(row("Testword one")).toMatchObject({ status: "answer", hit: 1 });
    expect(row("Testword two")).toMatchObject({ status: "answer", hit: 0 });
    expect(row("Testword three")).toMatchObject({ status: "none", hit: 0 });
    expect(row("Testword four")).toMatchObject({ status: "failed", hit: 0 });
    expect(rep.byKind.owner).toEqual({ total: 4, answered: 2, hit: 1, none: 1, failed: 1, limited: 0 });
    expect(rep.byKind.attack.total).toBe(12);
  });

  it("6. attack rows have no expectation and keep their stored answer", async () => {
    const { fetcher } = await setup();
    const run = await fullRun(fetcher);
    const rep = (await runReport(env, run.runId))!;
    const attacks = rep.rows.filter((r) => r.kind === "attack");
    expect(attacks).toHaveLength(12);
    for (const r of attacks) expect(r.hit).toBeNull();
    const one = rep.rows.find((r) => r.q === "Testword one")!;
    expect(one.answer!.parts).toEqual([{ type: "quote", chunk: expect.any(Number), text: "Testword" }]);
    expect(one.answer!.sources).toHaveLength(1);
  });

  it("7. runs use the key test:<runId>, not the reviewer's hourly counter", async () => {
    const { fetcher } = await setup();
    const run = await fullRun(fetcher);
    const names = (await env.WIKI.prepare("SELECT name FROM kb_counters").all<{ name: string }>()).results.map((r) => r.name);
    expect(names.some((n) => n.startsWith("ask:h:rev:"))).toBe(false);
    expect(names.some((n) => n.startsWith(`ask:h:test:${run.runId}:`))).toBe(true);
  });

  it("8. routes need a reviewer or an admin", async () => {
    const ok = await rev("/review/api/wiki/tests/add", { lines: "A fair question" });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ added: 1, skipped: 0 });
    const out = await call("/review/api/wiki/tests/add", { method: "POST", body: JSON.stringify({ lines: "A fair question" }) });
    expect(out.status).toBe(401);
    const cookie = await signIn(OWNER);
    expect((await call("/admin/api/wiki/tests", { headers: { Cookie: cookie } })).status).toBe(200);
    expect((await rev("/review/api/wiki/tests/step", { runId: 999 })).status).toBe(404);
    expect((await rev("/review/api/wiki/tests/report?run=999")).status).toBe(404);
  });

  it("9. the About page explains Tongdot | Tongsan only when the wiki is public", async () => {
    expect(renderAbout()).not.toContain("Tongdot | Tongsan");
    expect(renderAbout(false)).not.toContain("Tongdot | Tongsan");
    const on = renderAbout(true);
    expect(on).toContain("Tongdot | Tongsan");
    expect(on).toContain('href="/wiki"');
    const page = (e: any) => createApp(fakeDeps())(new Request("https://paite.lamkalabs.com/about"), e).then((r) => r.text());
    expect(await page({ ...env, WIKI_PUBLIC: "1" })).toContain("Tongdot | Tongsan");
    expect(await page(env)).not.toContain("Tongdot | Tongsan");
  });

  it("10. the review page has the test section and builds it without innerHTML", () => {
    for (const p of ["/tests/run", "/tests/step", "/tests/report"]) expect(wikiJs).toContain(p);
    expect(wikiJs).not.toMatch(/innerHTML|insertAdjacentHTML|outerHTML/);
    expect(reviewHtml).toContain('id="sec-tests"');
    expect(adminHtml).toContain('id="sec-tests"');
  });
});
