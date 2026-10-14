// Usage: node scripts/seed.mjs ../paite_corpus/prompts/everyday_en.txt seed.sql
import { readFileSync, writeFileSync } from "node:fs";

const norm = (s) => s.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase(); // same rule as src/text.ts normaliseEnglish
const q = (s) => `'${s.replace(/'/g, "''")}'`;
const lines = readFileSync(process.argv[2], "utf8").split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
const sql = lines.map((l) => `INSERT OR IGNORE INTO sentences (english, english_key, source) VALUES (${q(l)}, ${q(norm(l))}, 'prompts');`).join("\n") + "\n";
writeFileSync(process.argv[3], sql, "utf8"); // utf8 file, so PowerShell 5.1 redirection (UTF-16) is never involved
