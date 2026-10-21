import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { glossaryJson, getGlossary, cleanEntries, runGlossary } from "../src/glossary";
import { putGlossary } from "../src/export";
import { addSentences, call, fakeDeps } from "./helpers";

const keyed = { ...env, DEEPSEEK_API_KEY: "k" };
const reply = (o: unknown) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(o) } }] }));

async function answer(english: string, paite: string, explanation: string | null, status = "accepted", direction = "en2pai") {
  const [sid] = await addSentences(english);
  if (direction !== "en2pai") await env.DB.prepare("UPDATE sentences SET direction = ?1 WHERE id = ?2").bind(direction, sid).run();
  const a = await env.DB.prepare("INSERT INTO answers (sentence_id, paite, register, phone_id, contributor_name, status, explanation) VALUES (?1, ?2, 'both', 'secret-phone', 'SecretName', ?3, ?4) RETURNING id")
    .bind(sid, paite, status, explanation).first<{ id: number }>();
  return { sid, id: a!.id };
}

describe("cleanEntries", () => {
  it("validates shape, caps counts and lengths, drops invented words", () => {
    const many = Array.from({ length: 15 }, () => ({ paite: "dam", english: "well" }));
    expect(cleanEntries(many, "ka dam")).toEqual([]);
    expect(cleanEntries({ entries: many }, "ka dam")).toHaveLength(10);
    expect(cleanEntries({ entries: [{ paite: "DAM", english: "e".repeat(300), note: "n".repeat(300) }, { paite: "pasian", english: "god" }, { paite: 5, english: "x" }, null, { paite: "dam" }] }, "Ka Dam")).toEqual([
      { paite: "DAM", english: "E" + "e".repeat(119), note: "n".repeat(200) },
    ]);
    expect(cleanEntries("x", "a")).toEqual([]);
    expect(cleanEntries({ entries: [{ paite: "d".repeat(70), english: "x" }] }, "d".repeat(70))[0].paite).toHaveLength(60);
  });
});

describe("runGlossary", () => {
  it("skips without key, non-verified, reverse and empty notes; stores entries; marks done", async () => {
    const good = await answer("I am well.", "Ka dam e.", "dam means well");
    await answer("A", "Ka dam", "note", "new");
    await answer("B", "Ka dam", "note", "accepted", "pai2en");
    await answer("C", "Ka dam", "  ");
    await answer("D", "Ka dam", null);
    expect(await runGlossary(env, fetch)).toBeNull();
    const bodies: string[] = [];
    const f = (async (_u: string, init: RequestInit) => { bodies.push(init.body as string); return reply({ entries: [{ paite: "dam", english: "well", note: "adj" }, { paite: "zzz", english: "invented" }] }); }) as unknown as typeof fetch;
    expect(await runGlossary(keyed, f)).toEqual({ entries: 1, failed: 0 });
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).not.toMatch(/secret-phone|SecretName/);
    expect(await getGlossary(env)).toEqual([{ id: expect.any(Number), paite: "Dam", english: "Well", note: "adj", example: { paite: "Ka dam e.", english: "I am well." }, source: "note", by: null, reviewed_by: null }]);
    expect(await runGlossary(keyed, f)).toBeNull();
    expect((await env.DB.prepare("SELECT gloss_done FROM answers WHERE id = ?1").bind(good.id).first<any>()).gloss_done).toBe(1);
  });

  it("failures count attempts, stop after 3; duplicates are ignored", async () => {
    const a = await answer("I am well.", "Ka dam e.", "dam means well");
    const bad = (async () => new Response("no", { status: 500 })) as unknown as typeof fetch;
    for (let i = 0; i < 3; i++) expect(await runGlossary(keyed, bad)).toEqual({ entries: 0, failed: 1 });
    expect(await runGlossary(keyed, bad)).toBeNull();
    await env.DB.prepare("UPDATE answers SET gloss_attempts = 0 WHERE id = ?1").bind(a.id).run();
    const junk = (async () => new Response(JSON.stringify({ choices: [{ message: { content: "not json" } }] }))) as unknown as typeof fetch;
    expect(await runGlossary(keyed, junk)).toEqual({ entries: 0, failed: 1 });
    const ok = (async () => reply({ entries: [{ paite: "dam", english: "Well" }, { paite: "Dam", english: "well" }] })) as unknown as typeof fetch;
    expect(await runGlossary(keyed, ok)).toEqual({ entries: 2, failed: 0 });
    expect(await getGlossary(env)).toHaveLength(1);
  });
});

describe("thrown fetch", () => {
  it("counts the attempt, so the 4th run does nothing", async () => {
    await answer("I am well.", "Ka dam e.", "dam means well");
    const boom = (async () => { throw new Error("network"); }) as unknown as typeof fetch;
    for (let i = 0; i < 3; i++) expect(await runGlossary(keyed, boom)).toEqual({ entries: 0, failed: 1 });
    expect(await runGlossary(keyed, boom)).toBeNull();
  });
});

describe("page, hide, export", () => {
  const seed = async () => {
    const a = await answer("I am <b>well</b>.", "Ka <i>dam</i> e.", "n");
    await env.DB.prepare("INSERT INTO glossary (paite, english, note, answer_id, sentence_id) VALUES ('<i>dam</i>', '<b>well</b>', '<script>x</script>', ?1, ?2), ('Zu', 'drink', NULL, ?1, ?2), ('abc', 'letters', NULL, ?1, ?2)").bind(a.id, a.sid).run();
  };

  it("/glossary escapes, groups A-Z, shows empty state", async () => {
    let html = await (await call("/glossary")).text();
    expect(html).toContain("No words yet");
    await seed();
    html = await (await call("/glossary")).text();
    expect(html).not.toContain("<script>x</script>");
    expect(html).not.toContain("<i>dam</i>");
    expect(html).toContain("&lt;i&gt;dam&lt;/i&gt;");
    expect(html).toContain('aria-label="A"');
    expect(html).toContain('aria-label="Z"');
    expect(html).toContain('aria-label="#"');
    expect(html).toContain("<title>Paite Word List</title>");
    expect(html).toContain('<details class="rows" aria-label="A" data-letter="A">');
    expect(html).toContain('<summary><span class="ltr">A</span><span class="cnt">');
    // every letter is shut until the visitor opens it
    expect(html).not.toMatch(/<details class="rows"[^>]*\sopen/);
    expect(html).not.toMatch(/secret-phone|SecretName/);
    expect(html).toContain('<footer class="foot">');
    expect(html).toContain("Click Here to Buy Us Coffee");
    expect(html).toContain("the data stays free for everyone");
    expect(html).toContain('<p class="contact">');
    expect(html).toContain('<script src="/footer.js"></script>');
    expect(html).toContain('<meta property="og:image" content="https://paite.lamkalabs.com/og.png">');
    expect(html).toContain('<a class="mail" href="mailto:theconcierge@lamkalabs.com"');
    expect(html).toContain("wa.me/918375098415");
    expect(html).not.toContain("Write to");
    expect(html).not.toContain("khooptong@lamkalabs.com");
    expect(html).not.toContain("khooptong@lamka.net");
    expect(html).not.toContain("83750 98415");
    expect(html).toContain('<a class="back" href="/review">Reviewer');
    expect(html).toContain('<script src="/track.js"></script>');
  });

  it("hide is reviewer only and removes the entry from page and export", async () => {
    await seed();
    const rev = fakeDeps({ verifyAccess: async () => "rev@example.org" });
    const body = (id: number) => ({ method: "POST", body: JSON.stringify({ id }) });
    const id = (await getGlossary(env)).find((e) => e.paite === "Zu")!.id;
    expect((await call("/review/api/glossary/hide", body(id))).status).toBe(401);
    expect((await call("/review/api/glossary/hide", body(id), fakeDeps({ verifyAccess: async () => "nobody@example.org" }))).status).toBe(403);
    expect((await call("/review/api/glossary/hide", { method: "POST", body: "{}" }, rev)).status).toBe(400);
    expect((await call("/review/api/glossary/hide", body(99999), rev)).status).toBe(404);
    expect((await call("/review/api/glossary", {}, rev)).status).toBe(200);
    expect((await call("/review/api/glossary/hide", body(id), rev)).status).toBe(200);
    const left = await getGlossary(env);
    expect(left.some((e) => e.id === id)).toBe(false);
    expect(glossaryJson(left)).not.toContain("drink");
    expect(await (await call("/glossary")).text()).not.toContain("drink");
  });

  it("putGlossary writes glossary.json, skips when unchanged, throws on failure", async () => {
    expect(await putGlossary(env, (async () => new Response("", { status: 404 })) as unknown as typeof fetch)).toBe(false);
    await seed();
    let stored = "", puts = 0, status = 201;
    const f = (async (_u: string, init?: RequestInit) => {
      if (init?.method === "PUT") { puts++; if (status !== 201) return new Response("x", { status }); stored = JSON.parse(init.body as string).content; return new Response("{}", { status }); }
      return stored ? new Response(JSON.stringify({ sha: "s", content: stored.replace(/(.{60})/g, "$1\n") })) : new Response("", { status: 404 });
    }) as unknown as typeof fetch;
    expect(await putGlossary(env, f)).toBe(true);
    const json = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(stored), (c) => c.charCodeAt(0))));
    expect(json.entries.map((e: any) => e.paite).sort()).toEqual(["<i>dam</i>", "Zu", "Abc"].sort());
    expect(JSON.stringify(json)).not.toMatch(/secret-phone|SecretName|"id"/);
    expect(await putGlossary(env, f)).toBe(false);
    expect(puts).toBe(1);
    stored = ""; status = 500;
    await expect(putGlossary(env, f)).rejects.toThrow("500");
  });

  it("putGlossary overwrites the file with no entries after the last one is hidden", async () => {
    await seed();
    let stored = "";
    const f = (async (_u: string, init?: RequestInit) => {
      if (init?.method === "PUT") { stored = JSON.parse(init.body as string).content; return new Response("{}", { status: 201 }); }
      return stored ? new Response(JSON.stringify({ sha: "s", content: stored })) : new Response("", { status: 404 });
    }) as unknown as typeof fetch;
    expect(await putGlossary(env, f)).toBe(true);
    await env.DB.prepare("UPDATE glossary SET hidden = 1").run();
    expect(await putGlossary(env, f)).toBe(true);
    expect(JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(stored), (c) => c.charCodeAt(0))))).toEqual({ entries: [] });
  });
});

describe("reviewer credit on the public word list", () => {
  it("shows the reviewer's name, never the email, on the page data and in glossary.json", async () => {
    await env.DB.prepare("INSERT INTO reviewers (email, name, added_by) VALUES ('rev@example.com', 'Lun Ngaihte', 'owner@example.com')").run();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO glossary (paite, english, source, reviewed_by) VALUES ('dai', 'quiet', 'contributed', 'Rev@Example.com')"),
      env.DB.prepare("INSERT INTO glossary (paite, english, source, reviewed_by) VALUES ('bul', 'base', 'contributed', 'gone@example.com')"),
      env.DB.prepare("INSERT INTO glossary (paite, english, source, reviewed_by) VALUES ('baal', 'end', 'contributed', 'Lun Ngaihte')"),
    ]);
    const xs = await getGlossary(env);
    expect(Object.fromEntries(xs.map((x) => [x.paite, x.reviewed_by]))).toEqual({ Dai: "Lun Ngaihte", Bul: "a reviewer", Baal: "Lun Ngaihte" });
    expect(glossaryJson(xs)).not.toContain("@");
  });
});

