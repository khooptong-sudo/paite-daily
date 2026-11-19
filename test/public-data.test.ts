import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import reviewJs from "../public/review/review.js?raw";
import { matchChat } from "../src/chat";
import { getContributors, renderMarkdown } from "../src/contributors";
import { exportVerified } from "../src/export";
import { getGlossary, getWordExtras, renderGlossary } from "../src/glossary";
import { addSentences, call, fakeDeps, PHONE_A, session } from "./helpers";

const decode = (b64: string) => new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
const rev = (path: string, body: unknown) => call(path, { method: "POST", body: JSON.stringify(body) }, fakeDeps({ verifyReviewer: async () => "rev@example.org" }));

async function ans(name: string, status: string, sid: number) {
  await env.DB.prepare("INSERT INTO answers (sentence_id, phone_id, paite, register, contributor_name, status) VALUES (?1, ?2, 'x', 'both', ?3, ?4)").bind(sid, PHONE_A, name, status).run();
}

async function exportLines(): Promise<any[]> {
  const puts: any[] = [];
  const fetcher = (async (_u: any, init?: RequestInit) => {
    if (init?.method === "PUT") { puts.push(JSON.parse(init.body as string)); return new Response("{}", { status: 201 }); }
    return new Response("nf", { status: 404 });
  }) as typeof fetch;
  await exportVerified(env, fetcher);
  return decode(puts[0].content).trim().split("\n").map((l) => JSON.parse(l));
}

describe("public names come only from verified work", () => {
  it("a later pending or rejected answer's name does not replace a verified contributor's name", async () => {
    const [s1, s2, s3] = await addSentences("One.", "Two.", "Three.");
    await ans("Mang", "accepted", s1);
    await ans("Buy cheap pills at example.com", "new", s2);
    await ans("Rude Name", "rejected", s3);
    const d = await getContributors(env);
    expect(d.contributors.map((c) => c.name)).toEqual(["Mang"]);
    expect(renderMarkdown(d)).not.toContain("pills");
  });
});

describe("export", () => {
  it("each also_correct variant carries its own licence; top-level licence is the accepted text's (new field: variants)", async () => {
    const [id] = await addSentences("I am well.");
    const a = await env.DB.prepare("INSERT INTO answers (sentence_id, paite, register, phone_id, contributor_name, status, licence) VALUES (?1,'Ka dam e.','both','p','Old','accepted','CC0-1.0') RETURNING id").bind(id).first<{ id: number }>();
    await env.DB.prepare("INSERT INTO answers (sentence_id, paite, register, phone_id, contributor_name, status, licence) VALUES (?1,'Ka dam hi.','both','q','New','also_correct','CC-BY-4.0')").bind(id).run();
    await env.DB.prepare("INSERT INTO answers (sentence_id, paite, register, phone_id, status) VALUES (?1,'Ka dam.','both','r','also_correct')").bind(id).run();
    await env.DB.prepare("INSERT INTO reviews (sentence_id, reviewer_email, decision, accepted_answer_id, final_paite, register) VALUES (?1,'rev@example.org','accept',?2,'Ka dam e.','spoken')").bind(id, a!.id).run();
    const [line] = await exportLines();
    expect(line.licence).toBe("CC0-1.0");
    expect(line.also_correct).toEqual(["Ka dam hi.", "Ka dam."]);
    expect(line.variants).toEqual([{ paite: "Ka dam hi.", licence: "CC-BY-4.0" }, { paite: "Ka dam.", licence: "CC-BY-4.0" }]);
  });

  it("verified_by keeps the name of a reviewer removed before the export", async () => {
    await env.DB.prepare("INSERT INTO reviewers (email, name, added_by, removed_at) VALUES ('gone@example.org','Gone Person','owner@example.org', datetime('now'))").run();
    const [id] = await addSentences("I am well.");
    const a = await env.DB.prepare("INSERT INTO answers (sentence_id, paite, register, phone_id, status) VALUES (?1,'Ka dam e.','both','p','accepted') RETURNING id").bind(id).first<{ id: number }>();
    await env.DB.prepare("INSERT INTO reviews (sentence_id, reviewer_email, decision, accepted_answer_id, final_paite, register) VALUES (?1,'gone@example.org','accept',?2,'Ka dam e.','spoken')").bind(id, a!.id).run();
    expect((await exportLines())[0].verified_by).toBe("Gone Person");
  });
});

describe("review page swapWord", () => {
  // Copied from public/review/review.js: the pattern is inside a template literal, so \p needs its backslash escaped.
  const swapWord = (text: string, from: string, to: string) => text.replace(new RegExp(`(^|[^\\p{L}'’])(${from.replace(/'/g, "['’]")})(?=$|[^\\p{L}'’])`, "giu"),
    (_: string, pre: string, w: string) => pre + (w[0] !== w[0].toLowerCase() ? to[0].toUpperCase() + to.slice(1) : to));

  it("the page source escapes \\p{L} in the template literal", () => {
    const line = reviewJs.split("\n").find((l) => l.includes("const swapWord"))!;
    expect(line).toContain("[^\\\\p{L}'’]");
    expect(line).not.toMatch(/[^\\]\\p\{L\}/);
  });
  it("zu -> su leaves zui alone", () => {
    expect(swapWord("Ka zu hi, a zui bang", "zu", "su")).toBe("Ka su hi, a zui bang");
  });
});

describe("chat negation", () => {
  it("a curly-apostrophe negative does not match the affirmative line", async () => {
    const [id] = await addSentences("I like rice.");
    const a = await env.DB.prepare("INSERT INTO answers (sentence_id, paite, register, phone_id) VALUES (?1, 'Buh ka it.', 'both', ?2) RETURNING id").bind(id, PHONE_A).first<{ id: number }>();
    await env.DB.prepare("INSERT INTO reviews (sentence_id, reviewer_email, decision, accepted_answer_id) VALUES (?1, 'rev@example.org', 'accept', ?2)").bind(id, a!.id).run();
    await env.DB.prepare("UPDATE sentences SET status = 'verified' WHERE id = ?1").bind(id).run();
    expect(await matchChat(env, "I don't like rice")).toBeNull();
    expect(await matchChat(env, "I don’t like rice")).toBeNull();
    expect(await matchChat(env, "I donʼt like rice")).toBeNull();
  });
});

describe("hidden words and links", () => {
  it("a hidden-only headword does not appear through approved links; a word absent from the glossary and a word with a visible row still do", async () => {
    await env.DB.prepare("INSERT INTO glossary (paite, english, source, hidden) VALUES ('Hiddenword', 'rude thing', 'note', 1)").run();
    await env.DB.prepare("INSERT INTO glossary (paite, english, source) VALUES ('Goodword', 'nice thing', 'note')").run();
    await env.DB.prepare("INSERT INTO glossary (paite, english, source, hidden) VALUES ('Mixed', 'one', 'note', 1), ('Mixed', 'two', 'note', 0)").run();
    for (const [p, o] of [["Goodword", "Hiddenword"], ["Goodword", "Notlisted"], ["Goodword", "Mixed"]])
      await env.DB.prepare("INSERT INTO word_links (paite, other, kind, phone_id, status) VALUES (?1, ?2, 'same', 'x', 'approved')").bind(p, o).run();
    const xs = await getGlossary(env);
    const glossary = renderGlossary(xs, await getWordExtras(env, xs));
    const page = await (await call("/same-opposite")).text();
    const jsn = await (await call("/same-opposite.json")).text();
    expect({ glossary: glossary.includes("Hiddenword"), page: page.includes("Hiddenword"), json: jsn.includes("Hiddenword") }).toEqual({ glossary: false, page: false, json: false });
    expect(jsn).toContain("Notlisted");
    expect(jsn).toContain("Mixed");
  });
});

describe("reviewer corrections", () => {
  it("approving a word with a partial correction is refused and nothing is approved", async () => {
    await call("/api/word", { method: "POST", body: JSON.stringify({ paite: "Tuii", english: "water" }), session: await session(PHONE_A) });
    const id = (await env.DB.prepare("SELECT id FROM word_submissions").first<{ id: number }>())!.id;
    const r = await rev("/review/api/words/decide", { id, decision: "approve", paite: "Tui" }); // english missing
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: "bad_correction" });
    expect((await env.DB.prepare("SELECT status FROM word_submissions").first<any>()).status).toBe("pending");
    expect((await env.DB.prepare("SELECT paite FROM glossary").all()).results).toEqual([]);
    expect((await rev("/review/api/words/decide", { id, decision: "approve" })).status).toBe(200); // no correction: as submitted
  });

  it("a link correction equal to the headword is refused", async () => {
    await env.DB.prepare("INSERT INTO word_links (paite, other, kind, phone_id) VALUES ('Tui', 'Ti', 'same', 'x')").run();
    const id = (await env.DB.prepare("SELECT id FROM word_links").first<{ id: number }>())!.id;
    const r = await rev("/review/api/links/decide", { id, decision: "approve", other: "tui" });
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: "bad_correction" });
    expect((await env.DB.prepare("SELECT status FROM word_links").first<any>()).status).toBe("pending");
  });

  it("a link correction that duplicates an approved pair (either direction) answers 409", async () => {
    await env.DB.prepare("INSERT INTO word_links (paite, other, kind, phone_id, status) VALUES ('Ti', 'Tui', 'same', 'x', 'approved')").run();
    await env.DB.prepare("INSERT INTO word_links (paite, other, kind, phone_id) VALUES ('Tui', 'Ci', 'same', 'x')").run();
    const id = (await env.DB.prepare("SELECT id FROM word_links WHERE status = 'pending'").first<{ id: number }>())!.id;
    const r = await rev("/review/api/links/decide", { id, decision: "approve", other: "Ti" });
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ error: "duplicate" });
    expect((await env.DB.prepare("SELECT status FROM word_links WHERE id = ?1").bind(id).first<any>()).status).toBe("pending");
    expect((await rev("/review/api/links/decide", { id, decision: "approve", other: "Dam" })).status).toBe(200);
  });
});
