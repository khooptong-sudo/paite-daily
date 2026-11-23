// Builds src/word-of-day.json: the Word of the Day list for the front page, picked from the English–Paite
// dictionary in the open dataset (the "Paite English Dictionary" app, used with its author's permission).
//
//   node scripts/build-word-of-day.mjs [path-to-paite_corpus]   (default ../paite_corpus)
//
// A good daily word is one people meet often and whose Paite is short. Only English headwords that occur in the
// dataset's everyday sentences (community/) are kept, so the list grows as contributors add sentences: rerun this now
// and then. Ranking: everyday use weighted x10, plus the World English Bible text. Rare words, long Paite
// descriptions, function words and a short list of words unsuited to a family front page are left out.
// The order is shuffled once with a fixed seed so neighbouring days do not fall on neighbouring letters.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.argv[2] || join(process.cwd(), "..", "paite_corpus");
const dict = JSON.parse(readFileSync(join(root, "dictionary", "paite-english-dictionary.json"), "utf8")).dictionary;

const freq = new Map(), everyday = new Set();
const count = (text, w) => { for (const m of text.toLowerCase().matchAll(/[a-z]+/g)) { freq.set(m[0], (freq.get(m[0]) || 0) + w); if (w > 1) everyday.add(m[0]); } };
count(readFileSync(join(root, "bible", "world-english-bible", "eng-web_vpl.txt"), "utf8"), 1);
for (const f of readdirSync(join(root, "community")).filter((f) => f.endsWith(".jsonl")))
  for (const line of readFileSync(join(root, "community", f), "utf8").split("\n"))
    if (line.trim()) { try { count(JSON.parse(line).english || "", 10); } catch {} }

const KEEP = new Set(["noun", "verb", "adjective", "adverb"]);
// Function words, and words that would read badly as the one word shown to everyone today.
const SKIP = new Set(`the and but for nor not yet also very much more most such then than when where which while who whom whose
what this that these those there here thus hence some any each every both either neither other another same own just only
even still ever never always often again once twice make made do does did done have has had get got go went gone come came
be been being is are was were am shall should will would may might must can could let say said tell told thing things
kill killed murder slay slew rape whore harlot prostitute adultery adulterer fornication naked nakedness drunk drunkard
bastard ass hag witch dung genitals breast breasts womb circumcise circumcised foreskin eunuch concubine sodomite corpse
idol idols demon demons devil hell curse cursed sacrifice slaughter blood bloody`.split(/\s+/));

const seen = new Set();
const picks = [];
for (const e of dict) {
  const en = String(e.english || "").trim(), pai = String(e.paite || "").replace(/\s+/g, " ").trim(), type = String(e.type || "").trim().toLowerCase();
  const key = en.toLowerCase();
  if (!/^[A-Za-z]{3,12}$/.test(en) || !KEEP.has(type) || SKIP.has(key) || seen.has(key)) continue;
  // Short Paite only: at most two renderings, each at most three words, nothing in brackets.
  // ...and no grammar notes left over from the app ("n.-HOOD", "adj. -LESS"): no dots, no capitals-only tokens, no
  // token starting with a hyphen.
  if (!pai || pai.length > 32 || /[()[\]/;:.]/.test(pai) || /\b[A-Z]{2,}\b/.test(pai) || /(^|\s)-/.test(pai)) continue;
  const parts = pai.split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length > 2 || parts.some((p) => p.split(/\s+/).length > 3)) continue;
  const f = freq.get(key) || 0;
  if (f < 12 || !everyday.has(key)) continue;
  seen.add(key);
  picks.push({ paite: parts.join(", "), english: en.charAt(0).toUpperCase() + en.slice(1).toLowerCase(), type, f });
}
picks.sort((a, b) => b.f - a.f);
const top = picks.slice(0, 1000);

// Fixed-seed shuffle (mulberry32), so the list is stable between builds of the same data.
let s = 20261123;
const rnd = () => { s |= 0; s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
for (let i = top.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [top[i], top[j]] = [top[j], top[i]]; }

const out = {
  source: "English–Paite dictionary from the \"Paite English Dictionary\" Android app, used with the author's permission. Rights stay with the author.",
  words: top.map(({ paite, english, type }) => [paite, english, type]),
};
writeFileSync(join(process.cwd(), "src", "word-of-day.json"), JSON.stringify(out) + "\n");
console.log(`candidates ${picks.length}, kept ${top.length}`);
