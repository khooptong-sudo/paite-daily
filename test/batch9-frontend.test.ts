import { expect, it } from "vitest";
import app from "../public/app.js?raw";
import grammar from "../public/grammar.js?raw";
import chat from "../public/chat.js?raw";
import { renderGlossary } from "../src/glossary";

// grammar.js is deferred and runs before app.js, so paiteApi is not set yet when init() first runs.
it("raw grammar.js: init runs again after app.js has set paiteApi (DOMContentLoaded always listened)", () => {
  expect(app).toContain("window.paiteApi = api;");
  expect(grammar).not.toMatch(/if \(document\.readyState === "loading"\) document\.addEventListener\("DOMContentLoaded", init\); else init\(\);/);
  expect(grammar).toMatch(/addEventListener\("DOMContentLoaded", init\)/);
  expect(grammar).toMatch(/\binit\(\);/);
});

it("rendered glossary: a malformed hash is ignored instead of throwing (head of fromHash run verbatim)", () => {
  const html = renderGlossary([{ id: 1, paite: "a", english: "b", note: null, source: "x", by: null, reviewed_by: null, example: null }]);
  const s = html.indexOf("function fromHash(){");
  const e = html.indexOf("if(m=", s);
  const head = html.slice(s + "function fromHash(){".length, e);
  const run = (hash: string) => new Function("location", head + "return h;")({ hash });
  expect(run("#%E0%A4%A")).toBe("");
  expect(run("#l-a")).toBe("l-a");
});

it("raw app.js: a 409 says why, a 400 is not 'check your internet'", () => {
  expect(app).toContain("Someone just finished this sentence. Here is the next one.");
  expect(app).toMatch(/r\.status === 400/);
});

it("raw chat.js: an older response never overwrites a newer one (request counter)", () => {
  expect(chat).toMatch(/const mine = \+\+seq/);
  expect(chat.match(/mine !== seq/g)?.length).toBeGreaterThanOrEqual(3);
});

it("raw app.js: outbox moves past a 500 and a full outbox tells the person", () => {
  expect(app).not.toMatch(/\.slice\(-50\)/);
  expect(app).toContain("Too many answers are waiting on this phone");
  expect(app).toMatch(/r\.status >= 500/);
});
