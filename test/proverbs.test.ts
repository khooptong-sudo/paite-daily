import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { getProverbs, proverbsJson } from "../src/proverbs";
import { call } from "./helpers";

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
});
