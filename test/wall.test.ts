import { describe, expect, it } from "vitest";
import { wallNames } from "../src/contributors";

// The Name Wall on Panlate: every contributor and reviewer, once each, A to Z.
const c = (name: string) => ({ name, sentences: 1, words: 0, sentencesWeek: 0, wordsWeek: 0, verified: 1, weekly: 0, badge: null, reviewer: false });
const r = (name: string) => ({ name, decisions: 1, weekly: 0 });

describe("wallNames", () => {
  it("lists contributors and reviewers once each, A to Z", () => {
    expect(wallNames({ contributors: [c("Thang Elim"), c("Ben Guite")], reviewers: [r("Ben Guite"), r("K Lianthansang")] }))
      .toEqual(["Ben Guite", "K Lianthansang", "Thang Elim"]);
  });

  it("tidies names typed all in capitals or all in lower case, and leaves mixed case alone", () => {
    expect(wallNames({ contributors: [c("RICHARD SUANLIAN"), c("lalbawi guite"), c("Esther J. Kimboi"), c("phualva")], reviewers: [] }))
      .toEqual(["Esther J. Kimboi", "Lalbawi Guite", "Phualva", "Richard Suanlian"]);
  });

  it("treats spacing and case differences as the same person", () => {
    expect(wallNames({ contributors: [c("Mang  Hangzo"), c("mang hangzo")], reviewers: [] })).toEqual(["Mang Hangzo"]);
  });
});
