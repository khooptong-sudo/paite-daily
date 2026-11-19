import { describe, expect, it } from "vitest";
import "./helpers";
import { buildLexicon, checkAnswer } from "../src/kbask";
import { checkBlocks } from "../src/kbarticle";

const lex = buildLexicon([{ paite: "lungdam", english: "thanks" }], []);
const passages = new Map([[1, "kei lungdam hi"]]);
const ans = (text: string) => ({ status: "answer", parts: [{ type: "text", text }, { type: "quote", chunk: 1, text: "kei" }], sources: [1] });

describe("Paite-only word check", () => {
  it("control: plain Paite word in English text is rejected", () => {
    const r = checkAnswer(ans("The word is lungdam."), passages, "q", lex);
    expect(r.ok).toBe(false);
  });
  it("same word split by a zero-width space must also be rejected", () => {
    expect(checkAnswer(ans("The word is lu\u200Bngdam."), passages, "q", lex).ok).toBe(false);
  });
  it("same word split by a hyphen must also be rejected (article blocks)", () => {
    const r = checkBlocks([{ type: "text", text: "It is lu-ngdam.", cites: [1] }, { type: "quote", chunk: 1, text: "kei" }], passages, "T", lex);
    expect(r.ok).toBe(false);
  });
});
