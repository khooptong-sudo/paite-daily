import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/index";
import { renderAbout } from "../src/about";
import { fakeDeps } from "./helpers";

const on = { ...env, WIKI_PUBLIC: "1" };
const page = (path: string, e: any = env) => createApp(fakeDeps())(new Request(`https://paite.lamkalabs.com${path}`), e);

describe("wiki how page", () => {
  it("is 404 when the wiki is not public", async () => {
    expect((await page("/wiki/how")).status).toBe(404);
  });

  it("shows the text when public, with no internal names", async () => {
    const res = await page("/wiki/how", on);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=300");
    const html = await res.text();
    for (const h of ["How the Paite Wiki Works", "How a question gets answered", "Human checks"]) expect(html).toContain(h);
    expect(html).toContain('<link rel="canonical" href="https://paite.lamkalabs.com/wiki/how">');
    for (const bad of ["DeepSeek", "Claude", "OpenAI", "kb_", "Vectorize", "300", "Zomi", "Tedim", "Chin", "Kuki"]) expect(html).not.toContain(bad);
  });

  it("wins over an article slugged how", async () => {
    await env.WIKI.prepare("INSERT INTO kb_articles (slug, title, status, created_by, created_at, updated_at) VALUES ('how', 'Not this', 'published', 'x', 1, 1)").run();
    const html = await (await page("/wiki/how", on)).text();
    expect(html).toContain("How the Paite Wiki Works");
    expect(html).not.toContain("Not this");
    await env.WIKI.prepare("DELETE FROM kb_articles WHERE slug = 'how'").run();
  });

  it("is linked from the index and the About page only when public", async () => {
    expect(await (await page("/wiki", on)).text()).toContain('href="/wiki/how"');
    expect(await (await page("/about", on)).text()).toContain('href="/wiki/how"');
    expect(renderAbout(false)).not.toContain("/wiki/how");
  });
});
