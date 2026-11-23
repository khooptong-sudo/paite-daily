import { expect, it } from "vitest";
import grammar from "../public/grammar.js?raw";

it("raw grammar.js: check buttons are quiet until their field is in use or holds text", () => {
  expect(grammar).toContain("const quietPill = (el, wrap)");
  expect(grammar).toContain("quietPill(el, w)");
  // blur waits so a tap on the button still lands
  expect(grammar).toContain('el.addEventListener("blur", () => setTimeout(() => settle(el, wrap), 200))');
  // only the button hides, never the result box
  expect(grammar).toContain("btn.hidden = !on;");
});

it("verbatim copy of the show rule: focus, text, focus inside the pill, or an open result keeps the button", () => {
  const on = (focusedField: boolean, focusInPill: boolean, value: string, outHidden: boolean) =>
    focusedField || focusInPill || value.trim() !== "" || !outHidden; // verbatim from settle()
  expect(on(false, false, "", true)).toBe(false);
  expect(on(true, false, "", true)).toBe(true);
  expect(on(false, false, "  ", true)).toBe(false);
  expect(on(false, false, "Ka kipak", true)).toBe(true);
  expect(on(false, true, "", true)).toBe(true);
  expect(on(false, false, "", false)).toBe(true);
});
