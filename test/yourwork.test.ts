import { expect, it } from "vitest";
import html from "../public/index.html?raw";
import week from "../public/week.js?raw";
import puan from "../public/mypuan.js?raw";

it("index.html has the one Your Work card and its parts", () => {
  const card = html.slice(html.indexOf('id="yourwork"'));
  for (const id of ["week-line", "mypuan", "mypuan-c", "mypuan-note", "yw-fixed-list", "yw-share"]) expect(card).toContain(`id="${id}"`);
});

it("index.html no longer has the old week and shawl cards or their share chips", () => {
  for (const id of ["week", "week-share", "mypuan-share"]) expect(html).not.toContain(`id="${id}"`);
});

it.each([["week.js", week], ["mypuan.js", puan]])("%s only reads ids that index.html has", (_n, src) => {
  const ids = [...src.matchAll(/getElementById\("([^"]+)"\)/g)].map((m) => m[1]);
  expect(ids.length).toBeGreaterThan(0);
  for (const id of ids) expect(html, id).toContain(`id="${id}"`);
});
