import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { getProverbs, proverbsJson } from "../src/proverbs";
import { call, PHONE_A, PHONE_B, session } from "./helpers";

type Row = {
  kind?: string;
  paite?: string | null;
  english?: string | null;
  explainer?: string | null;
  explainer_en?: string | null;
  entered_from: string;
  status?: string;
};

async function add(r: Row): Promise<number> {
  const out = await env.DB.prepare(
    `INSERT INTO proverbs (kind, paite, english, explainer, explainer_en, entered_from, status)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) RETURNING id`,
  )
    .bind(r.kind ?? "proverb", r.paite ?? null, r.english ?? null, r.explainer ?? null, r.explainer_en ?? null, r.entered_from, r.status ?? "live")
    .first<{ id: number }>();
  return out!.id;
}

const PAI = "Lampam sik khiallou kuamah omlou";
const PAI_WHY = "Mihingte kuamah hoih bukim omlou, damsung a thilhih khiallou omlou chih genna ahi.";

describe("/proverbs", () => {
  it("shows a Paite proverb with its explainer", async () => {
    await add({ paite: PAI, explainer: PAI_WHY, entered_from: "pai2en" });
    const res = await call("/proverbs");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain(PAI);
    expect(html).toContain(PAI_WHY);
    expect(html).toContain('data-dir="pai2en"');
    expect(html).toContain('data-s="kindProverb"');
  });

  it("marks an English idiom that has no Paite line yet", async () => {
    await add({ kind: "idiom", english: "A stitch in time saves nine", explainer_en: "Mend it now.", entered_from: "en2pai", status: "open" });
    const html = await (await call("/proverbs")).text();
    expect(html).toContain("A stitch in time saves nine");
    expect(html).toContain('data-dir="en2pai"');
    expect(html).toContain('data-s="needsPaite"');
    expect(html).toContain('data-s="kindIdiom"');
  });

  it("keeps hidden and unreviewed entries off the page", async () => {
    await add({ paite: "Hidden one", explainer: "x", entered_from: "pai2en", status: "hidden" });
    await add({ paite: "Pending one", explainer: "x", entered_from: "pai2en", status: "pending" });
    const html = await (await call("/proverbs")).text();
    expect(html).not.toContain("Hidden one");
    expect(html).not.toContain("Pending one");
  });

  it("groups by the first letter and counts each group", async () => {
    await add({ paite: "Lampam sik khiallou kuamah omlou", explainer: "x", entered_from: "pai2en" });
    await add({ paite: "Lungdamna in nei ve", explainer: "y", entered_from: "pai2en" });
    const html = await (await call("/proverbs")).text();
    expect(html).toContain('data-letter="L"');
    expect(html).toContain('<span class="cnt">2</span>');
  });

  it("escapes what contributors write", async () => {
    await add({ paite: "<script>alert(1)</script>", explainer: "a < b", entered_from: "pai2en" });
    const html = await (await call("/proverbs")).text();
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("a &lt; b");
  });

  it("serves the list as JSON without row ids", async () => {
    const id = await add({ paite: PAI, explainer: PAI_WHY, entered_from: "pai2en" });
    const res = await call("/proverbs.json");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = (await res.json()) as any;
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0]).toMatchObject({ paite: PAI, explainer: PAI_WHY, kind: "proverb", entered_from: "pai2en" });
    expect(body.entries[0].id).toBeUndefined();
    expect(id).toBeGreaterThan(0);
  });

  it("sorts the JSON by the saying itself", async () => {
    await add({ paite: "Zia leh zalenna", explainer: "x", entered_from: "pai2en" });
    await add({ paite: "A uh leh a uh", explainer: "y", entered_from: "pai2en" });
    const xs = await getProverbs(env);
    const order = JSON.parse(proverbsJson(xs)).entries.map((e: any) => e.paite);
    expect(order).toEqual(["A uh leh a uh", "Zia leh zalenna"]);
  });

  it("offers the translation form only where the Paite line is missing", async () => {
    const open = await add({ kind: "idiom", english: "Break the ice", explainer_en: "Start a conversation.", entered_from: "en2pai", status: "open" });
    await add({ paite: PAI, english: "Nobody walks the path without fault", explainer: PAI_WHY, entered_from: "pai2en" });
    const html = await (await call("/proverbs")).text();
    expect(html.match(/<form data-id=/g)?.length).toBe(1);
    expect(html).toContain(`<form data-id="${open}"`);
    expect(html).toContain("1 waiting.");
    expect(html).toContain('data-sitekey="1x00000000000000000000AA"');
  });

  it("shows how many translations a saying has drawn", async () => {
    const id = await add({ kind: "idiom", english: "Break the ice", explainer_en: "Start a conversation.", entered_from: "en2pai", status: "open" });
    await env.DB.prepare("INSERT INTO proverb_answers (proverb_id, paite, phone_id) VALUES (?1, 'Thu khat', ?2)").bind(id, PHONE_B).run();
    const html = await (await call("/proverbs")).text();
    expect(html).toContain("1 translation so far");
  });
});

describe("POST /api/proverb/answer", () => {
  async function post(body: unknown, phone?: string) {
    return call("/api/proverb/answer", { method: "POST", body: JSON.stringify(body), ...(phone ? { session: await session(phone) } : {}) });
  }
  const open = () => add({ kind: "idiom", english: "Break the ice", explainer_en: "Start a conversation.", entered_from: "en2pai", status: "open" });

  it("needs a session", async () => {
    const id = await open();
    expect((await post({ id, paite: "Thu khat" })).status).toBe(401);
  });

  it("stores the Paite version for a reviewer, not on the page", async () => {
    const id = await open();
    const res = await post({ id, paite: "Thu khat gen in", explainer: "Kithuah dingin" }, PHONE_A);
    expect(res.status).toBe(200);
    const row = await env.DB.prepare("SELECT proverb_id, paite, explainer, phone_id, status FROM proverb_answers WHERE proverb_id = ?1").bind(id).first<any>();
    expect(row).toMatchObject({ proverb_id: id, paite: "Thu khat gen in", explainer: "Kithuah dingin", phone_id: PHONE_A, status: "new" });
    // The saying still has no Paite line until a reviewer accepts one.
    const p = await env.DB.prepare("SELECT status, paite FROM proverbs WHERE id = ?1").bind(id).first<any>();
    expect(p).toMatchObject({ status: "open", paite: null });
  });

  it("rejects a bad or unknown id, an empty line, and a closed saying", async () => {
    const id = await open();
    expect((await post({ paite: "x" }, PHONE_A)).status).toBe(400);
    expect((await post({ id, paite: "   " }, PHONE_A)).status).toBe(400);
    expect((await post({ id: 999_999, paite: "x" }, PHONE_A)).status).toBe(404);
    const live = await add({ paite: PAI, explainer: PAI_WHY, entered_from: "pai2en" });
    expect((await post({ id: live, paite: "x" }, PHONE_A)).status).toBe(409);
  });

  it("keeps one row per phone per wording", async () => {
    const id = await open();
    expect((await post({ id, paite: "Thu khat" }, PHONE_A)).status).toBe(200);
    expect((await post({ id, paite: "thu khat" }, PHONE_A)).status).toBe(200);
    const n = await env.DB.prepare("SELECT count(*) AS n FROM proverb_answers WHERE proverb_id = ?1").bind(id).first<{ n: number }>();
    expect(n!.n).toBe(1);
    // Another contributor can offer the same wording: they are separate votes.
    expect((await post({ id, paite: "Thu khat" }, PHONE_B)).status).toBe(200);
    const m = await env.DB.prepare("SELECT count(*) AS n FROM proverb_answers WHERE proverb_id = ?1").bind(id).first<{ n: number }>();
    expect(m!.n).toBe(2);
  });

  it("stops a phone after twenty translations in a day", async () => {
    const id = await open();
    for (let i = 0; i < 20; i++)
      await env.DB.prepare("INSERT INTO proverb_answers (proverb_id, paite, phone_id) VALUES (?1, ?2, ?3)").bind(id, `line ${i}`, PHONE_A).run();
    expect((await post({ id, paite: "one more" }, PHONE_A)).status).toBe(429);
    expect((await post({ id, paite: "one more" }, PHONE_B)).status).toBe(200);
  });
});
