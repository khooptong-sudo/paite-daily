import { esc } from "./contributors";
import { FOOTER } from "./footer";
import { PUAN } from "./puan";
import { distance } from "./spelling";
import { json, type Env } from "./types";

// The self-writing spelling rulebook. Every time a reviewer accepts a sentence with a
// correction, the words they changed become a rule: "dam" was written, "dam" became "daam".
// Nothing is stored twice: the rules are read back from the reviews themselves, so an
// undone review drops out of the book on its own.

export type Rule = { from: string; to: string; count: number; before: string; after: string };

const TTL = 10 * 60_000;
const words = (t: string) => (t.toLowerCase().normalize("NFC").match(/\p{L}[\p{L}'’]*/gu) ?? []).map((w) => w.replace(/’/g, "'"));

/** The single-word swaps between what was written and what the reviewer kept, found by aligning the two lines word by word. */
export function swaps(written: string, kept: string): [string, string][] {
  const a = words(written), b = words(kept);
  const L: number[][] = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out: [string, string][] = [];
  let i = 0, j = 0, gapA: string[] = [], gapB: string[] = [];
  // A run of changed words on both sides with the same length pairs off one to one, and a
  // pair counts only when the two words still look alike (at most half the longer word
  // changed). An uneven run, or a pair of different words, is a rewrite, not a spelling.
  const alike = (x: string, y: string) => { const max = Math.floor(Math.max(x.length, y.length) / 2); return distance(x, y, max) <= max; };
  const flush = () => { if (gapA.length && gapA.length === gapB.length) gapA.forEach((w, k) => { if (alike(w, gapB[k])) out.push([w, gapB[k]]); }); gapA = []; gapB = []; };
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) { flush(); i++; j++; }
    else if (j < b.length && (i === a.length || L[i][j + 1] >= L[i + 1][j])) gapB.push(b[j++]);
    else gapA.push(a[i++]);
  }
  flush();
  return out;
}

let cache: { at: number; rules: Rule[] } | null = null;
export const clearRulesCache = () => { cache = null; };

/** Every rule, most often applied first. Only Paite answers count: a Paite-to-English sentence's answer is English. */
export async function getRules(env: Env, now: number): Promise<Rule[]> {
  if (cache && now - cache.at < TTL) return cache.rules;
  const { results } = await env.DB.prepare(
    `SELECT a.paite AS written, r.final_paite AS kept FROM reviews r
     JOIN answers a ON a.id = r.accepted_answer_id JOIN sentences s ON s.id = r.sentence_id
     WHERE r.decision = 'accept' AND r.undone_at IS NULL AND r.final_paite IS NOT NULL AND s.direction = 'en2pai'
     ORDER BY r.id`,
  ).all<{ written: string; kept: string }>();
  const by = new Map<string, Rule>();
  for (const { written, kept } of results) {
    for (const [from, to] of swaps(written, kept)) {
      const k = `${from}\u0000${to}`, r = by.get(k);
      if (r) r.count++; else by.set(k, { from, to, count: 1, before: written, after: kept });
    }
  }
  const rules = [...by.values()].sort((x, y) => y.count - x.count || x.from.localeCompare(y.from));
  cache = { at: now, rules };
  return rules;
}

export const rulesJson = (rules: Rule[]) => json({ rules });

export function renderRules(rules: Rule[]): string {
  const row = (r: Rule) => `<li><p class="rule"><s>${esc(r.from)}</s> <span aria-hidden="true">&rarr;</span><span class="sr"> becomes </span> <b>${esc(r.to)}</b> <small class="cnt">${r.count === 1 ? "once" : `${r.count} times`}</small></p><p class="ex"><span>${esc(r.before)}</span><span>${esc(r.after)}</span></p></li>`;
  const body = rules.length
    ? `<ol class="rules">${rules.map(row).join("")}</ol>`
    : '<p class="empty">No rules yet. They appear here as reviewers correct spellings.</p>';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Spelling Danbu · Paite Spelling Rulebook</title>
<meta name="description" content="How Paite reviewers correct spelling, written down as they work: each change a reviewer made, how often, and the line it came from.">
<link rel="canonical" href="https://paite.lamkalabs.com/rules">
<meta property="og:title" content="Spelling Danbu · Paite Spelling Rulebook">
<meta property="og:description" content="How Paite reviewers correct spelling, written down as they work.">
<meta property="og:image" content="https://paite.lamkalabs.com/og.png">
<link rel="icon" href="/favicon.ico" sizes="32x32">
<link rel="icon" href="/icons/emblem-small.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Young+Serif&family=Inter:wght@400;500;600;700&display=swap">
<link rel="stylesheet" href="/style.css">
<script src="/theme.js"></script>
<link rel="stylesheet" href="/contributors.css">
<style>
.rules{list-style:none;margin:0;padding:0;display:grid;gap:14px}
.rules li{display:grid;gap:6px;padding-top:14px;border-top:1px solid var(--line)}
.rules li:first-child{border-top:0;padding-top:0}
.rule{margin:0;font:400 1.3rem/1.3 var(--display)}
.rule s{color:var(--muted);text-decoration-thickness:2px}
.rule .cnt{display:inline;margin-left:6px;font:600 .8rem var(--body);color:var(--muted)}
.ex{margin:0;display:grid;gap:2px;font-size:.9rem;color:var(--muted)}
.ex span{display:block}
.ex span:last-child{color:var(--fg)}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}
</style>
</head>
<body class="cp blue">
<header class="hero"><div class="hero-nav"><a class="back" href="/" data-back><span aria-hidden="true">&larr;</span> Back</a><a class="back" href="/glossary">Word list <span aria-hidden="true">&rarr;</span></a></div>${PUAN}<h1>Spelling Danbu<small>Spelling Rulebook</small></h1><p>Every spelling a reviewer corrected, most common first. It writes itself as they work.</p></header>
<main class="gl">
${body}
<p class="licence">Each rule comes from a verified sentence: the line as written, then as the reviewer kept it. Download as <a href="/rules.json">JSON</a>.</p>
${FOOTER}
</main>
<script src="/back.js"></script>
<script src="/track.js"></script>
</body>
</html>`;
}
