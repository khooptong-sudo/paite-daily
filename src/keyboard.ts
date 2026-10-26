import { vocabulary } from "./spelling";
import type { Env } from "./types";

// Keyboard word lists: every Paite word from verified sentences and the word list, most
// used first, in the formats phone keyboards can load. Always current; caches hold them a day.

const GBOARD_MAX = 2000;

export async function wordCounts(env: Env, now: number): Promise<[string, number][]> {
  return [...(await vocabulary(env, now))].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

/** Plain list: word, tab, count. */
export const wordsTsv = (ws: [string, number][]) => "word\tcount\n" + ws.map(([w, n]) => `${w}\t${n}`).join("\n") + "\n";

/** AnySoftKeyboard language-pack source: frequency 1 to 255, most used highest. */
export function wordlistXml(ws: [string, number][]): string {
  const max = ws[0]?.[1] ?? 1;
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/'/g, "&apos;");
  return `<?xml version="1.0" encoding="utf-8"?>\n<wordlist>\n${ws.map(([w, n]) => `  <w f="${Math.max(1, Math.round((255 * Math.log1p(n)) / Math.log1p(max)))}">${esc(w)}</w>`).join("\n")}\n</wordlist>\n`;
}

/** Gboard personal dictionary import: a zip holding dictionary.txt (shortcut, word, language per line). */
export function gboardZip(ws: [string, number][]): Uint8Array {
  const text = "# Gboard Dictionary version:1\n" + ws.slice(0, GBOARD_MAX).map(([w]) => `\t${w}\t`).join("\n") + "\n";
  return storedZip("dictionary.txt", new TextEncoder().encode(text));
}

const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
export const crc32 = (b: Uint8Array) => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

/** A one-file zip with no compression: small enough here, and needs no library. */
export function storedZip(name: string, data: Uint8Array): Uint8Array {
  const n = new TextEncoder().encode(name), crc = crc32(data);
  const local = new DataView(new ArrayBuffer(30)), central = new DataView(new ArrayBuffer(46)), end = new DataView(new ArrayBuffer(22));
  local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(8, 0, true);
  local.setUint32(14, crc, true); local.setUint32(18, data.length, true); local.setUint32(22, data.length, true); local.setUint16(26, n.length, true);
  central.setUint32(0, 0x02014b50, true); central.setUint16(4, 20, true); central.setUint16(6, 20, true);
  central.setUint32(16, crc, true); central.setUint32(20, data.length, true); central.setUint32(24, data.length, true); central.setUint16(28, n.length, true);
  const cdOffset = 30 + n.length + data.length;
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, 1, true); end.setUint16(10, 1, true);
  end.setUint32(12, 46 + n.length, true); end.setUint32(16, cdOffset, true);
  const out = new Uint8Array(cdOffset + 46 + n.length + 22);
  let o = 0;
  for (const part of [new Uint8Array(local.buffer), n, data, new Uint8Array(central.buffer), n, new Uint8Array(end.buffer)]) { out.set(part, o); o += part.length; }
  return out;
}

const DAY = { "cache-control": "public, max-age=86400" };
/** GET /words.tsv, /paite-wordlist.xml, /paite-gboard.zip, or null for any other path. */
export async function keyboardFile(env: Env, pathname: string, now: number): Promise<Response | null> {
  if (pathname === "/words.tsv") return new Response(wordsTsv(await wordCounts(env, now)), { headers: { "content-type": "text/tab-separated-values; charset=utf-8", ...DAY } });
  if (pathname === "/paite-wordlist.xml") return new Response(wordlistXml(await wordCounts(env, now)), { headers: { "content-type": "application/xml; charset=utf-8", ...DAY } });
  if (pathname === "/paite-gboard.zip") return new Response(gboardZip(await wordCounts(env, now)), { headers: { "content-type": "application/zip", "content-disposition": 'attachment; filename="paite-gboard.zip"', ...DAY } });
  return null;
}
