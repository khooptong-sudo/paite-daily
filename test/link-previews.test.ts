import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/index";
import { addSentences, fakeDeps } from "./helpers";

const get = async (path: string) => (await createApp(fakeDeps())(new Request(`https://paite.lamkalabs.com${path}`), env)).text();
const tag = (html: string, key: string) => new RegExp(`<meta (?:property|name)="${key}" content="([^"]*)"`).exec(html)?.[1];
const DEFAULT_TITLE = "Paite Daily — a Paite word corpus";

describe("front page link preview", () => {
  it("names the sentence, escapes it, and leaves other cases alone", async () => {
    const [a, b, c] = await addSentences('Say "hi" <b>& go', "Retired one", "Reverse one");
    await env.DB.prepare("UPDATE sentences SET status = 'retired' WHERE id = ?1").bind(b).run();
    await env.DB.prepare("UPDATE sentences SET direction = 'pai2en', paite_prompt = 'Ka dam e.' WHERE id = ?1").bind(c).run();
    const h = await get(`/?s=${a}&via=wa`);
    for (const k of ["og:title", "twitter:title"]) expect(tag(h, k)).toBe("Hiai Paite in bang chih ding? · How do you say this in Paite?");
    for (const k of ["og:description", "twitter:description"]) expect(tag(h, k)).toBe("“Say &quot;hi&quot; &lt;b&gt;&amp; go” · Answer it on Paite Daily.");
    expect(tag(h, "og:url")).toBe(`https://paite.lamkalabs.com/?s=${a}`);
    expect(h).not.toContain("<b>& go");
    expect(tag(await get(`/?s=${c}`), "og:description")).toBe("“Ka dam e.” · Answer it on Paite Daily.");
    for (const p of ["/", `/?s=${b}`, "/?s=999999", "/?s=abc"]) {
      const d = await get(p);
      expect(tag(d, "og:title")).toBe(DEFAULT_TITLE);
      expect(tag(d, "og:url")).toBe("https://paite.lamkalabs.com/");
    }
  });
});

describe("glossary and sayings link previews", () => {
  it("glossary ?w= sets the tags, unknown id keeps the defaults", async () => {
    const r = await env.DB.prepare("INSERT INTO glossary (paite, english, source) VALUES ('dam<', 'well & good', 'contributed') RETURNING id").first<{ id: number }>();
    const h = await get(`/glossary?w=${r!.id}`);
    expect(tag(h, "og:title")).toBe("Dam&lt; · Paite Word List");
    expect(tag(h, "twitter:description")).toBe("Well &amp; good");
    expect(tag(h, "og:url")).toBe(`https://paite.lamkalabs.com/glossary?w=${r!.id}`);
    expect(h).toContain('<link rel="canonical" href="https://paite.lamkalabs.com/glossary">');
    const d = await get("/glossary?w=999999");
    expect(tag(d, "og:title")).toBe("Paite Word List");
    expect(tag(d, "og:url")).toBe("https://paite.lamkalabs.com/glossary");
  });

  it("proverbs ?s= sets the tags, unknown id keeps the defaults", async () => {
    const r = await env.DB.prepare("INSERT INTO proverbs (kind, paite, english, explainer_en, entered_from, status) VALUES ('proverb', 'Lampam <sik>', 'Road', 'Be careful & kind', 'pai2en', 'live') RETURNING id").first<{ id: number }>();
    const h = await get(`/proverbs?s=${r!.id}`);
    expect(tag(h, "og:title")).toBe("Lampam &lt;sik&gt; · Paite Sayings");
    expect(tag(h, "og:description")).toBe("Be careful &amp; kind");
    expect(tag(h, "og:url")).toBe(`https://paite.lamkalabs.com/proverbs?s=${r!.id}`);
    const d = await get("/proverbs?s=999999");
    expect(tag(d, "og:title")).toBe("Paite Proverbs &amp; Idioms");
  });

  it("an English proverb previews in Paite once it has a Paite version, and invites one while it waits", async () => {
    const done = await env.DB.prepare("INSERT INTO proverbs (kind, paite, english, entered_from, status) VALUES ('proverb', 'Vasa khat khut sunga', 'A bird in the hand', 'en2pai', 'live') RETURNING id").first<{ id: number }>();
    const h = await get(`/proverbs?s=${done!.id}`);
    expect(tag(h, "og:title")).toBe("Vasa khat khut sunga · Paite Sayings");
    expect(tag(h, "og:description")).toBe("A bird in the hand");
    const open = await env.DB.prepare("INSERT INTO proverbs (kind, english, entered_from, status) VALUES ('idiom', 'Head over heels', 'en2pai', 'open') RETURNING id").first<{ id: number }>();
    const o = await get(`/proverbs?s=${open!.id}`);
    if (tag(o, "og:title") !== "Paite Proverbs &amp; Idioms") {
      expect(tag(o, "og:title")).toBe("Head over heels · Paite Sayings");
      expect(tag(o, "og:description")).toBe("Waiting for its Paite version. Do you know it?");
    }
  });
});
