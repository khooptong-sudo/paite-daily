import { expect, it } from "vitest";
import html from "../public/index.html?raw";
import app from "../public/app.js?raw";

it("raw index.html: the welcome line sits right under the header, hidden until app.js shows it", () => {
  const w = html.indexOf('id="welcome"');
  expect(w).toBeGreaterThan(html.indexOf("</header>"));
  expect(w).toBeLessThan(html.indexOf('id="goal"'));
  expect(html).toContain('<p class="welcome" id="welcome" hidden>');
  expect(html).toContain("Paite Daily collects everyday Paite, written by speakers and checked by a second speaker. Translate one sentence to start.");
  expect(html.match(/id="welcome-x"/g)?.length).toBe(1);
});

it("raw app.js: shown only until closed or until a first answer is sent, stored through the try/catch store", () => {
  expect(app).toContain('if (!store.get("welcomed", 0)) $("welcome").hidden = false;');
  expect(app).toContain('$("welcome-x").addEventListener("click", welcomed);');
  const ok = app.indexOf('if (window.pdTrack) window.pdTrack("answer");');
  expect(app.indexOf("welcomed();", ok)).toBeGreaterThan(ok);
});
