// Loads every seed/*.json file into D1. Re-running is safe: the unique indexes on
// the Paite and English lines mean an entry already in the table is skipped, not doubled.
//
//   node scripts/seed-proverbs.mjs            # local database
//   node scripts/seed-proverbs.mjs --remote   # production
//
// Each entry: kind ('proverb' | 'idiom'), paite, english, explainer (Paite),
// explainer_en, entered_from ('pai2en' | 'en2pai'), status. Direction and status
// are inferred when missing: a Paite line alone is a live Paite proverb, an
// English line alone is an English saying waiting for its Paite version.
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const q = (v) => (v === null || v === undefined || v === "" ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);
const remote = process.argv.includes("--remote");

const seedDir = new URL("../seed/", import.meta.url);
const files = readdirSync(seedDir).filter((f) => f.endsWith(".json")).sort();
const rows = files.flatMap((f) => {
  const parsed = JSON.parse(readFileSync(new URL(f, seedDir), "utf8"));
  if (!Array.isArray(parsed)) throw new Error(`seed/${f} must be an array`);
  return parsed;
});

const seen = new Set();
const sql = rows
  .map((r) => {
    if (!r.paite && !r.english) throw new Error(`entry with no line: ${JSON.stringify(r)}`);
    const direction = r.entered_from ?? (r.paite ? "pai2en" : "en2pai");
    if (direction !== "pai2en" && direction !== "en2pai") throw new Error(`bad entered_from: ${JSON.stringify(r)}`);
    if (direction === "pai2en" && !r.explainer) throw new Error(`Paite saying needs a Paite explainer: ${r.paite}`);
    const key = (r.paite ?? r.english).toLowerCase();
    if (seen.has(key)) throw new Error(`duplicate in the seed files: ${key}`);
    seen.add(key);
    return `INSERT OR IGNORE INTO proverbs (kind, paite, english, explainer, explainer_en, entered_from, status, source)
VALUES (${q(r.kind ?? "proverb")}, ${q(r.paite)}, ${q(r.english)}, ${q(r.explainer)}, ${q(r.explainer_en)}, ${q(direction)}, ${q(r.status ?? (r.paite ? "live" : "open"))}, 'seed');`;
  })
  .join("\n");

const dir = mkdtempSync(join(tmpdir(), "proverbs-"));
const file = join(dir, "seed.sql");
writeFileSync(file, sql + "\n");

const args = ["wrangler", "d1", "execute", "paite-daily", "--file", file, remote ? "--remote" : "--local"];
execFileSync("npx", args, { stdio: "inherit", shell: true, env: { ...process.env, CI: "true" } });
console.log(`seeded ${rows.length} entries from ${files.length} files into ${remote ? "production" : "the local database"}`);
