import { finalPaite } from "./final";
import { publicReviewerNames } from "./access";
import { esc } from "./contributors";
import { FOOTER } from "./footer";
import { PUAN } from "./puan";
import { cap } from "./text";
import type { Env } from "./types";

const SYSTEM = `You extract a Paite (Zomi, ISO 639-3 pck) word list from a note a verified contributor wrote about their English-to-Paite translation.
Reply with JSON only: {"entries":[{"paite":"<Paite word or short phrase>","english":"<meaning>","note":"<optional usage note, or empty>"}]}
Only list Paite words or phrases that appear in the Paite sentence. Do not invent words. Return {"entries":[]} when the note explains no word.`;

const MAX_ENTRIES = 10, MAX_PER_RUN = 20;
const clip = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");

type Pending = { id: number; sentence_id: number; paite: string; english: string; explanation: string };

// Untrusted model output: validate shape, cap counts and lengths, drop words not in the answer text.
export function cleanEntries(out: any, paiteText: string): { paite: string; english: string; note: string }[] {
  const hay = paiteText.toLowerCase();
  const res: { paite: string; english: string; note: string }[] = [];
  for (const e of Array.isArray(out?.entries) ? out.entries.slice(0, MAX_ENTRIES) : []) {
    const paite = clip(e?.paite, 60), english = clip(e?.english, 120), note = clip(e?.note, 200);
    if (paite && english && hay.includes(paite.toLowerCase())) res.push({ paite: cap(paite), english: cap(english), note });
  }
  return res;
}

async function extract(env: Env, fetcher: typeof fetch, p: Pending): Promise<number> {
  await env.DB.prepare("UPDATE answers SET gloss_attempts = gloss_attempts + 1 WHERE id = ?1").bind(p.id).run();
  const res = await fetcher("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: { authorization: `Bearer ${env.DEEPSEEK_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: "deepseek-chat",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [{ role: "system", content: SYSTEM }, { role: "user", content: `English: ${p.english}\nPaite: ${p.paite}\nNote: ${p.explanation}` }],
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`DeepSeek ${res.status}`);
  let out: unknown;
  try { out = JSON.parse(((await res.json()) as any).choices[0].message.content); } catch (e) { throw e; }
  const entries = cleanEntries(out, p.paite);
  await env.DB.batch([
    ...entries.map((e) => env.DB.prepare("INSERT OR IGNORE INTO glossary (paite, english, note, answer_id, sentence_id) VALUES (?1, ?2, ?3, ?4, ?5)").bind(e.paite, e.english, e.note || null, p.id, p.sentence_id)),
    env.DB.prepare("UPDATE answers SET gloss_done = 1 WHERE id = ?1").bind(p.id),
  ]);
  return entries.length;
}

// Only en2pai notes explain Paite words. Returns null (no job row) when there is nothing to do.
export async function runGlossary(env: Env, fetcher: typeof fetch): Promise<{ entries: number; failed: number } | null> {
  if (!env.DEEPSEEK_API_KEY) return null;
  const { results } = await env.DB.prepare(
    `SELECT a.id, a.sentence_id, ${finalPaite("a")} AS paite, s.english, a.explanation FROM answers a JOIN sentences s ON s.id = a.sentence_id
     WHERE a.status IN ('accepted', 'also_correct') AND s.direction = 'en2pai' AND a.gloss_done = 0 AND a.gloss_attempts < 3
       AND TRIM(COALESCE(a.explanation, '')) <> '' ORDER BY a.gloss_attempts, a.id LIMIT ${MAX_PER_RUN}`,
  ).all<Pending>();
  if (!results.length) return null;
  let entries = 0, failed = 0;
  for (const p of results) {
    try { entries += await extract(env, fetcher, p); } catch (e) { console.error("glossary", String(e)); failed++; }
  }
  return { entries, failed };
}

export type Entry = { id: number; paite: string; english: string; note: string | null; source: string; by: string | null; reviewed_by: string | null; example: { paite: string; english: string } | null };

export async function getGlossary(env: Env, limit = -1): Promise<Entry[]> {
  const { results } = await env.DB.prepare(
    `SELECT g.id, g.paite, g.english, g.note, g.source, g.contributor_name AS by, g.reviewed_by, ${finalPaite("a")} AS ex_paite, s.english AS ex_english FROM glossary g
     LEFT JOIN answers a ON a.id = g.answer_id LEFT JOIN sentences s ON s.id = g.sentence_id WHERE g.hidden = 0 ORDER BY g.id DESC LIMIT ?1`,
  ).bind(limit).all<{ id: number; paite: string; english: string; note: string | null; source: string; by: string | null; reviewed_by: string | null; ex_paite: string | null; ex_english: string | null }>();
  // Public: the page, glossary.json and the corpus repo show the reviewer's name, never the email.
  const name = await publicReviewerNames(env);
  return results.map((r) => ({ id: r.id, paite: cap(r.paite), english: cap(r.english), note: r.note, source: r.source, by: r.by, reviewed_by: name(r.reviewed_by), example: r.ex_paite && r.ex_english ? { paite: r.ex_paite, english: r.ex_english } : null }));
}

export type ReviewEntry = Entry & { hidden: number; edited_by: string | null; edited_at: string | null };

/** The whole list for the reviewer page: hidden rows included, ordered by the word. */
export async function getGlossaryForReview(env: Env, limit = 500): Promise<ReviewEntry[]> {
  const { results } = await env.DB.prepare(
    `SELECT g.id, g.paite, g.english, g.note, g.hidden, g.source, g.contributor_name AS by, g.reviewed_by, g.edited_by, g.edited_at,
            ${finalPaite("a")} AS ex_paite, s.english AS ex_english
     FROM glossary g LEFT JOIN answers a ON a.id = g.answer_id LEFT JOIN sentences s ON s.id = g.sentence_id
     ORDER BY lower(g.paite) LIMIT ?1`,
  ).bind(limit).all<{ id: number; paite: string; english: string; note: string | null; hidden: number; source: string; by: string | null; reviewed_by: string | null; edited_by: string | null; edited_at: string | null; ex_paite: string | null; ex_english: string | null }>();
  return results.map((r) => ({
    id: r.id, paite: cap(r.paite), english: cap(r.english), note: r.note, source: r.source, by: r.by, reviewed_by: r.reviewed_by,
    hidden: r.hidden, edited_by: r.edited_by, edited_at: r.edited_at,
    example: r.ex_paite && r.ex_english ? { paite: r.ex_paite, english: r.ex_english } : null,
  }));
}

export const glossaryJson = (xs: Entry[]) =>
  JSON.stringify({ entries: [...xs].sort((a, b) => a.paite.localeCompare(b.paite)).map(({ id, by, ...e }) => e) }, null, 2) + "\n";

const JS = `(function(){var S=window.STRINGS||{};
document.querySelectorAll("[data-s]").forEach(function(e){var s=S[e.dataset.s];if(s&&s.pai)e.innerHTML=s.pai+"<small> "+s.en+"</small>";});
var q=document.getElementById("q"),sr=S.search;if(sr&&sr.pai){q.placeholder=q.ariaLabel=sr.pai+" / "+sr.en;q.setAttribute("aria-label",q.placeholder)}q.addEventListener("input",function(){var t=q.value.trim().toLowerCase();
document.querySelectorAll(".gl li").forEach(function(li){li.hidden=!!t&&li.dataset.q.indexOf(t)<0});
document.querySelectorAll(".gl details.rows").forEach(function(g){var has=!!g.querySelector("li:not([hidden])");
g.hidden=!has;g.open=t?has:true})});
function openHash(){var l=document.getElementById(location.hash.slice(1));if(!l)return;var d=l.querySelector("details");if(d)d.open=true;
var g=l.closest("details.rows");if(g)g.open=true;l.scrollIntoView()}
openHash();addEventListener("hashchange",openHash);
})();`;

export function renderGlossary(xs: Entry[]): string {
  const groups = new Map<string, Entry[]>();
  for (const e of [...xs].sort((a, b) => a.paite.localeCompare(b.paite))) {
    const l = e.paite.charAt(0).toUpperCase();
    const k = /\p{L}/u.test(l) ? l : "#";
    groups.set(k, [...(groups.get(k) ?? []), e]);
  }
  const li = (e: Entry) => `<li id="w-${e.id}" data-q="${esc([e.paite, e.english, e.note, e.example?.paite, e.example?.english].filter(Boolean).join(" ").toLowerCase())}"><details><summary><b class="w">${esc(e.paite)}</b> <small class="m">${esc(e.english)}</small></summary><p class="m">${esc(e.english)}</p>${e.note ? `<span class="n">${esc(e.note)}</span>` : ""}${e.example ? `<span class="ex">${esc(e.example.paite)}<br>${esc(e.example.english)}</span>` : ""}${e.by || e.reviewed_by ? `<span class="n">${[e.by ? `Added by ${esc(e.by)}` : "", e.reviewed_by ? `Reviewed by ${esc(e.reviewed_by)}` : ""].filter(Boolean).join(" · ")}</span>` : `<span class="n" data-s="${e.source === "contributed" ? "srcContributed" : "srcNote"}">${e.source === "contributed" ? "Added by a contributor" : "From a contributor's note"}</span>`}</details></li>`;
  // A to Z rail: one link per letter group, sticky above the list.
  const rail = groups.size > 1 ? `<nav class="az" aria-label="Letters">${[...groups.keys()].map((k) => `<a href="#l-${esc(k)}">${esc(k)}</a>`).join("")}</nav>` : "";
  const body = groups.size
    ? [...groups].map(([k, es]) => `<details class="rows" open id="l-${esc(k)}" aria-label="${esc(k)}" data-letter="${esc(k)}"><summary><span class="ltr">${esc(k)}</span><span class="cnt">${es.length}</span></summary><ul>${es.map(li).join("")}</ul></details>`).join("")
    : '<p class="empty"><span data-s="glossaryEmpty">No words yet. Add the first one on the front page.</span> <a href="/">Paite Daily</a></p>';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Paite Word List</title>
<meta name="theme-color" content="#ffffff">
<link rel="canonical" href="https://paite.lamkalabs.com/glossary">
<meta property="og:site_name" content="Paite Daily">
<meta property="og:type" content="website">
<meta property="og:locale" content="en_IN">
<meta property="og:url" content="https://paite.lamkalabs.com/glossary">
<meta property="og:title" content="Paite Word List">
<meta property="og:description" content="The Paite Word List from our contributors: Paite words, English meanings and examples.">
<meta property="og:image" content="https://paite.lamkalabs.com/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="Paite Daily: a Paite–English corpus, verified by native speakers.">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="Paite Word List">
<meta name="twitter:description" content="The Paite word list from our contributors: Paite words, English meanings and examples.">
<meta name="twitter:image" content="https://paite.lamkalabs.com/og.png">
<meta name="twitter:image:alt" content="Paite Daily: a Paite–English corpus, verified by native speakers.">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
<link rel="icon" href="/favicon.ico" sizes="32x32">
<link rel="icon" href="/icons/emblem-small.svg" type="image/svg+xml">
<link rel="icon" href="/icons/icon-192.png" sizes="192x192">
<script>document.documentElement.className="js"</script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Young+Serif&family=Inter:wght@400;500;600;700&display=swap">
<link rel="stylesheet" href="/style.css">
<script src="/theme.js"></script>
<link rel="stylesheet" href="/contributors.css">
</head>
<body class="cp blue">
<header class="hero"><div class="hero-nav"><a class="back" href="/" data-back><span aria-hidden="true">&larr;</span> Back</a><a class="back" href="/review">Reviewer <span aria-hidden="true">&rarr;</span></a></div>${PUAN}<h1 data-s="glossaryTitle">Paite Word List</h1><p data-s="glossaryLine">Words from the notes of our contributors.</p></header>
<main class="gl">
<input id="q" type="search" placeholder="Search" aria-label="Search">
${rail}${body}
<a class="cta" href="/"><span>Paite Daily<small data-s="addSentence">Add a Sentence</small></span><span class="go" aria-hidden="true">&rarr;</span></a>
<a class="pan" href="/paite-daily.apk" download>
<span><b data-s="getApp">Get the Android app</b><small data-s="getAppNote">Download the APK file.</small></span>
<span class="go" aria-hidden="true">&darr;</span>
</a>
<button type="button" class="pan" id="install-app" hidden>
<span><b data-s="installApp">Install on this device</b><small data-s="installAppNote">Add Paite Daily to your home screen. No download.</small></span>
<span class="go" aria-hidden="true">&darr;</span>
</button>
<p class="licence">Paite words for your phone keyboard, most used first, from verified sentences: <a href="/paite-gboard.zip" download>Gboard</a> (Settings, Dictionary, Personal dictionary, Import), <a href="/paite-wordlist.xml" download>AnySoftKeyboard</a>, or a <a href="/words.tsv" download>plain list</a>.</p>
${FOOTER}
</main>
<script src="/strings.js"></script>
<script src="/back.js"></script>
<script src="/pwa.js"></script>
<script src="/track.js"></script>
<script>${JS}</script>
</body></html>`;
}
