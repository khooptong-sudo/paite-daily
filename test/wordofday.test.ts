import { describe, expect, it } from "vitest";
import data from "../src/word-of-day.json";
import html from "../public/index.html?raw";
import sw from "../public/sw.js?raw";
import js from "../public/wotd.js?raw";
import { call, fakeDeps } from "./helpers";

const get = async (iso: string) => { const r = await call("/api/word-of-day", {}, fakeDeps({ now: () => Date.parse(iso) })); return { r, j: await r.json() as { paite: string; english: string; type: string; date: string } }; };

describe("/api/word-of-day", () => {
  it("is the same word all IST day, a different one the next day, from the JSON", async () => {
    const a = await get("2026-11-23T18:31Z");
    const b = await get("2026-11-24T18:29Z");
    const c = await get("2026-11-24T18:31Z");
    expect(a.r.status).toBe(200);
    expect(a.r.headers.get("cache-control")).toBe("public, max-age=600");
    expect(a.j).toEqual(b.j);
    expect(a.j.date).toBe("2026-11-24");
    expect(c.j.date).toBe("2026-11-25");
    expect(c.j.paite).not.toBe(a.j.paite);
    expect(data.words.some(([p, e, t]) => p === a.j.paite && e === a.j.english && t === a.j.type)).toBe(true);
    for (const k of ["paite", "english", "type", "date"] as const) expect(a.j[k]).toBeTruthy();
  });
});

describe("word of the day front page", () => {
  it("index.html has #wotd after #feedback and before #whatsnew, and loads /wotd.js; sw lists it", () => {
    const at = (s: string) => { const i = html.indexOf(s); expect(i, s).toBeGreaterThan(-1); return i; };
    expect(at('id="feedback"')).toBeLessThan(at('id="wotd"'));
    expect(at('id="wotd"')).toBeLessThan(at('id="whatsnew"'));
    expect(html).toContain('<script src="/wotd.js" defer></script>');
    expect(sw).toContain('"/wotd.js"');
  });
  it("every getElementById in wotd.js exists in index.html", () => {
    const ids = [...js.matchAll(/getElementById\("([^"]+)"\)/g)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(html).toContain(`id="${id}"`);
  });
});
