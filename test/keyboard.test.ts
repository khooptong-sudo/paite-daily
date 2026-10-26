import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { crc32, gboardZip, wordCounts, wordlistXml, wordsTsv } from "../src/keyboard";
import { addSentences, call, NOW, PHONE_A } from "./helpers";

async function verified(paite: string, direction = "en2pai") {
  const [s] = await addSentences(`Sentence ${Math.random()}`);
  if (direction !== "en2pai") await env.DB.prepare("UPDATE sentences SET direction = ?1, paite_prompt = 'x' WHERE id = ?2").bind(direction, s).run();
  const a = await env.DB.prepare("INSERT INTO answers (sentence_id, paite, register, phone_id, status) VALUES (?1, ?2, 'both', ?3, 'accepted') RETURNING id").bind(s, paite, PHONE_A).first<{ id: number }>();
  await env.DB.prepare("INSERT INTO reviews (sentence_id, reviewer_email, decision, accepted_answer_id, final_paite) VALUES (?1, 'r@x.org', 'accept', ?2, ?3)").bind(s, a!.id, paite).run();
}

describe("Keyboard word lists", () => {
  it("counts Paite words most used first, and leaves out English answers", async () => {
    await verified("Ka pai ding hi");
    await verified("Ka pai nawn");
    await verified("I am going home", "pai2en");
    const ws = await wordCounts(env, NOW);
    expect(ws.slice(0, 2)).toEqual([["ka", 2], ["pai", 2]]);
    expect(ws.map(([w]) => w)).not.toContain("going");
    expect(wordsTsv(ws).split("\n")[1]).toBe("ka\t2");
    expect(wordlistXml(ws)).toContain('<w f="255">ka</w>');
  });

  it("builds a zip Gboard can open: one stored dictionary.txt", () => {
    const zip = gboardZip([["ka", 2], ["pai", 1]]);
    const v = new DataView(zip.buffer);
    expect(v.getUint32(0, true)).toBe(0x04034b50);
    const nameLen = v.getUint16(26, true), size = v.getUint32(18, true);
    expect(new TextDecoder().decode(zip.slice(30, 30 + nameLen))).toBe("dictionary.txt");
    const data = zip.slice(30 + nameLen, 30 + nameLen + size);
    expect(new TextDecoder().decode(data)).toBe("# Gboard Dictionary version:1\n\tka\t\n\tpai\t\n");
    expect(v.getUint32(14, true)).toBe(crc32(data));
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
    expect(v.getUint32(zip.length - 22, true)).toBe(0x06054b50);
  });

  it("serves the three files", async () => {
    await verified("Ka pai");
    for (const p of ["/words.tsv", "/paite-wordlist.xml", "/paite-gboard.zip"]) expect((await call(p)).status).toBe(200);
  });
});
