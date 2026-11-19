import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { call, PHONE_A, session } from "./helpers";

const g = async (paite: string, english: string, hidden = 0) =>
  (await env.DB.prepare("INSERT INTO glossary (paite, english, source, hidden) VALUES (?1, ?2, 'note', ?3) RETURNING id").bind(paite, english, hidden).first<{ id: number }>())!.id;
const link = (paite: string, other: string, kind: string, status = "approved", by: string | null = null, reviewer: string | null = null) =>
  env.DB.prepare("INSERT INTO word_links (paite, other, kind, phone_id, status, contributor_name, reviewed_by) VALUES (?1, ?2, ?3, 'x', ?4, ?5, ?6)").bind(paite, other, kind, status, by, reviewer).run();
const page = async () => (await call("/same-opposite")).text();
const post = async (b: Record<string, unknown>, s?: string) => call("/api/link/pair", { method: "POST", body: JSON.stringify(b), session: s ?? (await session(PHONE_A)) });
const rows = async () => (await env.DB.prepare("SELECT paite, other, kind, status FROM word_links ORDER BY id").all()).results;

describe("/same-opposite", () => {
  it("shows approved pairs only, with credits, links and escaping", async () => {
    const id = await g("Tui", "water");
    await link("Tui", "Ti", "same", "approved", "Ann", "rev@example.org");
    await link("Pending", "Word", "same", "pending");
    await link("Rejected", "Word", "opposite", "rejected");
    await link("<script>x</script>", "Mei", "opposite", "approved");
    const html = await page();
    expect(html).toContain(`<a href="/glossary#w-${id}">Tui</a>`);
    expect(html).toContain("<b class=\"w\">Ti</b>");
    expect(html).toContain("Added by Ann");
    expect(html).not.toContain("rev@example.org");
    expect(html).toContain("Added by a contributor");
    expect(html).not.toContain("Pending");
    expect(html).not.toContain("Rejected");
    expect(html).not.toContain("<script>x</script>");
    expect(html).toContain("&lt;script&gt;x&lt;/script&gt;");
  });

  it("groups headwords that share an English meaning and skips hidden rows", async () => {
    await g("Inn", "home");
    await g("Sung", "Home");
    await g("Ngeu", "home", 1);
    await g("Lone", "alone");
    const html = await page();
    expect(html).toContain('<p class="m">Home</p>');
    expect(html).toMatch(/Inn<\/a>, <a[^>]*>Sung/);
    expect(html).not.toContain("Ngeu");
    expect(html).not.toContain('<p class="m">Alone</p>');
  });

  it("shows the empty state", async () => {
    expect(await page()).toContain("No pairs yet");
  });
});

describe("POST /api/link/pair", () => {
  it("needs a session", async () => {
    expect((await call("/api/link/pair", { method: "POST", body: JSON.stringify({ paite: "a", other: "b", kind: "same" }) })).status).toBe(401);
  });

  it("inserts a pending pair, even for words not on the list", async () => {
    expect((await post({ paite: "tui", other: "ti", kind: "opposite", name: "Ann" })).status).toBe(200);
    expect(await rows()).toEqual([{ paite: "Tui", other: "Ti", kind: "opposite", status: "pending" }]);
  });

  it("rejects equal words, a bad kind and bad input", async () => {
    expect((await post({ paite: "Tui", other: " tui ", kind: "same" })).status).toBe(400);
    expect((await post({ paite: "a", other: "b", kind: "both" })).status).toBe(400);
    expect((await post({ paite: "a", other: "", kind: "same" })).status).toBe(400);
    expect((await post({ paite: "a", other: "b".repeat(61), kind: "same" })).status).toBe(400);
    expect((await post({ paite: "a", other: "b", kind: "same", name: "n".repeat(61) })).status).toBe(400);
    expect(await rows()).toEqual([]);
  });

  it("does not insert the reverse of a pair already there", async () => {
    await link("Tui", "Ti", "same");
    expect((await post({ paite: "ti", other: "tui", kind: "same" })).status).toBe(200);
    expect(await rows()).toHaveLength(1);
  });
});

describe("/same-opposite.json", () => {
  it("lists approved pairs sorted, with no emails", async () => {
    await link("Zua", "Ka", "same", "approved", "Ann", "rev@example.org");
    await link("Bang", "Sia", "opposite");
    await link("Hid", "Den", "same", "pending");
    const res = await call("/same-opposite.json");
    expect(res.headers.get("cache-control")).toBe("public, max-age=300");
    const text = await res.text();
    expect(text).not.toContain("@");
    expect(text).not.toContain("Hid");
    expect((JSON.parse(text).pairs as { paite: string }[]).map((p) => p.paite)).toEqual(["Bang", "Zua"]);
  });
});
