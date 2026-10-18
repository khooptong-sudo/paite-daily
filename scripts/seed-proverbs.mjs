// Loads seed/proverbs.json into D1. Re-running is safe: the unique indexes on the
// Paite and English lines mean an entry already in the table is skipped, not doubled.
//
//   node scripts/seed-proverbs.mjs            # local database
//   node scripts/seed-proverbs.mjs --remote   # production
//
// Each entry: kind ('proverb' | 'idiom'), paite, english, explainer (Paite),
// explainer_en, entered_from ('pai2en' | 'en2pai').
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const q = (v) => (v === null || v === undefined || v === "" ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);
const remote = process.argv.includes("--remote");

const rows = JSON.parse(readFileSync(new URL("../seed/proverbs.json", import.meta.url), "utf8"));
if (!Array.isArray(rows)) throw new Error("seed/proverbs.json must be an array");

const sql = rows
  .map((r) => {
    if (!r.paite && !r.english) throw new Error(`entry with no line: ${JSON.stringify(r)}`);
    if (r.entered_from !== "pai2en" && r.entered_from !== "en2pai") throw new Error(`bad entered_from: ${JSON.stringify(r)}`);
    if (r.entered_from === "pai2en" && !r.explainer) throw new Error(`Paite proverb needs a Paite explainer: ${r.paite}`);
    return `INSERT OR IGNORE INTO proverbs (kind, paite, english, explainer, explainer_en, entered_from, status, source)
VALUES (${q(r.kind ?? "proverb")}, ${q(r.paite)}, ${q(r.english)}, ${q(r.explainer)}, ${q(r.explainer_en)}, ${q(r.entered_from)}, ${q(r.status ?? (r.paite ? "live" : "open"))}, 'seed');`;
  })
  .join("\n");

const dir = mkdtempSync(join(tmpdir(), "proverbs-"));
const file = join(dir, "seed.sql");
writeFileSync(file, sql + "\n");

const args = ["wrangler", "d1", "execute", "paite-daily", "--file", file, remote ? "--remote" : "--local"];
execFileSync("npx", args, { stdio: "inherit", shell: true, env: { ...process.env, CI: "true" } });
console.log(`seeded ${rows.length} entries into ${remote ? "production" : "the local database"}`);
