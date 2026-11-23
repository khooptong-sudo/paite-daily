/// <reference types="vite/client" />
import { expect, it } from "vitest";
import { env } from "cloudflare:test";

// Fonts are self-hosted (23 Nov 2026): no page may reach Google, and every file fonts.css names must be served.
// .css and .woff2 come through ASSETS.fetch because a ?raw import of those is empty under vitest.
// @ts-ignore vite glob, not in the worker types
const srcs = import.meta.glob("../src/**/*.ts", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
// @ts-ignore vite glob, not in the worker types
const pages = import.meta.glob("../public/**/*.{html,js}", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const get = (p: string) => (env as any).ASSETS.fetch(`https://paite.lamkalabs.com/${p}`);

it("no file in src/ or public/ names a Google font host", () => {
  const all = { ...srcs, ...pages };
  expect(Object.keys(all).length).toBeGreaterThan(20);
  const bad = Object.entries(all).filter(([, t]) => /fonts\.googleapis\.com|fonts\.gstatic\.com/.test(t)).map(([f]) => f);
  expect(bad).toEqual([]);
});

it("every page that loads fonts links /fonts.css and preloads the three Latin files", () => {
  const withLink = Object.entries({ ...srcs, ...pages }).filter(([, t]) => t.includes('href="/fonts.css"'));
  expect(withLink.length).toBeGreaterThanOrEqual(19);
  for (const [f, t] of withLink) {
    for (const n of ["youngserif-latin", "instrumentserif-italic-latin", "inter-latin"]) {
      expect(t, f).toContain(`<link rel="preload" href="/fonts/${n}.woff2" as="font" type="font/woff2" crossorigin>`);
    }
  }
});

it("every file fonts.css names exists, and the service worker precaches fonts.css and the Latin files", async () => {
  const css = await (await get("fonts.css")).text();
  const urls = [...css.matchAll(/url\((\/fonts\/[^)]+)\)/g)].map((m) => m[1]);
  expect(urls.length).toBe(6);
  for (const u of urls) {
    const r = await get(u.slice(1));
    expect(r.status, u).toBe(200);
    expect((await r.arrayBuffer()).byteLength, u).toBeGreaterThan(5000);
  }
  const sw = await (await get("sw.js")).text();
  for (const p of ["/fonts.css", ...urls.filter((u) => !u.includes("-ext"))]) expect(sw, p).toContain(`"${p}"`);
});
