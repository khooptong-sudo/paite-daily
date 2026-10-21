import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { getProverbs, renderProverbs, submitProverbAnswer } from "../src/proverbs";
import type { Env } from "../src/types";

// A saying goes back into the pool once a reviewed line has published. That is
// only true if submission accepts it, so this guards the gate itself.

const DB = env as unknown as Env;

beforeEach(async () => {
  await DB.DB.batch([
    DB.DB.prepare("DELETE FROM proverb_reviews"),
    DB.DB.prepare("DELETE FROM proverb_answers"),
    DB.DB.prepare("DELETE FROM proverbs"),
  ]);
});

async function saying(status: string, acceptingMore: number): Promise<number> {
  // Both unique indexes are real, so every seeded row needs its own text.
  const uniq = Math.random().toString(36).slice(2);
  const r = await DB.DB.prepare(
    `INSERT INTO proverbs (kind, paite, english, entered_from, status, accepting_more)
     VALUES ('proverb', ?4, ?1, 'en2pai', ?2, ?3) RETURNING id`,
  )
    .bind(`A rolling stone gathers no moss ${uniq}`, status, acceptingMore, `Suang tuktuk pan a kai kei ${uniq}`)
    .first<{ id: number }>();
  return r!.id;
}

describe("a published saying takes more renderings", () => {
  it("accepts a fresh line when accepting_more is set", async () => {
    const id = await saying("live", 1);
    const res = await submitProverbAnswer(DB, "phone-9", { id, paite: "Tui leh mei a kikham kei" });
    expect(res.status).toBe(200);
    const n = await DB.DB.prepare("SELECT count(*) AS n FROM proverb_answers WHERE proverb_id = ?1").bind(id).first<{ n: number }>();
    expect(n!.n).toBe(1);
  });

  it("renders the form again on the public page, with the marker", async () => {
    const open = await saying("live", 1);
    const closed = await saying("live", 0);
    const html = renderProverbs(await getProverbs(DB), "site-key");

    // The saying that is collecting gets a form; the one that is not, does not.
    const collecting = html.split(`id="p-${open}"`)[1] ?? "";
    const settled = html.split(`id="p-${closed}"`)[1] ?? "";
    expect(collecting).toContain("Another version welcome");
    expect(collecting.split("</details>")[0]).toContain("<form");
    expect(settled.split("</details>")[0]).not.toContain("<form");
  });

  it("refuses once the saying is closed to new lines", async () => {
    const id = await saying("live", 0);
    const res = await submitProverbAnswer(DB, "phone-9", { id, paite: "Tui leh mei a kikham kei" });
    expect(res.status).toBe(409);
  });
});
