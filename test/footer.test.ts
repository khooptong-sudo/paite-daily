import { describe, expect, it } from "vitest";
import { FOOTER } from "../src/footer";
import page404 from "../public/404.html?raw";
import page500 from "../public/500.html?raw";
import index from "../public/index.html?raw";

// The footer is shared by every page with one, in two forms: the FOOTER string for the
// server-rendered pages, and hand-kept copies in the static pages. These checks keep the
// copies in the same order: coffee first, then the charcoal contact band.

const band = (html: string) => html.slice(html.indexOf('<div class="reach">'), html.indexOf("</footer>"));

describe("shared footer", () => {
  it("puts the coffee button before the contact band", () => {
    expect(FOOTER.indexOf('id="coffee"')).toBeGreaterThan(-1);
    expect(FOOTER.indexOf('id="coffee"')).toBeLessThan(FOOTER.indexOf('<div class="reach">'));
  });

  it("holds the waveform, the note, both contact marks and the credit line in the band", () => {
    const b = band(FOOTER);
    expect(b).toContain('<canvas class="wave" aria-hidden="true"></canvas>');
    expect(b).toContain("Contact for data, corrections, partnerships, or to volunteer as a reviewer.");
    expect(b).toContain("mailto:theconcierge@lamkalabs.com");
    expect(b).toContain("whatsapp.png");
    expect(b).toContain('<p class="built">Built and maintained by');
  });

  const pages: Record<string, string> = { "index.html": index, "404.html": page404, "500.html": page500 };
  for (const [page, html] of Object.entries(pages)) {
    it(`public/${page} carries the same band and loads footer.js`, () => {
      const b = band(html);
      expect(b).toContain('<canvas class="wave" aria-hidden="true"></canvas>');
      expect(b).toContain('<p class="contact">');
      expect(b).toContain('<p class="built">Built and maintained by');
      expect(html).toContain('<script src="/footer.js"></script>');
    });
  }

  it("keeps the coffee button first on the front page", () => {
    expect(index.indexOf('id="coffee"')).toBeLessThan(index.indexOf('<div class="reach">'));
  });
});
