import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { exportVerified, retireOwnerTranslations, runNightly, toBase64Utf8 } from "../src/export";
import { addSentences } from "./helpers";

type Put = { url: string; body: { message: string; content: string; branch: string } };

function github(existing: Set<string> = new Set(), crashAfterSave = false) {
  const puts: Put[] = [];
  const fetcher = (async (input: RequestInfo, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.url;
    if (init?.method === "PUT") {
      const path = url.split("/contents/")[1];
      if (existing.has(path)) return new Response("{}", { status: 422 });
      puts.push({ url, body: JSON.parse(init.body as string) });
      existing.add(path);
      if (crashAfterSave) throw new Error("crashed after GitHub saved");
      return new Response("{}", { status: 201 });
    }
    if (existing.has(url.split("/contents/")[1]?.split("?")[0])) return new Response("{}", { status: 200 });
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  return { puts, fetcher };
}

async function verified(english: string, paite: string, name: string | null = "Mang") {
  const [id] = await addSentences(english);
  const a = await env.DB.prepare("INSERT INTO answers (sentence_id, paite, register, phone_id, contributor_name, status) VALUES (?1, ?2, 'both', 'p', ?3, 'accepted') RETURNING id")
    .bind(id, paite, name).first<{ id: number }>();
  await env.DB.prepare("UPDATE sentences SET status = 'verified' WHERE id = ?1").bind(id).run();
  await env.DB.prepare("INSERT INTO reviews (sentence_id, reviewer_email, decision, accepted_answer_id, final_paite, register) VALUES (?1, 'rev@example.org', 'accept', ?2, ?3, 'spoken')")
    .bind(id, a!.id, paite).run();
  return id;
}

const decode = (b64: string) => new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));

describe("export", () => {
  it("encodes UTF-8 to base64", () => {
    expect(decode(toBase64Utf8("Pathian — ā"))).toBe("Pathian — ā");
  });

  it("writes one JSON line per accepted review, with reviewer display name and CC0", async () => {
    await verified("I am well.", "Ka dam e.");
    await verified("Good night for now.", "Mangpha phot le.", null);
    const gh = github();
    const r = await exportVerified(env, gh.fetcher);
    expect(r.exported).toBe(2);
    expect(gh.puts).toHaveLength(1);
    expect(gh.puts[0].url).toMatch(/\/repos\/khooptong-sudo\/paite-open-language-data\/contents\/community\/verified-\d+-\d+\.jsonl$/);
    const lines = decode(gh.puts[0].body.content).trim().split("\n").map((l) => JSON.parse(l));
    expect(lines[0]).toMatchObject({ english: "I am well.", paite: "Ka dam e.", register: "spoken", contributor: "Mang", verified_by: "Rev One", licence: "CC0-1.0" });
    expect(lines[1].contributor).toBe("");
    expect(JSON.stringify(lines)).not.toContain("rev@example.org");
  });

  it("does nothing when there is nothing new", async () => {
    const gh = github();
    expect((await exportVerified(env, gh.fetcher)).exported).toBe(0);
    expect(gh.puts).toHaveLength(0);
  });

  it("rerun after partial export does not duplicate", async () => {
    await verified("I am well.", "Ka dam e.");
    const first = github();
    await exportVerified(env, first.fetcher);
    const path = first.puts[0].url.split("/contents/")[1];
    await env.DB.prepare("DELETE FROM exports").run(); // simulate: GitHub saved, D1 did not
    const second = github(new Set([path]));
    const r = await exportVerified(env, second.fetcher);
    expect(second.puts).toHaveLength(0);
    expect(r.exported).toBe(1);
    const n = await env.DB.prepare("SELECT count(*) AS n FROM exports").first<{ n: number }>();
    expect(n!.n).toBe(1);
  });

  it("a crash after GitHub saved never publishes a review twice", async () => {
    await verified("I am well.", "Ka dam e.");
    const saved = new Set<string>();
    const first = github(saved, true);
    await expect(exportVerified(env, first.fetcher)).rejects.toThrow();
    await verified("Good night for now.", "Mangpha phot le.");
    const second = github(saved);
    expect((await exportVerified(env, second.fetcher)).exported).toBe(2);
    const ranges = [...first.puts, ...second.puts].map((p) => p.url.match(/verified-(\d+)-(\d+)\.jsonl$/)!.slice(1).map(Number));
    const ids = ranges.flatMap(([a, b]) => Array.from({ length: b - a + 1 }, (_, i) => a + i));
    expect(new Set(ids).size).toBe(ids.length);
    const open = await env.DB.prepare("SELECT count(*) AS n FROM exports WHERE done = 0").first<{ n: number }>();
    expect(open!.n).toBe(0);
  });

  it("a 422 is trusted only if the file can be read back", async () => {
    await verified("I am well.", "Ka dam e.");
    const fetcher = (async (_u: RequestInfo, init?: RequestInit) =>
      new Response("{}", { status: init?.method === "PUT" ? 422 : 404 })) as typeof fetch;
    await expect(exportVerified(env, fetcher)).rejects.toThrow("GitHub PUT 422");
    const row = await env.DB.prepare("SELECT done FROM exports").first<{ done: number }>();
    expect(row!.done).toBe(0);
    await env.DB.prepare("DELETE FROM exports").run();
    await runNightly(env, fetcher);
    const run = await env.DB.prepare("SELECT ok FROM job_runs WHERE job = 'export'").first<{ ok: number }>();
    expect(run!.ok).toBe(0);
  });

  it("skips undone reviews", async () => {
    const id = await verified("I am well.", "Ka dam e.");
    await env.DB.prepare("UPDATE reviews SET undone_at = datetime('now') WHERE sentence_id = ?1").bind(id).run();
    const gh = github();
    expect((await exportVerified(env, gh.fetcher)).exported).toBe(0);
  });
});

describe("owner translations", () => {
  it("retires open, unanswered sentences the owner already translated", async () => {
    const [done, answered, other] = await addSentences("I am hungry.", "Good morning.", "Have you eaten?");
    await env.DB.prepare("UPDATE sentences SET answer_count = 1 WHERE id = ?1").bind(answered).run();
    const corrections = { corrections: [
      { english: "I am hungry.", status: "verified" },
      { english: "Good morning.", status: "verified" },
      { english: "Have you eaten?", status: "pending" },
    ] };
    const fetcher = (async () => new Response(JSON.stringify(corrections))) as typeof fetch;
    expect(await retireOwnerTranslations(env, fetcher)).toBe(1);
    const rows = await env.DB.prepare("SELECT id, status FROM sentences ORDER BY id").all<{ id: number; status: string }>();
    expect(rows.results).toEqual([{ id: done, status: "retired" }, { id: answered, status: "open" }, { id: other, status: "open" }]);
  });
});

it("runNightly logs both jobs, even when one fails", async () => {
  const failing = (async () => { throw new Error("network down"); }) as typeof fetch;
  await runNightly(env, failing);
  const runs = await env.DB.prepare("SELECT job, ok FROM job_runs ORDER BY id").all();
  expect(runs.results).toEqual([{ job: "export", ok: 1 }, { job: "retire_owner", ok: 0 }]);
});
