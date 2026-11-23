import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { addSentences, call, fakeDeps, NOW, PHONE_A, PHONE_B, PHONE_C, session } from "./helpers";
import { getProverbs, renderProverbs, submitProverbAnswer, submitProverbPair } from "../src/proverbs";
import { getSameOpposite, renderSameOpposite } from "../src/sameopposite";
import { claimCheck } from "../src/grammar";
import { checkSpelling } from "../src/spelling";
import heardJs from "../public/hear.js?raw";
import grammarJs from "../public/grammar.js?raw";
import type { Env } from "../src/types";

const DB = env as unknown as Env;
const CLIP = new Uint8Array(4000).fill(7);

let n = 0;
async function verified(phone: string) {
  const [sid] = await addSentences(`Water ${++n}.`);
  const a = await env.DB.prepare("INSERT INTO answers (sentence_id, phone_id, paite, register, status) VALUES (?1, ?2, 'Tui', 'both', 'accepted') RETURNING id").bind(sid, phone).first<{ id: number }>();
  return (await env.DB.prepare("INSERT INTO reviews (sentence_id, reviewer_email, decision, accepted_answer_id, final_paite) VALUES (?1, 'rev@example.org', 'accept', ?2, 'Tui') RETURNING id").bind(sid, a!.id).first<{ id: number }>())!.id;
}
const upload = (reviewId: number, s: string) => call(`/api/record?reviewId=${reviewId}`, { method: "POST", session: s, body: CLIP,
  headers: { "content-type": "audio/webm", "X-Consent": "CC-BY-4.0", "X-Duration": "2500" } });
// R2 is not wiped between tests, so count only objects under this test's review.
const r2count = async (reviewId: number) => (await env.AUDIO.list({ prefix: `pending/${reviewId}/` })).objects.length;

describe("limits that hold under parallel use", () => {
  it("a burst of 25 parallel answers from one phone stores only 10", async () => {
    const ids = await addSentences(...Array.from({ length: 25 }, (_, i) => `Sentence number ${i}.`));
    const s = await session(PHONE_A);
    const rs = await Promise.all(ids.map((id) => call("/api/answer", { method: "POST", session: s, body: JSON.stringify({ sentenceId: id, paite: "Tui" }) })));
    const stored = (await env.DB.prepare("SELECT count(*) AS n FROM answers WHERE phone_id = ?1").bind(PHONE_A).first<{ n: number }>())!.n;
    const seen = (await env.DB.prepare("SELECT count(*) AS n FROM seen WHERE phone_id = ?1 AND action = 'answered'").bind(PHONE_A).first<{ n: number }>())!.n;
    expect({ ok: rs.filter((r) => r.status === 200).length, slow: rs.filter((r) => r.status === 429).length, stored, seen }).toEqual({ ok: 10, slow: 15, stored: 10, seen: 10 });
    // a refused answer leaves its sentence open for others
    expect((await env.DB.prepare("SELECT count(*) AS n FROM sentences WHERE status = 'open' AND answer_count = 0").first<{ n: number }>())!.n).toBe(15);
  });

  it("parallel English checks from one phone stay within the per-minute limit", async () => {
    const rs = await Promise.all(Array.from({ length: 25 }, () => claimCheck(DB, PHONE_A, NOW)));
    expect(rs.filter(Boolean).length).toBe(10);
  });

  it("the same phone uploading one line twice in parallel stores one clip and no orphan", async () => {
    const id = await verified(PHONE_A);
    const s = await session(PHONE_A);
    const before = await r2count(id);
    const rs = await Promise.all([upload(id, s), upload(id, s)]);
    const n = (await env.DB.prepare("SELECT count(*) AS n FROM recordings WHERE review_id = ?1 AND phone_id = ?2").bind(id, PHONE_A).first<{ n: number }>())!.n;
    expect({ statuses: rs.map((r) => r.status).sort(), stored: n, objects: (await r2count(id)) - before }).toEqual({ statuses: [200, 409], stored: 1, objects: 1 });
  });

  it("a line holds at most 3 live clips even when four phones upload at once", async () => {
    const id = await verified(PHONE_A);
    const phones = [PHONE_A, PHONE_B, PHONE_C, "dddddddd-dddd-4ddd-8ddd-dddddddddddd"];
    for (const p of phones.slice(1)) await verified(p);
    const sessions = await Promise.all(phones.map((p) => session(p)));
    const before = await r2count(id);
    const rs = await Promise.all(sessions.map((s) => upload(id, s)));
    expect(rs.map((r) => r.status).sort()).toEqual([200, 200, 200, 409]);
    expect((await r2count(id)) - before).toBe(3);
    expect(await rs.find((r) => r.status === 409)!.json()).toEqual({ error: "line_full" });
  });

  it("a phone that already recorded a line cannot record it again even if the clip was rejected", async () => {
    const id = await verified(PHONE_A);
    const s = await session(PHONE_A);
    expect((await upload(id, s)).status).toBe(200);
    await env.DB.prepare("UPDATE recordings SET status = 'rejected'").run();
    expect((await upload(id, s)).status).toBe(409);
  });

  it("spelling: at most 40 unseen words are checked per request, the rest are marked notChecked", async () => {
    const text = Array.from({ length: 60 }, (_, i) => "qz" + String.fromCharCode(97 + (i % 26)) + String.fromCharCode(97 + Math.floor(i / 26)) + "x").join(" ");
    const res = await checkSpelling(DB, { text }, NOW);
    const out = await res.json<{ words: { suggestions?: unknown[]; notChecked?: boolean }[]; unseen: number }>();
    expect(out.words.length).toBe(60);
    expect(out.words.filter((w) => !w.notChecked).length).toBe(40);
    expect(out.words.filter((w) => w.notChecked).length).toBe(20);
    // Every word carries a suggestions list, so the page never reads .length of undefined.
    expect(out.words.every((w) => Array.isArray(w.suggestions))).toBe(true);
  });

  it("raw grammar.js: a notChecked word is said plainly, and a missing suggestions list does not throw", () => {
    expect(grammarJs).toContain("if (w.notChecked)");
    expect(grammarJs).toContain("w.suggestions && w.suggestions.length");
  });

  it("spelling: a short text is unchanged and a phone is limited to 10 a minute, reviewers are not", async () => {
    const out = await (await checkSpelling(DB, { text: "tuiqz" }, NOW)).json();
    expect(out).toEqual({ words: [{ word: "tuiqz", count: 0, suggestions: [] }], unseen: 1 });
    const s = await session(PHONE_A);
    const rs: number[] = [];
    for (let i = 0; i < 12; i++) rs.push((await call("/api/spelling", { method: "POST", session: s, body: JSON.stringify({ text: "tui" }) })).status);
    expect(rs).toEqual([...Array(10).fill(200), 429, 429]);
    for (let i = 0; i < 12; i++) expect((await call("/review/api/spelling", { method: "POST", body: JSON.stringify({ text: "tui" }) }, fakeDeps({ verifyReviewer: async () => "rev@example.org" }))).status).toBe(200);
  });

  it("two identical proverb pairs sent at once both answer ok with one row", async () => {
    const b = { paite: "Race paite line", english: "Race english line" };
    const rs = await Promise.allSettled([submitProverbPair(DB, "p1", b), submitProverbPair(DB, "p2", b)]);
    expect(rs.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"]);
    expect((await env.DB.prepare("SELECT count(*) AS n FROM proverbs WHERE lower(paite) = 'race paite line'").first<{ n: number }>())!.n).toBe(1);
  });

  it("the same phone sending the same proverb rendering three times at once stores one", async () => {
    const r = await env.DB.prepare("INSERT INTO proverbs (kind, english, entered_from, status, source) VALUES ('proverb', 'A saying', 'pai2en', 'open', 'seed') RETURNING id").first<{ id: number }>();
    const rs = await Promise.all([1, 2, 3].map(() => submitProverbAnswer(DB, "phone-9", { id: r!.id, paite: "Tui leh mei" })));
    expect(rs.map((x) => x.status)).toEqual([200, 200, 200]);
    expect((await env.DB.prepare("SELECT count(*) AS n FROM proverb_answers").first<{ n: number }>())!.n).toBe(1);
  });
});

describe("page scripts and Hear it", () => {
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  function phoneFn(html: string, stored: string | null) {
    const at = html.indexOf("function phone(){");
    const src = html.slice(at, html.indexOf("return v}", at) + 9);
    const store: Record<string, string> = stored === null ? {} : { "pd:phone": JSON.stringify(stored) };
    const win = { crypto: { getRandomValues: (a: Uint8Array) => crypto.getRandomValues(a) } };
    const ls = { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; } };
    const id = new Function("window", "localStorage", "KEY", `${src}; return phone();`)(win, ls, "pd:phone") as string;
    return { id, saved: JSON.parse(store["pd:phone"]) as string };
  }
  const pages = [
    ["proverbs", async () => renderProverbs(await getProverbs(DB), "k")],
    ["same and opposite", async () => renderSameOpposite(await getSameOpposite(DB), "k")],
  ] as const;
  for (const [name, page] of pages) {
    it(`${name} page: without crypto.randomUUID the phone id is a valid v4 UUID, and an invalid stored id is replaced`, async () => {
      const html = await page();
      for (let i = 0; i < 20; i++) expect(phoneFn(html, null).id).toMatch(UUID);
      const r = phoneFn(html, "1700000000000abc");
      expect(r.id).toMatch(UUID);
      expect(r.saved).toBe(r.id);
      const good = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
      expect(phoneFn(html, good).id).toBe(good);
    });
  }

  it("hear.js (source check): Send stays disabled and the blob is cleared once the upload succeeds", () => {
    const click = heardJs.slice(heardJs.indexOf('$("h-send").addEventListener'));
    expect(click).toContain("sent = true; blob = null;");
    expect(click).toContain('if (!sent) $("h-send").disabled = false;');
    expect(heardJs).toContain('$("h-send").disabled = false; show("done")'); // a new recording re-enables it
  });
});

describe("/api/week", () => {
  it("counts an also_correct answer covered by an accept review", async () => {
    const [sid] = await addSentences(`Water ${++n}.`);
    const ago = "datetime(1800000000, 'unixepoch', '-1 days')";
    const a1 = await env.DB.prepare(`INSERT INTO answers (sentence_id, phone_id, paite, register, status, created_at) VALUES (?1, ?2, 'Tui', 'both', 'accepted', ${ago}) RETURNING id`).bind(sid, PHONE_A).first<{ id: number }>();
    const a2 = await env.DB.prepare(`INSERT INTO answers (sentence_id, phone_id, paite, register, status, created_at) VALUES (?1, ?2, 'Tui a', 'both', 'also_correct', ${ago}) RETURNING id`).bind(sid, PHONE_B).first<{ id: number }>();
    await env.DB.prepare(`INSERT INTO reviews (sentence_id, reviewer_email, decision, accepted_answer_id, final_paite, answer_ids, created_at) VALUES (?1, 'r@x.org', 'accept', ?2, 'Tui', ?3, ${ago})`).bind(sid, a1!.id, JSON.stringify([a1!.id, a2!.id])).run();
    expect((await (await call("/api/week", { session: await session(PHONE_B) })).json<{ verified: number }>()).verified).toBe(1);
    expect((await (await call("/api/week", { session: await session(PHONE_A) })).json<{ verified: number }>()).verified).toBe(1);
  });
});

describe("migration 0039", () => {
  it("sets aside duplicate live clips instead of deleting them, then the unique index holds", async () => {
    const id = await verified(PHONE_A);
    await env.DB.prepare("DROP INDEX recordings_one_per_phone").run();
    const ins = (key: string, status: string) => env.DB.prepare("INSERT INTO recordings (review_id, sentence_id, paite, phone_id, r2_key, mime, bytes, duration_ms, consent, status) SELECT ?1, sentence_id, 'Tui', ?2, ?3, 'audio/webm', 300, 2000, 'CC-BY-4.0', ?4 FROM reviews WHERE id = ?1").bind(id, PHONE_A, key, status).run();
    await ins("m/a", "pending"); await ins("m/b", "accepted"); await ins("m/c", "pending");
    const sql = (await import("../migrations/0039_recordings_one_per_phone.sql?raw")).default as string;
    for (const stmt of sql.replace(/^--.*$/gm, "").split(/;\s*(?:\n|$)/).filter((x) => x.trim())) await env.DB.prepare(stmt).run();
    const rows = (await env.DB.prepare("SELECT r2_key, status FROM recordings WHERE review_id = ?1 ORDER BY id").bind(id).all<{ r2_key: string; status: string }>()).results;
    expect(rows).toEqual([{ r2_key: "m/a", status: "rejected" }, { r2_key: "m/b", status: "accepted" }, { r2_key: "m/c", status: "rejected" }]);
    await expect(ins("m/d", "pending")).rejects.toThrow(/UNIQUE/);
  });
});
