import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { runPrereview } from "../src/prereview";
import { logged } from "../src/export";
import { claimNext } from "../src/reviewdb";
import { addSentences, NOW } from "./helpers";

const keyed = { ...env, DEEPSEEK_API_KEY: "k" };

async function answer(sid: number, paite: string) {
  return (await env.DB.prepare("INSERT INTO answers (sentence_id, paite, register, phone_id, contributor_name) VALUES (?1, ?2, 'both', 'secret-phone', 'SecretName') RETURNING id")
    .bind(sid, paite).first<{ id: number }>())!.id;
}
const reply = (o: unknown) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(o) } }] }));
const note = async (id: number) => env.DB.prepare("SELECT ai_note, ai_flag FROM answers WHERE id = ?1").bind(id).first<{ ai_note: string | null; ai_flag: string | null }>();

describe("prereview", () => {
  it("writes notes, trims, ignores invalid ids/flags, sends only answer text", async () => {
    const [s] = await addSentences("Hello");
    const a = await answer(s, "Dam maw"), b = await answer(s, "Nong dam hiam"), c = await answer(s, "x");
    const bodies: string[] = [];
    const f = (async (_u: string, init: RequestInit) => {
      bodies.push(init.body as string);
      return reply({ answers: [{ id: a, note: "n".repeat(200), flag: "ok" }, { id: b, note: "tedim", flag: "tedim_style" }, { id: 9999, note: "x", flag: "ok" }, { id: c, note: "x", flag: "bogus" }], agree: false });
    }) as unknown as typeof fetch;
    expect(await runPrereview(keyed, f)).toEqual({ noted: 3, failed: 0 });
    expect((await note(a))!.ai_note).toHaveLength(140);
    expect(await note(b)).toEqual({ ai_note: "tedim", ai_flag: "tedim_style" });
    expect((await note(c))!.ai_note).toBeNull();
    expect((await env.DB.prepare("SELECT ai_agree FROM sentences WHERE id = ?1").bind(s).first<{ ai_agree: number }>())!.ai_agree).toBe(0);
    expect(bodies[0]).not.toMatch(/phone_id|contributor_name|secret-phone|SecretName/);
    expect(bodies[0]).toContain("Dam maw");
  });

  it("API error leaves NULL, other sentences continue, next run retries", async () => {
    const [s1, s2] = await addSentences("One", "Two");
    const a = await answer(s1, "aa"), b = await answer(s2, "bb");
    let fail = true;
    const f = (async (_u: string, init: RequestInit) => {
      const sid = JSON.parse(JSON.parse(init.body as string).messages[1].content.split("Answers: ")[1])[0].id;
      if (fail && sid === a) return new Response("no", { status: 500 });
      return reply({ answers: [{ id: sid, note: "ok", flag: "ok" }], agree: true });
    }) as unknown as typeof fetch;
    expect(await runPrereview(keyed, f)).toEqual({ noted: 1, failed: 1 });
    expect((await note(a))!.ai_note).toBeNull();
    expect((await note(b))!.ai_note).toBe("ok");
    fail = false;
    expect(await runPrereview(keyed, f)).toEqual({ noted: 1, failed: 0 });
    expect((await note(a))!.ai_note).toBe("ok");
  });

  it("no key or nothing to note: no call, no job_runs row; a call writes one row", async () => {
    const [s] = await addSentences("Hello"); const a = await answer(s, "aa");
    let calls = 0;
    const f = (async (_u: string, init: RequestInit) => { calls++; return reply({ answers: [{ id: a, note: "ok", flag: "ok" }], agree: true }); }) as unknown as typeof fetch;
    await logged(env, "prereview", () => runPrereview(env, f));
    expect(calls).toBe(0);
    await logged(keyed, "prereview", () => runPrereview(keyed, f));
    expect(calls).toBe(1);
    await logged(keyed, "prereview", () => runPrereview(keyed, f)); // nothing unnoted now
    expect(calls).toBe(1);
    const rows = await env.DB.prepare("SELECT ok, detail FROM job_runs WHERE job = 'prereview'").all<{ ok: number; detail: string }>();
    expect(rows.results).toEqual([{ ok: 1, detail: JSON.stringify({ noted: 1, failed: 0 }) }]);
  });

  it("sends the full set, notes only the unnoted answer, updates ai_agree", async () => {
    const [s] = await addSentences("Hello");
    const a = await answer(s, "first");
    await env.DB.prepare("UPDATE answers SET ai_note = 'old', ai_flag = 'ok' WHERE id = ?1").bind(a).run();
    await env.DB.prepare("UPDATE sentences SET ai_agree = 1 WHERE id = ?1").bind(s).run();
    const b = await answer(s, "second");
    const bodies: string[] = [];
    const f = (async (_u: string, init: RequestInit) => {
      bodies.push(init.body as string);
      return reply({ answers: [{ id: a, note: "new", flag: "junk" }, { id: b, note: "bnote", flag: "ok" }], agree: false });
    }) as unknown as typeof fetch;
    expect(await runPrereview(keyed, f)).toEqual({ noted: 1, failed: 0 });
    expect(bodies[0]).toContain("first");
    expect(bodies[0]).toContain("second");
    expect(await note(a)).toEqual({ ai_note: "old", ai_flag: "ok" });
    expect(await note(b)).toEqual({ ai_note: "bnote", ai_flag: "ok" });
    expect((await env.DB.prepare("SELECT ai_agree FROM sentences WHERE id = ?1").bind(s).first<{ ai_agree: number }>())!.ai_agree).toBe(0);
  });

  it("claimNext orders agree, unnoted/disagree, then junk/english", async () => {
    const [junk, plain, agree] = await addSentences("A junk", "B plain", "C agree");
    await answer(junk, "j"); await answer(plain, "p"); await answer(agree, "g");
    await env.DB.prepare("UPDATE answers SET ai_flag = 'junk' WHERE sentence_id = ?1").bind(junk).run();
    await env.DB.prepare("UPDATE sentences SET ai_agree = 1 WHERE id IN (?1, ?2)").bind(junk, agree).run();
    const order: number[] = [];
    for (const email of ["r1@x", "r2@x", "r3@x"]) order.push((await claimNext(env.DB, email, NOW))!.sentence.id);
    expect(order).toEqual([agree, plain, junk]);
  });
});
