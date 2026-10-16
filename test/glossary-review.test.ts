import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { call, fakeDeps } from "./helpers";

// A reviewer identity for the /review/api routes, and a plain contributor for the public ones.
const rev = (path: string, body?: unknown, email = "rev@example.org") =>
  call(path, body === undefined ? {} : { method: "POST", body: JSON.stringify(body) }, fakeDeps({ verifyAccess: async () => email }));
const post = (path: string, body: unknown) => ({ method: "POST", body: JSON.stringify(body) });

async function seed(rows: [string, string, string | null][]): Promise<number[]> {
  const ids: number[] = [];
  for (const [paite, english, note] of rows) {
    const r = await env.DB.prepare("INSERT INTO glossary (paite, english, note, source) VALUES (?1, ?2, ?3, 'note') RETURNING id")
      .bind(paite, english, note).first<{ id: number }>();
    ids.push(r!.id);
  }
  return ids;
}
const publicList = async () => (await (await call("/glossary")).text());

describe("reviewer glossary list", () => {
  it("returns every word with the hidden flag and the edit trail", async () => {
    const [id] = await seed([["Tui", "Water", null], ["Zu", "Drink", null]]);
    await env.DB.prepare("UPDATE glossary SET hidden = 1 WHERE id = ?1").bind(id).run();
    const r = await rev("/review/api/glossary");
    expect(r.status).toBe(200);
    const { entries } = await r.json<{ entries: { paite: string; english: string; hidden: number; edited_at: string | null }[] }>();
    expect(entries.map((e) => [e.paite, e.english, e.hidden])).toEqual([["Tui", "Water", 1], ["Zu", "Drink", 0]]);
    expect(entries[0].edited_at).toBeNull();
  });

  it("stays behind the reviewer check", async () => {
    expect((await call("/review/api/glossary")).status).toBe(401);
  });
});

describe("correcting a word", () => {
  it("saves the correction, records who made it, and shows it on the public page", async () => {
    const [id] = await seed([["Tui", "Water", "wrong note"]]);
    const r = await rev("/review/api/glossary/edit", { id, paite: "tui", english: "water (drinking)", note: "" });
    expect(r.status).toBe(200);
    const row = await env.DB.prepare("SELECT paite, english, note, edited_by, edited_at FROM glossary WHERE id = ?1").bind(id).first();
    expect(row).toMatchObject({ paite: "Tui", english: "Water (drinking)", note: null, edited_by: "rev@example.org" });
    expect((row as { edited_at: string | null }).edited_at).not.toBeNull();
    const page = await publicList();
    expect(page).toContain("Water (drinking)");
    expect(page).not.toContain("wrong note");
  });

  it("refuses a correction with no word or no meaning, a bad id, or a missing row", async () => {
    const [id] = await seed([["Tui", "Water", null]]);
    expect((await rev("/review/api/glossary/edit", { id, paite: "", english: "Water" })).status).toBe(400);
    expect((await rev("/review/api/glossary/edit", { id, paite: "Tui", english: "   " })).status).toBe(400);
    expect((await rev("/review/api/glossary/edit", { id: "x", paite: "Tui", english: "Water" })).status).toBe(400);
    expect((await rev("/review/api/glossary/edit", { id: 99999, paite: "Tui", english: "Water" })).status).toBe(404);
  });

  it("refuses a correction that copies a word already in the list", async () => {
    const [a, b] = await seed([["Tui", "Water", null], ["Zu", "Drink", null]]);
    const r = await rev("/review/api/glossary/edit", { id: b, paite: "Tui", english: "Water" });
    expect(r.status).toBe(409);
    expect((await r.json<{ message: string }>()).message).toContain("already in the list");
    expect(await env.DB.prepare("SELECT paite FROM glossary WHERE id = ?1").bind(a).first()).toEqual({ paite: "Tui" });
  });
});

describe("hiding and restoring a word", () => {
  it("hides a word from the public list and puts it back", async () => {
    const [id] = await seed([["Tui", "Water", null]]);
    expect((await rev("/review/api/glossary/hide", { id })).status).toBe(200);
    expect(await publicList()).not.toContain("Water");
    expect((await rev("/review/api/glossary/hide", { id, hidden: false })).status).toBe(200);
    expect(await publicList()).toContain("Water");
  });

  it("refuses a non-boolean hidden flag and a missing row", async () => {
    const [id] = await seed([["Tui", "Water", null]]);
    expect((await rev("/review/api/glossary/hide", { id, hidden: "no" })).status).toBe(400);
    expect((await rev("/review/api/glossary/hide", { id: 99999 })).status).toBe(404);
  });
});
