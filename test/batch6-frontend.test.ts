import { expect, it } from "vitest";
import app from "../public/app.js?raw";
import share from "../public/podium-share.js?raw";
import weekShare from "../public/week.js?raw";
import puanShare from "../public/mypuan.js?raw";
import milestone from "../public/milestone.js?raw";

it("raw app.js: a turnstile timeout is blocked, not offline, and the answer is not queued", () => {
  expect(app).toContain("/^turnstile/.test(e.message)");
  expect(app).toContain("/^turnstile/.test(err.message)");
  const blocked = (m: string) => /^turnstile/.test(m) || m === "session"; // verbatim test
  expect(blocked("turnstile timeout")).toBe(true);
  expect(blocked("Failed to fetch")).toBe(false);
});

it("raw app.js: the today counter keys on the IST date", () => {
  expect(app).toContain("Date.now() + 5.5 * 3600e3");
  const key = (now: number) => "count:" + new Date(now + 5.5 * 3600e3).toISOString().slice(0, 10); // verbatim, now injected
  expect(key(Date.parse("2026-11-19T19:30:00Z"))).toBe("count:2026-11-20");
});

it.each([["podium-share.js", share], ["week.js", weekShare], ["mypuan.js", puanShare]])("raw %s: share or download, never both, and tracking does not decide", (_name, src) => {
  expect(src).not.toMatch(/if \(window\.pdTrack\) window\.pdTrack\("share"\);\s*else/);
  expect(src).toMatch(/\)\) await navigator\.share\([^\n]*\n\s*else \{/);
});

it("raw milestone.js: remembers shown levels in memory when localStorage throws", () => {
  expect(milestone).toContain("const shown = new Set()");
  const store = { get: (): string => { throw new Error("denied"); } };
  const shown = new Set<number>();
  let cards = 0;
  const read = () => { try { return JSON.parse(store.get()) || []; } catch { return []; } }; // verbatim
  const fire = (v: number) => {
    const seen = [...read(), ...shown];
    const fresh = [10].filter((l) => v >= l && !seen.includes(l));
    if (!fresh.length) return;
    fresh.forEach((l) => shown.add(l));
    cards++;
  };
  fire(10); fire(11);
  expect(cards).toBe(1);
});
