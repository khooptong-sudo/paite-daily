import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { matchChat } from "../src/chat";
import { exportRecordings, runNightly } from "../src/export";
import { errorPage } from "../src/observability";
import { streakFor } from "../src/streak";
import { addSentences, call, PHONE_A, session } from "./helpers";

const at = (iso: string) => Date.parse(iso);
async function answerAt(sid: number, iso: string) {
  await env.DB.prepare("INSERT INTO answers (sentence_id, phone_id, paite, register, status, created_at) VALUES (?1, ?2, 'x', 'both', 'new', ?3)")
    .bind(sid, PHONE_A, iso.replace("T", " ").replace("Z", "")).run();
}

describe("streak days are India days", () => {
  it("two answers either side of 18:30 UTC are one India day", async () => {
    const [s] = await addSentences("One.");
    await answerAt(s, "2027-01-13T19:00:00Z"); // 00:30 IST on the 14th
    await answerAt(s, "2027-01-14T05:00:00Z"); // 10:30 IST on the 14th
    expect(await streakFor(env.DB, PHONE_A, at("2027-01-14T06:00:00Z"))).toBe(1);
  });

  it("an answer after 18:30 UTC counts for the next India day", async () => {
    const [s] = await addSentences("One.");
    await answerAt(s, "2027-01-14T23:00:00Z"); // 04:30 IST on the 15th
    await answerAt(s, "2027-01-14T08:00:00Z"); // the 14th
    expect(await streakFor(env.DB, PHONE_A, at("2027-01-14T23:30:00Z"))).toBe(2);
  });

  it("nobody loses a streak on switch day: 5 UTC days, mixed hours, including 23:00 UTC", async () => {
    const [s] = await addSentences("One.");
    // India days: 19, 21, 21, 23, 23: a plain India count would be 1 on the 24th.
    for (const t of ["2026-11-19T10:00", "2026-11-20T20:00", "2026-11-21T10:00", "2026-11-22T23:00", "2026-11-23T10:00"]) await answerAt(s, t + ":00Z");
    expect(await streakFor(env.DB, PHONE_A, at("2026-11-24T03:00:00Z"))).toBe(5);
  });
});

describe("about names the live AI", () => {
  const setProvider = (provider: string) => env.DB.prepare(
    "INSERT OR REPLACE INTO ai_settings (id, provider, base_url, model, key_cipher, key_iv, key_hint, updated_by, updated_at) VALUES (1, ?1, 'https://secret.example/base', 'm', 'c', 'i', 'h', 'o', 1)",
  ).bind(provider).run();
  const about = async () => (await call("/about")).text();

  it("says OpenAI when OpenAI is configured, never the key or address", async () => {
    await setProvider("openai");
    const html = await about();
    expect(html).toContain("(OpenAI)");
    expect(html).not.toContain("DeepSeek");
    expect(html).not.toContain("secret.example");
  });

  it("says an AI model for an unknown provider", async () => {
    await setProvider("custom");
    const html = await about();
    expect(html).not.toContain("DeepSeek");
    expect(html).toContain("an AI model");
  });
});

describe("errors under /admin/api are JSON", () => {
  it("errorPage answers JSON", async () => {
    const r = await errorPage(new Request("https://paite.lamkalabs.com/admin/api/anything"), env);
    expect(r.status).toBe(500);
    expect(await r.json()).toEqual({ error: "server_error" });
  });
});

describe("chat: a remembered none expires", () => {
  const reply = (o: unknown) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(o) } }] }));
  it("asks the model again after a day", async () => {
    const keyed = { ...env, DEEPSEEK_API_KEY: "k" };
    const [id] = await addSentences("How much does this cost?");
    const a = await env.DB.prepare("INSERT INTO answers (sentence_id, paite, register, phone_id) VALUES (?1, 'Hiai bangzah man a?', 'both', ?2) RETURNING id").bind(id, PHONE_A).first<{ id: number }>();
    await env.DB.prepare("INSERT INTO reviews (sentence_id, reviewer_email, decision, accepted_answer_id) VALUES (?1, 'r@example.org', 'accept', ?2)").bind(id, a!.id).run();
    await env.DB.prepare("UPDATE sentences SET status = 'verified' WHERE id = ?1").bind(id).run();
    let ans: unknown = { id: null };
    let calls = 0;
    const f = (async () => { calls++; return reply(ans); }) as unknown as typeof fetch;
    const t0 = 1_800_000_000_000;
    expect(await matchChat(keyed, "how much is it", f, t0)).toBeNull();
    ans = { id: 1 };
    expect(await matchChat(keyed, "how much is it", f, t0 + 3_600_000)).toBeNull();
    expect(calls).toBe(1);
    expect((await matchChat(keyed, "how much is it", f, t0 + 2 * 86_400_000))?.paite).toBe("Hiai bangzah man a?");
  });
});

describe("words: case duplicates beyond ASCII", () => {
  const post = async (path: string, b: unknown) => call(path, { method: "POST", body: JSON.stringify(b), session: await session(PHONE_A) });
  const n = async (t: string) => (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${t}`).first<{ n: number }>())!.n;

  it("a word submitted again with different non-ASCII case is one submission", async () => {
    await post("/api/word", { paite: "Ṭhu", english: "Ĉat" });
    await post("/api/word", { paite: "ṭhu", english: "ĉat" });
    expect(await n("word_submissions")).toBe(1);
  });

  it("a link repeated with different non-ASCII case, either direction, is one link", async () => {
    await post("/api/link/pair", { paite: "Ṭhu", other: "Éla", kind: "same" });
    await post("/api/link/pair", { paite: "éla", other: "ṭhu", kind: "same" });
    expect(await n("word_links")).toBe(1);
  });

  it("the same link sent three times at once is one link", async () => {
    const s = await session(PHONE_A);
    const send = () => call("/api/link/pair", { method: "POST", body: JSON.stringify({ paite: "Hoih", other: "Pha", kind: "same" }), session: s });
    await Promise.all([send(), send(), send()]);
    expect(await n("word_links")).toBe(1);
  });
});

describe("nightly clean-up", () => {
  it("drops job runs older than 90 days and errors older than 30", async () => {
    await env.DB.prepare("INSERT INTO job_runs (job, ok, created_at) VALUES ('old', 1, datetime('now', '-91 days')), ('recent', 1, datetime('now', '-89 days'))").run();
    await env.DB.prepare("INSERT INTO errors (at, fingerprint, route, method, message) VALUES (datetime('now', '-31 days'), 'a', '/', 'GET', 'm'), (datetime('now', '-29 days'), 'b', '/', 'GET', 'm')").run();
    await runNightly(env, async () => new Response("{}", { status: 404 }));
    const jobs = (await env.DB.prepare("SELECT job FROM job_runs WHERE job IN ('old', 'recent')").all<{ job: string }>()).results.map((r) => r.job);
    expect(jobs).toEqual(["recent"]);
    const errs = (await env.DB.prepare("SELECT fingerprint FROM errors").all<{ fingerprint: string }>()).results.map((r) => r.fingerprint);
    expect(errs).toEqual(["b"]);
  });
});

describe("audio export with a missing file", () => {
  it("skips the clip, reports it, and still uploads the later ones", async () => {
    const mk = async (english: string) => {
      const [sid] = await addSentences(english);
      const a = await env.DB.prepare("INSERT INTO answers (sentence_id, paite, register, phone_id, status) VALUES (?1, 'p', 'both', 'p', 'accepted') RETURNING id").bind(sid).first<{ id: number }>();
      const r = await env.DB.prepare("INSERT INTO reviews (sentence_id, reviewer_email, decision, accepted_answer_id, final_paite, register) VALUES (?1, 'rev@example.org', 'accept', ?2, 'p', 'spoken') RETURNING id").bind(sid, a!.id).first<{ id: number }>();
      const key = `pending/${r!.id}/${crypto.randomUUID()}.webm`;
      const rec = await env.DB.prepare(
        `INSERT INTO recordings (review_id, sentence_id, paite, phone_id, contributor_name, r2_key, mime, bytes, duration_ms, consent, status, reviewed_by, reviewed_at)
         VALUES (?1, ?2, 'p', 'x', 'Mang', ?3, 'audio/webm', 5, 2500, 'CC-BY-4.0', 'accepted', 'rev@example.org', '2026-11-01 10:00:00') RETURNING id`,
      ).bind(r!.id, sid, key).first<{ id: number }>();
      return { key, id: rec!.id };
    };
    const lost = await mk("First.");
    const fine = await mk("Second.");
    await env.AUDIO.put(fine.key, new Uint8Array([1, 2, 3]));
    const puts: string[] = [];
    const fetcher = (async (input: RequestInfo, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.url;
      if ((init?.method ?? "GET") === "PUT") { puts.push(decodeURIComponent(url.split("/contents/")[1].split("?")[0])); return new Response("{}", { status: 201 }); }
      return new Response("nf", { status: 404 });
    }) as typeof fetch;
    const r = await exportRecordings(env, fetcher);
    expect(puts).toContain(`audio/${fine.id}.webm`);
    expect(r).toMatchObject({ uploaded: 1, skipped: [lost.id] });
  });
});
