import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { badgeFor } from "../src/contributors";
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
      goal: { verified: 3, goal: 1000 },
      contributors: [{ name: "Mang & Co", verified: 3, weekly: 0, badge: null, reviewer: true }],
      reviewers: [{ name: "Rev One", decisions: 1, weekly: 1 }, { name: "Owner", decisions: 0, weekly: 0 }],
      thisWeek: { contributors: [], reviewers: [{ name: "Rev One", n: 1, badge: null }] },
      allTime: { contributors: [{ name: "Mang & Co", n: 3, badge: null, reviewer: true }], reviewers: [{ name: "Rev One", n: 1, badge: null }, { name: "Owner", n: 0, badge: null }] },
    });
    expect(text).not.toMatch(/aaaaaaaa|example\.org/);
    const page = await (await call("/contributors")).text();
    expect(page).toContain("Mang &amp; Co");
    expect(page).toContain("Owner");
    expect(page).not.toMatch(/aaaaaaaa|example\.org/);
    expect(page).toContain('<footer class="foot">');
    expect(page).toContain("Click Here to Buy Us Coffee");
    expect(page).toContain("the data stays free for everyone");
    expect(page).toContain('<p class="contact">');
    expect(page).toContain('<script src="/footer.js"></script>');
    expect(page).toContain('<meta property="og:image" content="https://paite.lamkalabs.com/og.png">');
    expect(page).toContain('<meta name="twitter:card" content="summary_large_image">');
    expect(page).toContain("theconcierge@lamkalabs.com");
    expect(page).toContain("wa.me/918375098415");
    expect(page).toContain('<a class="mail" href="mailto:theconcierge@lamkalabs.com"');
    expect(page).not.toContain("Write to");
    expect(page).not.toContain("khooptong@lamkalabs.com");
    expect(page).not.toContain("khooptong@lamka.net");
    expect(page).not.toContain("83750 98415");
    expect(page).toContain('<a class="back" href="/review">Reviewer');
    expect(page).toContain('<script src="/track.js"></script>');
  });

  it("badgeFor boundaries", () => {
    expect([0, 9, 10, 49, 50, 99, 100, 499, 500, 1000].map(badgeFor)).toEqual([null, null, 10, 10, 50, 50, 100, 100, 500, 500]);
  });

  it("thisWeek counts only live accepts from the last 7 days; allTime ranks with badge", async () => {
    const [s1, s2, s3] = await addSentences("One.", "Two.", "Three.");
    await ans(PHONE_A, "Alpha", "accepted", s1);
    await ans(PHONE_A, "Alpha", "accepted", s2);
    await ans(PHONE_A, "Alpha", "accepted", s3);
    const rows = (await env.DB.prepare("SELECT id, sentence_id FROM answers WHERE phone_id = ?1 ORDER BY id").bind(PHONE_A).all<{ id: number; sentence_id: number }>()).results;
    const rv = (a: { id: number }, when: string, undone: string | null) =>
      env.DB.prepare("INSERT INTO reviews (sentence_id, reviewer_email, decision, final_paite, register, answer_ids, created_at, undone_at) VALUES (?1, 'rev@example.org', 'accept', 'x', 'both', ?2, datetime('now', ?3), ?4)")
        .bind(rows.find((r) => r.id === a.id)!.sentence_id, JSON.stringify([a.id]), when, undone).run();
    await rv(rows[0], "-1 days", null);
    await rv(rows[1], "-8 days", null);
    await rv(rows[2], "-1 days", "2026-01-01");
    const d = await (await call("/api/contributors")).json<any>();
    expect(d.thisWeek.contributors).toEqual([{ name: "Alpha", n: 1, badge: null, reviewer: false }]);
    expect(d.thisWeek.reviewers).toEqual([{ name: "Rev One", n: 1, badge: null }]);
    expect(d.allTime.contributors).toEqual([{ name: "Alpha", n: 3, badge: null, reviewer: false }]);
  });

  it("reviewer badge follows the phone, not the typed name", async () => {
    await env.DB.prepare("DELETE FROM reviewer_phones").run();
    const [s1] = await addSentences("One.");
    await ans(PHONE_A, "Same", "accepted", s1);
    await ans(PHONE_B, "Same", "accepted", s1);
    await env.DB.prepare("INSERT INTO reviewer_phones (phone_id, reviewer_email) VALUES (?1, 'rev@example.org')").bind(PHONE_A).run();
    const d = await (await call("/api/contributors")).json<any>();
    expect(d.contributors.filter((c: any) => c.reviewer)).toHaveLength(1);
    expect(d.allTime.contributors.filter((c: any) => c.reviewer)).toHaveLength(1);
    expect(d.allTime.contributors).toHaveLength(2);
    const page = await (await call("/contributors")).text();
    const contribLi = page.split("<li").map((l) => l.split("</li>")[0]).filter((l) => l.includes("Same"));
    expect(contribLi.filter((l) => l.includes("reviewerBadge"))).toHaveLength(1 * 1);
  });

  it("merges reviewers sharing a display name into one row with summed counts", async () => {
    const saved = env.REVIEWERS;
    try {
      env.REVIEWERS = JSON.stringify({ "a@example.org": "Same Person", "b@example.org": "Same Person", "c@example.org": "Other" });
      const [s1, s2, s3] = await addSentences("One.", "Two.", "Three.");
      const rv = (email: string, sid: number) => env.DB.prepare("INSERT INTO reviews (sentence_id, reviewer_email, decision, final_paite, register) VALUES (?1, ?2, 'accept', 'x', 'both')").bind(sid, email).run();
      await rv("a@example.org", s1); await rv("a@example.org", s2); await rv("b@example.org", s3);
      const d = await (await call("/api/contributors")).json<any>();
      expect(d.reviewers).toEqual([{ name: "Same Person", decisions: 3, weekly: 3 }, { name: "Other", decisions: 0, weekly: 0 }]);
      expect(d.allTime.reviewers).toEqual([{ name: "Same Person", n: 3, badge: null }, { name: "Other", n: 0, badge: null }]);
      expect(d.thisWeek.reviewers).toEqual([{ name: "Same Person", n: 3, badge: null }]);
    } finally { env.REVIEWERS = saved; }
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
