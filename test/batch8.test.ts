import { env } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";
import review from "../public/review/review.js?raw";
import proverbsPage from "../public/review/proverbs.html?raw";
import { saveProverbReview } from "../src/proverbcard";
import type { Env } from "../src/types";
import { addSentences, call, fakeDeps, NOW, PHONE_A, PHONE_B, session } from "./helpers";

const as = (email: string) => fakeDeps({ verifyReviewer: async () => email, now: () => NOW });
const rev = (path: string, body?: unknown, email = "rev@example.org") =>
  call(path, body === undefined ? {} : { method: "POST", body: JSON.stringify(body) }, as(email));
afterEach(async () => { await env.DB.prepare("DELETE FROM proverb_reviews").run(); });
const OWNER = "owner@example.org";
const H = { "X-Admin": "1", Origin: "https://paite.lamkalabs.com" };

describe("link-phone", () => {
  const link = (email: string) => rev("/review/api/link-phone", { phoneId: PHONE_A }, email);
  const who = async () => (await env.DB.prepare("SELECT reviewer_email FROM reviewer_phones WHERE phone_id = ?1").bind(PHONE_A).first<{ reviewer_email: string }>())!.reviewer_email;
  it("refuses a phone already linked to another reviewer, allows your own again and the owner", async () => {
    await env.DB.prepare("INSERT INTO reviewers (email, name, added_by) VALUES ('two@example.org', 'Two', 'test')").run();
    expect((await link("rev@example.org")).status).toBe(200);
    const r = await link("two@example.org");
    expect(r.status).toBe(409);
    expect(await who()).toBe("rev@example.org");
    expect((await link("rev@example.org")).status).toBe(200);
    expect((await link(OWNER)).status).toBe(200);
    expect(await who()).toBe(OWNER);
  });
});

describe("admin AI address", () => {
  it.each(["https://localhost/v1", "https://127.0.0.1/v1", "https://127.5.6.7", "https://10.1.2.3", "https://172.16.0.1", "https://172.31.9.9", "https://192.168.1.1", "https://169.254.169.254/latest", "https://intranet", "https://[::1]/v1", "https://[fc00::1]/v1"])("refuses %s", async (baseUrl) => {
    const token = "a".repeat(63) + "1";
    const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)))].map((b) => b.toString(16).padStart(2, "0")).join("");
    await env.DB.prepare("INSERT OR REPLACE INTO admin_links (token_hash, email, expires_at) VALUES (?1, ?2, ?3)").bind(hash, OWNER, NOW + 60_000).run();
    const s = await call("/admin/api/password/set", { method: "POST", headers: H, body: JSON.stringify({ token, password: "correct horse" }) });
    const cookie = s.headers.get("Set-Cookie")!.split(";")[0];
    const r = await call("/admin/api/ai", { method: "POST", headers: { ...H, Cookie: cookie }, body: JSON.stringify({ provider: "custom", baseUrl, model: "m", key: "abcdefgh123" }) });
    expect(r.status).toBe(400);
    expect(((await r.json()) as any).error).toBe("bad_url");
  });
});

describe("corrected also-correct variant", () => {
  it("saves the edited text for the variant, keeps the original in history, and undo restores it", async () => {
    const [id] = await addSentences("I am well.");
    for (const [ph, t] of [[PHONE_A, "Ka dam e."], [PHONE_B, "Ka dam ee."]] as const)
      await call("/api/answer", { method: "POST", session: await session(ph), body: JSON.stringify({ sentenceId: id, paite: t, register: "both" }) });
    const card = await (await rev("/review/api/next")).json<{ answers: { id: number; paite: string }[] }>();
    const a = card.answers.find((x) => x.paite === "Ka dam e.")!, b = card.answers.find((x) => x.paite === "Ka dam ee.")!;
    const r = await rev("/review/api/decide", { sentenceId: id, decision: "accept", answerIds: card.answers.map((x) => x.id), answerId: a.id, alsoCorrect: [b.id], variantEdits: { [b.id]: "Ka dam hi." } });
    expect(r.status).toBe(200);
    const { reviewId } = await r.json<{ reviewId: number }>();
    const text = async () => (await env.DB.prepare("SELECT paite FROM answers WHERE id = ?1").bind(b.id).first<{ paite: string }>())!.paite;
    expect(await text()).toBe("Ka dam hi.");
    const hist = await env.DB.prepare("SELECT final_paite FROM reviews WHERE decision = 'variant' AND accepted_answer_id = ?1").bind(b.id).first<{ final_paite: string }>();
    expect(hist!.final_paite).toBe("Ka dam ee.");
    expect((await rev("/review/api/undo", { reviewId })).status).toBe(200);
    expect(await text()).toBe("Ka dam ee.");
  });

  it("proverbs: the variant keeps the corrected text and the original is in the review row", async () => {
    const E = env as unknown as Env;
    const p = await E.DB.prepare("INSERT INTO proverbs (kind, paite, english, entered_from, status, accepting_more) VALUES ('proverb', NULL, 'A stitch in time', 'en2pai', 'open', 0) RETURNING id").first<{ id: number }>();
    const mk = async (t: string) => (await E.DB.prepare("INSERT INTO proverb_answers (proverb_id, paite, phone_id, contributor_name) VALUES (?1, ?2, 'p-1', 'C') RETURNING id").bind(p!.id, t).first<{ id: number }>())!.id;
    const win = await mk("Lampam sik"), keep = await mk("Suang tuktuk");
    await saveProverbReview(E, "rev@example.org", { proverbId: p!.id, acceptAnswerId: win, alsoCorrect: [keep], variantEdits: { [keep]: "Suang tuktuk." } } as any);
    expect((await E.DB.prepare("SELECT paite, status FROM proverb_answers WHERE id = ?1").bind(keep).first<any>())).toEqual({ paite: "Suang tuktuk.", status: "also_correct" });
    expect((await E.DB.prepare("SELECT final_paite FROM proverb_reviews WHERE answer_id = ?1 AND decision = 'variant'").bind(keep).first<any>()).final_paite).toBe("Suang tuktuk");
  });
});

describe("contributors reviewer badge", () => {
  it("only for current reviewers", async () => {
    const [s1] = await addSentences("One.");
    await env.DB.prepare("INSERT INTO answers (sentence_id, phone_id, paite, register, contributor_name, status) VALUES (?1, ?2, 'x', 'both', 'Gone', 'accepted')").bind(s1, PHONE_A).run();
    await env.DB.prepare("INSERT INTO reviewer_phones (phone_id, reviewer_email) VALUES (?1, 'gone@example.org')").bind(PHONE_A).run();
    await env.DB.prepare("INSERT INTO reviewers (email, name, added_by, removed_at) VALUES ('gone@example.org', 'Gone', 't', datetime('now'))").run();
    expect((await (await call("/api/contributors")).json<any>()).contributors[0].reviewer).toBe(false);
    await env.DB.prepare("UPDATE reviewers SET removed_at = NULL WHERE email = 'gone@example.org'").run();
    expect((await (await call("/api/contributors")).json<any>()).contributors[0].reviewer).toBe(true);
  });
});

describe("reviewer page source", () => {
  it("decide maps the server's error code, says No connection, and keeps the old Undo on a failed save", () => {
    const send = review.slice(review.indexOf("async function send("), review.indexOf('$("undo").addEventListener'));
    expect(send).toContain('j.error === "bad_answer"');
    expect(send).toContain('j.error === "own_submission"');
    expect(send).toContain('j.error === "lock_lost"');
    expect(send).toContain('"No connection. Try again."');
    expect(send).not.toMatch(/busy = true; hideUndo\(\)/);
    expect(send.indexOf("hideUndo()")).toBeGreaterThan(send.indexOf("if (r.ok)"));
  });
  it("glossary and new word and link buttons survive a failed request and refuse a blank English meaning", () => {
    for (const path of ["glossary/edit", "glossary/hide", "words/decide", "links/decide"])
      expect(review).toMatch(new RegExp("try \\{ x = await post\\(\"/review/api/" + path));
    expect(review).toContain("Give the English meaning first.");
  });
  it("the pages send the corrected text of ticked variants", () => {
    expect(review).toContain("variantEdits");
    expect(proverbsPage).toContain("variantEdits");
  });
});
