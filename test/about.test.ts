import { describe, expect, it } from "vitest";
import { renderAbout } from "../src/about";

// /about is a pure function: no env, no DB, no Turnstile, no user input.
// These assertions are mostly a terminology guard — the wording of this page is
// the thing that was argued over, so it is the thing worth locking down.

const html = renderAbout();

describe("about page", () => {
  it("renders a complete document with the shared shell", () => {
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html.trimEnd().endsWith("</html>")).toBe(true);
    expect(html).toContain("<title>About Paite Daily</title>");
    expect(html).toContain('href="/style.css"');
    expect(html).toContain('href="/contributors.css"');
    // the footer is shared with /glossary, /proverbs and /contributors
    expect(html).toContain('class="foot"');
    expect(html).toContain("mailto:theconcierge@lamkalabs.com");
    // the shawl band in the hero, same as the other pages
    expect(html).toContain('class="puan"');
  });

  it("carries the canonical and social metadata", () => {
    expect(html).toContain('<link rel="canonical" href="https://paite.lamkalabs.com/about">');
    expect(html).toContain('property="og:image" content="https://paite.lamkalabs.com/og.png"');
    expect(html).toContain('name="twitter:card" content="summary_large_image"');
    expect(html).toContain('<link rel="icon" href="/favicon.ico" sizes="32x32">');
  });

  it("declares the corpus as a CC0 dataset", () => {
    expect(html).toContain('"@type":"Dataset"');
    expect(html).toContain("creativecommons.org/publicdomain/zero/1.0");
    expect(html).toContain('"inLanguage":"pck"');
  });

  it("states the mother-tongue figure, not an ethnic population estimate", () => {
    expect(html).toContain("78,725");
    expect(html).toContain("mother tongue is Paite");
  });

  it("never classifies Paite by an exonym", () => {
    // The language is called Paite. It is a Tibeto-Burman language of Manipur.
    // "Kuki" is a colonial exonym and "Chin" a Burmese one; "Tedim" is a
    // different, sister language. None of them belong on this page.
    for (const term of ["Kuki", "Chin", "Tedim", "Tiddim", "Zomi language"]) {
      expect(html, `retired term on /about: ${term}`).not.toContain(term);
    }
    expect(html).toContain("independent Tibeto-Burman language");
  });

  it("promises no cadence it cannot keep", () => {
    expect(html.toLowerCase()).not.toContain("one sentence a day");
    expect(html).not.toContain("[YOUR NAME]");
    expect(html).not.toContain("[EMAIL]");
  });

  it("puts coffee first, then a contact band holding the icons and the credit line", () => {
    const foot = html.slice(html.indexOf('<footer class="foot">'));
    const reach = foot.slice(foot.indexOf('<div class="reach">'), foot.indexOf("</footer>"));
    expect(foot.indexOf('id="coffee"')).toBeLessThan(foot.indexOf('<div class="reach">'));
    expect(reach).toContain('<p class="note2">Contact for data, corrections, partnerships, or to volunteer as a reviewer.');
    expect(reach).toContain('<p class="contact">');
    expect(reach).toContain("whatsapp.png");
    expect(reach).toContain('<p class="built">Built and maintained by');
    // each piece moved, not copied
    expect(html.split('<p class="contact">').length).toBe(2);
    expect(html.split("Built and maintained by").length).toBe(2);
  });

  it("skips the squiggle for reduced motion", () => {
    expect(html).toContain("prefers-reduced-motion: reduce");
  });

  it("admits no advertising", () => {
    expect(html).toContain("carries no advertising and never will");
    expect(html.toLowerCase()).not.toContain("google ads");
  });
});
