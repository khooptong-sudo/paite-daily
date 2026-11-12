import { describe, expect, it } from "vitest";
import { FOOTER } from "../src/footer";
import page404 from "../public/404.html?raw";
import page500 from "../public/500.html?raw";
import index from "../public/index.html?raw";

// The footer is shared by every page with one, in two forms: the FOOTER string for the
// server-rendered pages, and hand-kept copies in the static pages. Everything sits in one
// paper band: the Paper Silk canvas, the note, a row of hairline links, then the credit line.

const band = (html: string) => html.slice(html.indexOf('<div class="reach">'), html.indexOf("</footer>"));
const links = (html: string) => html.slice(html.indexOf('<p class="links">'), html.indexOf("</p>", html.indexOf('<p class="links">')));

describe("shared footer", () => {
  it("holds the silk canvas, the note, the links and the credit line in the band", () => {
    const b = band(FOOTER);
    expect(b).toContain('<canvas class="silk" aria-hidden="true"></canvas>');
    expect(b).toContain("Contact for data, corrections, partnerships, or to volunteer as a reviewer.");
    expect(b).toContain("mailto:theconcierge@lamkalabs.com");
    expect(b).toContain("whatsapp.png");
    expect(b).toContain('<p class="built">Built and maintained by');
  });

  it("leads the link row with Buy us Coffee, then Email, then WhatsApp", () => {
    const row = links(FOOTER);
    expect(row).toContain('<span data-s="coffee">Buy us Coffee</span>');
    expect(row.indexOf('id="coffee"')).toBeLessThan(row.indexOf('class="mail"'));
    expect(row.indexOf('class="mail"')).toBeLessThan(row.indexOf('class="wa"'));
  });

  it("keeps the UPI panel after the links and before the credit line", () => {
    const b = band(FOOTER);
    expect(b.indexOf('id="upi"')).toBeGreaterThan(b.indexOf('<p class="links">'));
    expect(b.indexOf('id="upi"')).toBeLessThan(b.indexOf('<p class="built">'));
  });

  it("matches the front page copy exactly, apart from indentation", () => {
    const flat = (s: string) => s.replace(/\r/g, "").replace(/\n\s+/g, "\n").trim();
    const footer = (s: string) => s.slice(s.indexOf('<footer class="foot">'), s.indexOf("</footer>") + 9);
    expect(flat(footer(index))).toBe(flat(footer(FOOTER)));
  });

  const pages: Record<string, string> = { "index.html": index, "404.html": page404, "500.html": page500 };
  for (const [page, html] of Object.entries(pages)) {
    it(`public/${page} carries the same band and loads footer.js`, () => {
      const b = band(html);
      expect(b).toContain('<canvas class="silk" aria-hidden="true"></canvas>');
      expect(b).toContain('<p class="links">');
      expect(links(html)).toContain('class="mail"');
      expect(links(html)).toContain('class="wa"');
      expect(b).toContain('<p class="built">Built and maintained by');
      expect(html).toMatch(/<script src="\/footer\.js"( defer)?><\/script>/);
    });
  }
});
