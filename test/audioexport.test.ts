import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { exportRecordings, runNightly } from "../src/export";
import { addSentences } from "./helpers";

// A tiny GitHub contents API: path -> { content (base64), sha }.
function github() {
  const files = new Map<string, { content: string; sha: string }>();
  const calls: string[] = [];
  let n = 0;
  const fetcher = (async (input: RequestInfo, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.url;
    const path = decodeURIComponent(url.split("/contents/")[1]?.split("?")[0] ?? "");
    const method = init?.method ?? "GET";
    calls.push(`${method} ${path}`);
    if (!url.includes("api.github.com")) return new Response("{}", { status: 404 });
    const body = init?.body ? JSON.parse(init.body as string) : {};
    const cur = files.get(path);
    if (method === "GET") return cur ? Response.json(cur) : new Response("not found", { status: 404 });
    if (method === "PUT") {
      if (cur && body.sha !== cur.sha) return new Response("{}", { status: 422 });
      files.set(path, { content: body.content, sha: `sha${++n}` });
      return new Response("{}", { status: cur ? 200 : 201 });
    }
    if (method === "DELETE") {
      if (!cur || body.sha !== cur.sha) return new Response("{}", { status: 409 });
      files.delete(path);
      return new Response("{}", { status: 200 });
    }
    return new Response("{}", { status: 405 });
  }) as typeof fetch;
  return { files, calls, fetcher };
}

const text = (b64: string) => new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));

async function clip(english: string, paite: string, status = "accepted", name: string | null = "Mang") {
  const [sid] = await addSentences(english);
  const a = await env.DB.prepare("INSERT INTO answers (sentence_id, paite, register, phone_id, status) VALUES (?1, ?2, 'both', 'p', 'accepted') RETURNING id").bind(sid, paite).first<{ id: number }>();
  const r = await env.DB.prepare("INSERT INTO reviews (sentence_id, reviewer_email, decision, accepted_answer_id, final_paite, register) VALUES (?1, 'rev@example.org', 'accept', ?2, ?3, 'spoken') RETURNING id")
    .bind(sid, a!.id, paite).first<{ id: number }>();
  const key = `pending/${r!.id}/${crypto.randomUUID()}.webm`;
  await env.AUDIO.put(key, new Uint8Array([1, 2, 3, 250, 251]));
  const rec = await env.DB.prepare(
    `INSERT INTO recordings (review_id, sentence_id, paite, phone_id, contributor_name, r2_key, mime, bytes, duration_ms, consent, status, reviewed_by, reviewed_at)
     VALUES (?1, ?2, ?3, 'secret-phone', ?4, ?5, 'audio/webm', 5, 2500, 'CC-BY-4.0', ?6, 'rev@example.org', '2026-11-01 10:00:00') RETURNING id`,
  ).bind(r!.id, sid, paite, name, key, status).first<{ id: number }>();
  return { sid, reviewId: r!.id, id: rec!.id };
}

describe("audio export", () => {
  it("uploads accepted clips and writes the manifest, with no phone id or email", async () => {
    const a = await clip("I am well.", "Ka dam e.");
    await clip("Good night.", "Zan hoih.", "pending");
    const gh = github();
    const r = await exportRecordings(env, gh.fetcher);
    expect(r).toEqual({ uploaded: 1, removed: 0, manifest: true });
    expect([...gh.files.keys()].sort()).toEqual([`audio/${a.id}.webm`, "audio/recordings.jsonl"]);
    expect([...atob(gh.files.get(`audio/${a.id}.webm`)!.content)].map((c) => c.charCodeAt(0))).toEqual([1, 2, 3, 250, 251]);
    const manifest = text(gh.files.get("audio/recordings.jsonl")!.content);
    const line = JSON.parse(manifest.trim());
    expect(line).toMatchObject({ id: `audio:${a.id}`, file: `audio/${a.id}.webm`, text_id: `community:${a.sid}`, paite: "Ka dam e.", english: "I am well.", speaker: "Mang", verified_by: "Rev One", duration_ms: 2500, licence: "CC-BY-4.0" });
    expect(manifest).not.toContain("secret-phone");
    expect(manifest).not.toContain("@");
    const row = await env.DB.prepare("SELECT exported_at FROM recordings WHERE id = ?1").bind(a.id).first<{ exported_at: string | null }>();
    expect(row!.exported_at).not.toBeNull();
  });

  it("does nothing on a second run, and returns null so no job row is written", async () => {
    await clip("I am well.", "Ka dam e.");
    const gh = github();
    await exportRecordings(env, gh.fetcher);
    gh.calls.length = 0;
    expect(await exportRecordings(env, gh.fetcher)).toBeNull();
    expect(gh.calls.filter((c) => !c.startsWith("GET"))).toEqual([]);
  });

  it("sends at most `limit` clips a night and carries on the next", async () => {
    for (let i = 0; i < 3; i++) await clip(`Line ${i}.`, `Thu ${i}.`);
    const gh = github();
    expect((await exportRecordings(env, gh.fetcher, 2))!.uploaded).toBe(2);
    expect((await exportRecordings(env, gh.fetcher, 2))!.uploaded).toBe(1);
    expect(text(gh.files.get("audio/recordings.jsonl")!.content).trim().split("\n")).toHaveLength(3);
  });

  it("takes a clip down after an undo, and after its sentence review is undone", async () => {
    const a = await clip("I am well.", "Ka dam e.");
    const b = await clip("Good night.", "Zan hoih.");
    const gh = github();
    await exportRecordings(env, gh.fetcher);
    await env.DB.prepare("UPDATE recordings SET status = 'pending' WHERE id = ?1").bind(a.id).run();
    await env.DB.prepare("UPDATE reviews SET undone_at = datetime('now') WHERE id = ?1").bind(b.reviewId).run();
    expect(await exportRecordings(env, gh.fetcher)).toEqual({ uploaded: 0, removed: 2, manifest: true });
    expect(gh.files.has(`audio/${a.id}.webm`)).toBe(false);
    expect(gh.files.has(`audio/${b.id}.webm`)).toBe(false);
    expect(text(gh.files.get("audio/recordings.jsonl")!.content)).toBe("");
    const n = await env.DB.prepare("SELECT count(*) AS n FROM recordings WHERE exported_at IS NOT NULL").first<{ n: number }>();
    expect(n!.n).toBe(0);
  });

  it("trusts a clip already on GitHub from a run that crashed before marking it", async () => {
    const a = await clip("I am well.", "Ka dam e.");
    const gh = github();
    gh.files.set(`audio/${a.id}.webm`, { content: "AQID+vs=", sha: "old" });
    expect((await exportRecordings(env, gh.fetcher))!.uploaded).toBe(1);
  });

  it("runs as the nightly audio job", async () => {
    await clip("I am well.", "Ka dam e.");
    const gh = github();
    await runNightly(env, gh.fetcher);
    const job = await env.DB.prepare("SELECT ok, detail FROM job_runs WHERE job = 'audio'").first<{ ok: number; detail: string }>();
    expect(job).toMatchObject({ ok: 1 });
    expect(JSON.parse(job!.detail)).toMatchObject({ uploaded: 1 });
  });
});
