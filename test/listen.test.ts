import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import wrangler from "../wrangler.jsonc?raw";
import playJs from "../public/play.js?raw";
import askcardJs from "../public/askcard.js?raw";
import { ask } from "../src/kbask";
import { syncSiteSources } from "../src/kbsite";
import { addSentences, call, NOW } from "./helpers";

const keyed = { ...env, DEEPSEEK_API_KEY: "k" };
const REV = { via: "review" as const, key: "rev:a@example.org" };

// A verified sentence (accepted answer + accept review) and, optionally, a recording of it.
async function verified(english: string, paite: string) {
  const [sid] = await addSentences(english);
  const a = await env.DB.prepare("INSERT INTO answers (sentence_id, phone_id, paite, register, status) VALUES (?1, 'p', ?2, 'both', 'accepted') RETURNING id").bind(sid, paite).first<{ id: number }>();
  const r = await env.DB.prepare("INSERT INTO reviews (sentence_id, reviewer_email, decision, accepted_answer_id, final_paite) VALUES (?1, 'rev@example.org', 'accept', ?2, ?3) RETURNING id").bind(sid, a!.id, paite).first<{ id: number }>();
  return { sid, rid: r!.id };
}
let n = 0;
async function clip(v: { sid: number; rid: number }, paite: string, name: string | null, status = "accepted") {
  const r = await env.DB.prepare(
    "INSERT INTO recordings (review_id, sentence_id, paite, phone_id, contributor_name, r2_key, mime, bytes, duration_ms, consent, status) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'audio/webm', 4000, 2500, 'CC-BY-4.0', ?7) RETURNING id",
  ).bind(v.rid, v.sid, paite, "phone" + ++n, name, "k/" + n, status).first<{ id: number }>();
  return r!.id;
}

describe("/listen", () => {
  it("lists accepted recordings only, newest first, with play buttons, names and escaping", async () => {
    const a = await clip(await verified("Water.", "Tui"), "Tui", "Ann");
    await clip(await verified("Pending one.", "Hold"), "Hold", "Pat", "pending");
    await clip(await verified("Rejected one.", "Nope"), "Nope", "Rob", "rejected");
    const b = await clip(await verified("Fire & <b>smoke</b>.", "<i>Mei</i>"), "<i>Mei</i>", null);
    const res = await call("/listen");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=600");
    const html = await res.text();
    expect(html).toContain("<title>Listen · Paite Daily</title>");
    expect(html).toContain("<h1>Listen</h1>");
    expect(html).toContain("Checked Paite lines, read aloud by the people who wrote and checked them. Tap to listen.");
    expect(html).toContain(`data-audio="${a}"`);
    expect(html).toContain(`data-audio="${b}"`);
    expect(html.indexOf(`data-audio="${b}"`)).toBeLessThan(html.indexOf(`data-audio="${a}"`));
    expect(html.match(/data-audio="/g)).toHaveLength(2);
    expect(html).not.toContain("Hold");
    expect(html).not.toContain("Rejected one");
    expect(html).toContain("Read by Ann");
    expect(html.match(/Read by/g)).toHaveLength(1);
    expect(html).toContain("&lt;i&gt;Mei&lt;/i&gt;");
    expect(html).toContain("Fire &amp; &lt;b&gt;smoke&lt;/b&gt;.");
    expect(html).not.toContain("<i>Mei</i>");
  });

  it("is a worker-first route", () => {
    expect(wrangler).toMatch(/"run_worker_first":[^\]]*"\/listen"/);
  });
});

describe("Seen in Use with recordings", () => {
  it("prefers a recorded line, and shows the play button and Read by", async () => {
    await env.DB.prepare("INSERT INTO glossary (paite, english, source) VALUES ('pa', 'father', 'note')").run();
    const plain = await verified("Plain line.", "Ka pa a hong.");
    const v = await verified("Recorded line.", "Pa a nuam.");
    const id = await clip(v, "Pa a nuam.", " Ann ");
    expect(plain.sid).toBeLessThan(v.sid);
    const html = await (await call("/glossary")).text();
    expect(html).toContain(`data-audio="${id}"`);
    expect(html).toContain("Read by Ann");
    expect(html.indexOf("Pa a nuam.")).toBeLessThan(html.indexOf("Ka pa a hong."));
    expect(html).toContain('<script src="/play.js">');
  });
});

describe("wiki answers with recordings", () => {
  const run = async (status: string) => {
    const v = await verified("Good morning to you", "Ka dam hi");
    await env.DB.prepare("UPDATE sentences SET status = 'verified' WHERE id = ?1").bind(v.sid).run();
    const id = await clip(v, "Ka dam hi", "Ann", status);
    await syncSiteSources(env, NOW);
    const c = (await env.WIKI.prepare("SELECT c.id AS chunk FROM kb_chunks c WHERE c.text LIKE '%Good morning to you%'").first<{ chunk: number }>())!;
    const reply = { status: "answer", parts: [{ type: "text", text: "It is this." }, { type: "quote", chunk: c.chunk, text: "English: Good morning to you" }], sources: [c.chunk] };
    const fetcher = (async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(reply) } }] }))) as unknown as typeof fetch;
    return { id, a: await ask(keyed, fetcher, "How do you say good morning?", REV, NOW) };
  };
  it("adds audio and readBy to a Sentence source with an accepted recording", async () => {
    const { id, a } = await run("accepted");
    expect(a.status).toBe("answer");
    expect(a.sources[0].title).toBe("Sentence: Good morning to you");
    expect(a.sources[0]).toMatchObject({ audio: id, readBy: "Ann" });
  });
  it("does not for a pending recording", async () => {
    const { a } = await run("pending");
    expect(a.sources[0].audio).toBeUndefined();
  });
});

describe("play.js and askcard.js", () => {
  it("plays one clip at a time through one delegated listener", () => {
    expect(playJs.match(/document\.addEventListener\("click"/g)).toHaveLength(1);
    expect(playJs).toContain('button.play[data-audio]');
    expect(playJs).toContain("/audio/");
    // starting a clip stops the one before it (stop() runs before the new Audio is made)
    expect(playJs.indexOf("stop();")).toBeLessThan(playJs.indexOf("new Audio"));
    expect(playJs).toContain('"Stop"');
    expect(playJs).toContain('"Listen"');
  });
  it("the answer card draws a play button for a source with audio", () => {
    expect(askcardJs).toContain("s.audio");
    expect(askcardJs).toContain("b.dataset.audio");
    expect(askcardJs).toContain('"Read by "');
  });
});
