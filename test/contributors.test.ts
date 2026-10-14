import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { exportVerified } from "../src/export";
import { addSentences, call, fakeDeps, PHONE_A, PHONE_B, PHONE_C } from "./helpers";

async function ans(phone: string, name: string | null, status: string, sentence: number) {
  await env.DB.prepare("INSERT INTO answers (sentence_id, phone_id, paite, register, contributor_name, status) VALUES (?1, ?2, 'x', 'both', ?3, ?4)")
    .bind(sentence, phone, name, status).run();
}

describe("contributors", () => {
  it("lists named phones with verified answers only, newest name, badge, no ids or emails", async () => {
    await env.DB.prepare("DELETE FROM reviewer_phones").run();
    const [s1, s2, s3] = await addSentences("One.", "Two.", "Three.");
    await ans(PHONE_A, "Old <b>", "accepted", s1);
    await ans(PHONE_A, "Mang & Co", "also_correct", s2);
    await ans(PHONE_A, "", "accepted", s3);
    await ans(PHONE_B, null, "accepted", s1);
    await ans(PHONE_C, "Pending", "new", s1);
    await env.DB.prepare("INSERT INTO reviewer_phones (phone_id, reviewer_email) VALUES (?1, 'rev@example.org')").bind(PHONE_A).run();
    await env.DB.prepare("INSERT INTO reviews (sentence_id, reviewer_email, decision, final_paite, register) VALUES (?1, 'rev@example.org', 'accept', 'x', 'both')").bind(s1).run();
    const r = await call("/api/contributors");
    const text = await r.text();
    expect(JSON.parse(text)).toEqual({
      contributors: [{ name: "Mang & Co", verified: 3, reviewer: true }],
      reviewers: [{ name: "Rev One", decisions: 1 }, { name: "Owner", decisions: 0 }],
    });
    expect(text).not.toMatch(/aaaaaaaa|example\.org/);
    const page = await (await call("/contributors")).text();
    expect(page).toContain("Mang &amp; Co");
    expect(page).toContain("Owner");
    expect(page).not.toMatch(/aaaaaaaa|example\.org/);
  });

  it("escapes HTML in names", async () => {
    const [s1] = await addSentences("One.");
    await ans(PHONE_B, "<script>x</script>", "accepted", s1);
    const page = await (await call("/contributors")).text();
    expect(page).not.toContain("<script>x");
    expect(page).toContain("&lt;script&gt;x");
  });

  it("link-phone: reviewer only, validates id, upserts", async () => {
    const rev = (body: unknown, email: string | null = "rev@example.org") =>
      call("/review/api/link-phone", { method: "POST", body: JSON.stringify(body) }, fakeDeps({ verifyAccess: async () => email }));
    expect((await rev({ phoneId: PHONE_A }, null)).status).toBe(401);
    expect((await rev({ phoneId: PHONE_A }, "x@example.org")).status).toBe(403);
    expect((await rev({ phoneId: "nope" })).status).toBe(400);
    expect((await rev({ phoneId: PHONE_A })).status).toBe(200);
    expect((await rev({ phoneId: PHONE_A }, "owner@example.org")).status).toBe(200);
    const row = await env.DB.prepare("SELECT reviewer_email FROM reviewer_phones WHERE phone_id = ?1").bind(PHONE_A).first<{ reviewer_email: string }>();
    expect(row!.reviewer_email).toBe("owner@example.org");
  });

  it("export writes an escaped CONTRIBUTORS.md", async () => {
    const [s1] = await addSentences("One.");
    await ans(PHONE_A, "A_*b", "accepted", s1);
    await ans(PHONE_B, "[x](y)", "accepted", s1);
    await env.DB.prepare("INSERT INTO reviews (sentence_id, reviewer_email, decision, final_paite, register) VALUES (?1, 'rev@example.org', 'accept', 'x', 'both')").bind(s1).run();
    const puts: { url: string; body: { content: string } }[] = [];
    const fetcher = (async (input: RequestInfo, init?: RequestInit) => {
      if (init?.method === "PUT") { puts.push({ url: String(input), body: JSON.parse(init.body as string) }); return new Response("{}", { status: 201 }); }
      return new Response("nf", { status: 404 });
    }) as typeof fetch;
    await exportVerified(env, fetcher);
    const md = puts.find((p) => p.url.endsWith("/CONTRIBUTORS.md"));
    expect(md).toBeTruthy();
    const text = new TextDecoder().decode(Uint8Array.from(atob(md!.body.content), (c) => c.charCodeAt(0)));
    expect(text).toContain("A\\_\\*b: 1");
    expect(text).toContain("\\[x\\]\\(y\\)");
  });

  it("export still succeeds when the CONTRIBUTORS.md PUT fails", async () => {
    const [s1] = await addSentences("One.");
    await ans(PHONE_A, "A", "accepted", s1);
    await env.DB.prepare("INSERT INTO reviews (sentence_id, reviewer_email, decision, final_paite, register) VALUES (?1, 'rev@example.org', 'accept', 'x', 'both')").bind(s1).run();
    const fetcher = (async (input: RequestInfo, init?: RequestInit) => {
      if (init?.method === "PUT") return new Response("{}", { status: String(input).endsWith("/CONTRIBUTORS.md") ? 500 : 201 });
      return new Response("nf", { status: 404 });
    }) as typeof fetch;
    expect((await exportVerified(env, fetcher)).exported).toBe(1);
    const row = await env.DB.prepare("SELECT done FROM exports").first<{ done: number }>();
    expect(row!.done).toBe(1);
  });
});
