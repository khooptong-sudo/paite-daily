import { describe, expect, it } from "vitest";
import html from "../public/index.html?raw";

// Raw-file checks on public/index.html (plan 022).
const at = (s: string, from = 0) => { const i = html.indexOf(s, from); expect(i, s).toBeGreaterThan(-1); return i; };

describe("calmer front page (raw html checks)", () => {
  it("Translate card comes before What's New, Contributor of the Day and the chat", () => {
    const tr = at('<div class="label" id="label"');
    expect(tr).toBeLessThan(at('id="whatsnew"'));
    expect(tr).toBeLessThan(at('id="cotd"'));
    expect(tr).toBeLessThan(at('id="chat"'));
  });
  it("More Ways to Help holds the four task cards, after the chat and before the first link panel", () => {
    const start = at('<h2 class="more-h" id="more-h">More Ways to Help</h2>');
    const end = at('<a class="pan"');
    expect(start).toBeGreaterThan(at('id="chat"'));
    expect(start).toBeLessThan(end);
    const block = html.slice(start, end);
    for (const id of ["saying-h", "meaning-h", "link-h", "word-h"]) expect(block).toContain(`id="${id}"`);
  });
  it("each More Ways card is a closed disclosure", () => {
    for (const id of ["say", "meaning", "link", "word"]) expect(html).toMatch(new RegExp(`<details class="more-box" id="more-${id}">\\s*<summary>`));
  });
  it("explanation, register and place sit in the Add Details fold, inside the form; register still defaults to both", () => {
    const f0 = at('<form id="form"');
    const form = html.slice(f0, at("</form>", f0));
    const fold = form.slice(form.indexOf('<details class="more-box fold"'), form.indexOf("</details>"));
    expect(fold).toContain("Add Details (optional)");
    for (const k of ['id="explanation"', 'class="register"', 'id="place"']) expect(fold).toContain(k);
    expect(fold).toContain('value="both" checked');
    expect(form.indexOf("Add Details")).toBeLessThan(form.indexOf('id="send"'));
  });
  it("ask-relative appears once and the long ask block is gone", () => {
    expect(html.match(/id="ask-relative"/g)).toHaveLength(1);
    expect(html).toContain("Ask a relative or friend &rarr;");
    expect(html).not.toContain("Na sungte/lawmte");
    expect(html).not.toContain('data-s="askHelp"');
  });
  it("the details fold script wraps localStorage in try/catch", () => {
    const a = at("const d = document.getElementById");
    const s = html.slice(a, at("</script>", a));
    expect(s.match(/try \{[^}]*localStorage[^}]*\} catch/g)).toHaveLength(2);
    expect(s).toContain("pd:details");
  });
  it("index.html has no duplicate ids", () => {
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
    expect(ids.filter((x, i) => ids.indexOf(x) !== i)).toEqual([]);
  });
});
