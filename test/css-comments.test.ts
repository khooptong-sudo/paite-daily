import { expect, it } from "vitest";
import { env } from "cloudflare:test";

// A stray comment line ("... */" outside a comment) once swallowed the light-mode rule after it, and phones in
// light mode got pale text on paper (23 Nov 2026). Brace counts stayed balanced, so check the comments themselves.
// Fetched from the static assets: a ?raw import of a .css file comes back empty under vitest.
const read = async (f: string): Promise<string> => (await (env as any).ASSETS.fetch(`https://paite.lamkalabs.com/${f}`)).text();
const files = ["style.css", "review/pages.css", "review/visitors.css"];

for (const name of files) {
  it(`${name} has no comment end outside a comment`, async () => {
    const css = await read(name);
    expect(css.length).toBeGreaterThan(100);
    const outside = css.replace(/\/\*[\s\S]*?\*\//g, "");
    const bad = outside.split("\n").map((l: string, i: number) => [i + 1, l] as const).filter(([, l]: readonly [number, string]) => l.includes("*/") || l.includes("/*"));
    expect(bad).toEqual([]);
  });
}

it("the light theme rule sets the ink colours", async () => {
  const outside = (await read("style.css")).replace(/\/\*[\s\S]*?\*\//g, "");
  expect(outside).toMatch(/(^|\n)\s*html\[data-theme=light\] body\.blue \{\s*--bg: #f5f1e8; --fg: #15120f;/);
});
