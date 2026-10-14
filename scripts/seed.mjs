// Usage: node scripts/seed.mjs ../paite_corpus/prompts/everyday_en.txt > seed.sql
import { readFileSync } from "node:fs";

const norm = (s) => s.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase(); // same rule as src/text.ts normaliseEnglish
const q = (s) => `'${s.replace(/'/g, "''")}'`;
const lines = readFileSync(process.argv[2], "utf8").split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
for (const l of lines) console.log(`INSERT OR IGNORE INTO sentences (english, english_key, source) VALUES (${q(l)}, ${q(norm(l))}, 'prompts');`);
