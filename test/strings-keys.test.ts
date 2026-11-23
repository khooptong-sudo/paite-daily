import { expect, it } from "vitest";
import index from "../public/index.html?raw";
import strings from "../public/strings.js?raw";
import app from "../public/app.js?raw";

// A data-s key missing from strings.js once stopped app.js at startup and broke the live front page (23 Nov 2026).
const keys = new Set([...strings.matchAll(/^\s*([A-Za-z0-9_]+):\s*\{/gm)].map((m) => m[1]));

it("every data-s key on the front page exists in strings.js", () => {
  const used = [...new Set([...index.matchAll(/data-s="([^"]+)"/g)].map((m) => m[1]))];
  expect(used.length).toBeGreaterThan(10);
  expect(used.filter((k) => !keys.has(k))).toEqual([]);
});

it("raw app.js: a missing key falls back to empty text instead of throwing", () => {
  expect(app).toContain('const t = (key) => (!S[key] ? "" :');
  expect(app).toContain('const tBoth = (key) => (!S[key] ? "" :');
});
