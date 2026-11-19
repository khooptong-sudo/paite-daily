import { aiConfig, askJSON } from "./ai";
import { finalPaite } from "./final";
import { publicReviewerNames } from "./access";
import { esc } from "./contributors";
import { FOOTER } from "./footer";
import { paiteWords } from "./spelling";
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
  const out: unknown = await askJSON(env, fetcher, { system: SYSTEM, user: `English: ${p.english}\nPaite: ${p.paite}\nNote: ${p.explanation}`, timeoutMs: 20_000, exact: true });
  const entries = cleanEntries(out, p.paite);
  await env.DB.batch([
    ...entries.map((e) => env.DB.prepare("INSERT OR IGNORE INTO glossary (paite, english, note, answer_id, sentence_id) VALUES (?1, ?2, ?3, ?4, ?5)").bind(e.paite, e.english, e.note || null, p.id, p.sentence_id)),
    env.DB.prepare("UPDATE answers SET gloss_done = 1 WHERE id = ?1").bind(p.id),
  ]);
  return entries.length;
}

// Only en2pai notes explain Paite words. Returns null (no job row) when there is nothing to do.
export async function runGlossary(env: Env, fetcher: typeof fetch): Promise<{ entries: number; failed: number } | null> {
  if (!(await aiConfig(env))) return null;
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

export type Extras = { same: Map<string, string[]>; opposite: Map<string, string[]>; seen: Map<string, { paite: string; english: string }[]> };

/** SQL for word_links l: true when a side is a headword whose glossary rows are all hidden (a word not in the glossary at all is fine). */
export const LINK_HIDDEN = `EXISTS (SELECT 1 FROM glossary g WHERE g.hidden = 1 AND lower(g.paite) IN (lower(l.paite), lower(l.other))
  AND NOT EXISTS (SELECT 1 FROM glossary v WHERE v.hidden = 0 AND lower(v.paite) = lower(g.paite)))`;

export const hkey = (w: string) => w.trim().normalize("NFC").toLowerCase();

/** Lower-cased headword -> id of its first entry, in word order: where a word links to on the list. */
export function headwordIds(xs: Entry[]): Map<string, number> {
  const ids = new Map<string, number>();
  for (const e of [...xs].sort((a, b) => a.paite.localeCompare(b.paite))) if (!ids.has(hkey(e.paite))) ids.set(hkey(e.paite), e.id);
  return ids;
}

/** Same Meaning, Opposite and Seen in Use for the word list, all from the list, approved links and verified sentences. Keys are lower-cased headwords. */
// The verified lines behind Seen in Use: the page is public and uncached, so the
// read is kept for ten minutes per worker, like the spelling vocabulary.
let lines: { at: number; rows: { paite: string; english: string }[] } | null = null;
export const clearWordExtrasCache = () => { lines = null; };
async function verifiedLines(env: Env, now: number): Promise<{ paite: string; english: string }[]> {
  if (lines && now - lines.at < 10 * 60_000) return lines.rows;
  const { results } = await env.DB.prepare(
    `SELECT ${finalPaite("a")} AS paite, s.english FROM answers a JOIN sentences s ON s.id = a.sentence_id
     WHERE a.status IN ('accepted', 'also_correct') AND s.direction = 'en2pai' ORDER BY a.id DESC LIMIT 5000`,
  ).all<{ paite: string; english: string }>();
  lines = { at: now, rows: results };
  return results;
}

export async function getWordExtras(env: Env, xs: Entry[], now = Date.now()): Promise<Extras> {
  const heads = new Map<string, { w: string; es: Entry[] }>();
  for (const e of xs) { const k = hkey(e.paite); const h = heads.get(k); if (h) h.es.push(e); else heads.set(k, { w: e.paite.trim().normalize("NFC"), es: [e] }); }
  // key -> (lower word -> first spelling seen)
  const rel = { same: new Map<string, Map<string, string>>(), opposite: new Map<string, Map<string, string>>() };
  const link = (m: Map<string, Map<string, string>>, a: string, b: string) => {
    const ka = hkey(a), kb = hkey(b);
    if (ka === kb) return;
    const g = m.get(ka) ?? new Map<string, string>();
    if (!g.has(kb)) g.set(kb, heads.get(kb)?.w ?? b.trim().normalize("NFC"));
    m.set(ka, g);
  };
  const byMeaning = new Map<string, string[]>();
  for (const { w, es } of heads.values()) for (const e of es) { const k = e.english.trim().toLowerCase(); byMeaning.set(k, [...(byMeaning.get(k) ?? []), w]); }
  for (const ws of byMeaning.values()) for (const a of ws) for (const b of ws) link(rel.same, a, b);
  const { results: links } = await env.DB.prepare(`SELECT paite, other, kind FROM word_links l WHERE status = 'approved' AND NOT ${LINK_HIDDEN} ORDER BY id`).all<{ paite: string; other: string; kind: "same" | "opposite" }>();
  for (const l of links) { link(rel[l.kind], l.paite, l.other); link(rel[l.kind], l.other, l.paite); }
  const done = (m: Map<string, Map<string, string>>) => new Map([...m].map(([k, g]) => [k, [...g.values()].sort((a, b) => a.localeCompare(b)).slice(0, 8)] as [string, string[]]));

  // Seen in use: one pass over the verified lines; a headword matches when its words appear in a row.
  const first = new Map<string, { k: string; t: string[] }[]>();
  const used = new Map<string, Set<string>>();
  for (const [k, { w, es }] of heads) {
    const t = paiteWords(w);
    if (!t.length) continue;
    first.set(t[0], [...(first.get(t[0]) ?? []), { k, t }]);
    used.set(k, new Set(es.flatMap((e) => (e.example ? [e.example.paite.trim().toLowerCase()] : []))));
  }
  const seen = new Map<string, { paite: string; english: string }[]>();
  if (first.size) {
    for (const r of await verifiedLines(env, now)) {
      const line = r.paite.trim().toLowerCase(), tok = paiteWords(r.paite);
      for (let i = 0; i < tok.length; i++) for (const { k, t } of first.get(tok[i]) ?? []) {
        const got = seen.get(k) ?? [], u = used.get(k)!;
        if (got.length >= 2 || u.has(line) || !t.every((x, j) => tok[i + j] === x)) continue;
        u.add(line);
        seen.set(k, [...got, { paite: r.paite.trim(), english: r.english }]);
      }
    }
  }
  return { same: done(rel.same), opposite: done(rel.opposite), seen };
}

export const glossaryJson = (xs: Entry[]) =>
  JSON.stringify({ entries: [...xs].sort((a, b) => a.paite.localeCompare(b.paite)).map(({ id, by, ...e }) => e) }, null, 2) + "\n";

const JS = `(function(){var S=window.STRINGS||{},PAGE=50;
document.querySelectorAll("[data-s]").forEach(function(e){var s=S[e.dataset.s];if(s&&s.pai)e.innerHTML=s.pai+"<small> "+s.en+"</small>";});
var q=document.getElementById("q"),sr=S.search;if(sr&&sr.pai){q.placeholder=sr.pai+" / "+sr.en;q.setAttribute("aria-label",q.placeholder)}
var main=document.querySelector("main.gl"),groups=[].slice.call(document.querySelectorAll("details.rows")),rail=[].slice.call(document.querySelectorAll(".az a"));
if(!groups.length)return;
main.classList.add("one");
var none=document.createElement("p");none.className="empty none";none.hidden=true;q.insertAdjacentElement("afterend",none);
var norm=function(s){return s.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase()};
var key=function(l){return l==="#"?"other":l.toLowerCase()};
groups.forEach(function(g){g.lim=PAGE;g.items=[].slice.call(g.querySelectorAll(":scope > ul > li"));g.items.forEach(function(li){li.n=norm(li.dataset.q)});
g.cnt=g.querySelector(".cnt");g.cnt0=g.cnt.textContent;g.querySelector("summary").addEventListener("click",function(e){e.preventDefault()});
g.more=document.createElement("button");g.more.type="button";g.more.className="showmore";g.more.hidden=true;g.appendChild(g.more);
g.more.addEventListener("click",function(){g.lim+=PAGE;render()})});
var byL={};groups.forEach(function(g){byL[g.dataset.letter]=g});
var cur=byL.A?"A":groups[0].dataset.letter;
function render(){var t=norm(q.value.trim()),any=false;
groups.forEach(function(g){var hits=g.items.filter(function(li){return !t||li.n.indexOf(t)>=0}),L=g.dataset.letter,on=t?hits.length>0:L===cur;
g.hidden=!on;g.open=true;if(on)any=true;g.cnt.textContent=t?hits.length+(hits.length===1?" word":" words"):g.cnt0;
g.items.forEach(function(li){li.hidden=hits.indexOf(li)<0||hits.indexOf(li)>=g.lim});
var left=hits.length-g.lim;g.more.hidden=!on||left<=0;if(left>0)g.more.textContent="Show "+Math.min(PAGE,left)+" more \u00b7 "+left+" left";
g.dim=t&&!hits.length});
rail.forEach(function(a){var L=a.textContent,g=byL[L];a.classList.toggle("dim",!!g.dim);if(g.dim)a.setAttribute("aria-disabled","true");else a.removeAttribute("aria-disabled");
if(!t&&L===cur)a.setAttribute("aria-current","true");else a.removeAttribute("aria-current")});
none.hidden=any;none.textContent=any?"":"No words match \u201c"+q.value.trim()+"\u201d"}
q.addEventListener("input",render);
rail.forEach(function(a){a.addEventListener("click",function(e){e.preventDefault();var L=a.textContent,g=byL[L];if(g.dim)return;
if(q.value.trim()){g.scrollIntoView();return}
if(L===cur)return;location.hash=key(L)})});
function fromHash(){var h=decodeURIComponent(location.hash.slice(1)),el=null,m;
if(m=/^w-[0-9]+$/.test(h)&&document.getElementById(h)){el=m;var g=el.closest("details.rows"),li=el.closest("ul > li");cur=g.dataset.letter;q.value="";
while(g.items.indexOf(li)>=g.lim)g.lim+=PAGE}
else{var l=h.replace(/^l-/,"");for(var L in byL)if(key(L)===l.toLowerCase()||L===l){cur=L;q.value=""}}
render();if(el)el.scrollIntoView()}
fromHash();addEventListener("hashchange",fromHash);
})();`;

export function renderGlossary(xs: Entry[], extras?: Extras): string {
  // One entry per headword: same spelling after trim + NFC (case kept), its meanings in list order.
  const words = new Map<string, Entry[]>();
  for (const e of [...xs].sort((a, b) => a.paite.localeCompare(b.paite))) {
    const w = e.paite.trim().normalize("NFC");
    words.set(w, [...(words.get(w) ?? []), e]);
  }
  const idOf = headwordIds(xs);
  // A related word that is on the list links to it; any other stays plain text.
  const ref = (w: string) => (idOf.has(hkey(w)) ? `<a href="#w-${idOf.get(hkey(w))}">${esc(w)}</a>` : esc(w));
  const extra = (w: string) => {
    if (!extras) return "";
    const k = hkey(w), same = extras.same.get(k) ?? [], opp = extras.opposite.get(k) ?? [], seen = extras.seen.get(k) ?? [];
    return (same.length ? `<p class="rel"><span class="lbl" data-s="relSame">Same Meaning</span> ${same.map(ref).join(", ")}</p>` : "")
      + (opp.length ? `<p class="rel"><span class="lbl" data-s="relOpposite">Opposite</span> ${opp.map(ref).join(", ")}</p>` : "")
      + (seen.length ? `<div class="seen"><span class="lbl" data-s="seenInUse">Seen in Use</span>${seen.map((x) => `<span class="ex">${esc(x.paite)}<br>${esc(x.english)}</span>`).join("")}</div>` : "");
  };
  const groups = new Map<string, [string, Entry[]][]>();
  for (const [w, es] of words) {
    const l = w.charAt(0).toUpperCase();
    const k = /\p{L}/u.test(l) ? l : "#";
    groups.set(k, [...(groups.get(k) ?? []), [w, es]]);
  }
  const meaning = (e: Entry) => `<p class="m">${esc(e.english)}</p>${e.note ? `<span class="n">${esc(e.note)}</span>` : ""}${e.example ? `<span class="ex">${esc(e.example.paite)}<br>${esc(e.example.english)}</span>` : ""}${e.by || e.reviewed_by ? `<span class="n by">${[e.by ? `Added by ${esc(e.by)}` : "", e.reviewed_by ? `Reviewed by ${esc(e.reviewed_by)}` : ""].filter(Boolean).join(" · ")}</span>` : `<span class="n by" data-s="${e.source === "contributed" ? "srcContributed" : "srcNote"}">${e.source === "contributed" ? "Added by a contributor" : "From a contributor's note"}</span>`}`;
  const li = ([w, es]: [string, Entry[]]) => `<li id="w-${es[0].id}" data-q="${esc(es.flatMap((e) => [e === es[0] ? w : "", e.english, e.note, e.example?.paite, e.example?.english]).filter(Boolean).join(" ").toLowerCase())}"><b class="w">${esc(w)}</b>${es.length > 1 ? `<ol class="mn">${es.map((e, i) => `<li${i ? ` id="w-${e.id}"` : ""}>${meaning(e)}</li>`).join("")}</ol>` : meaning(es[0])}${extra(w)}</li>`;
  // A to Z rail: one link per letter; the script turns it into a one-letter-at-a-time switch.
  const rail = groups.size > 1 ? `<nav class="az" aria-label="Letters">${[...groups.keys()].map((k) => `<a href="#l-${esc(k)}">${esc(k)}</a>`).join("")}</nav>` : "";
  const body = groups.size
    ? [...groups].map(([k, ws]) => `<details class="rows" open id="l-${esc(k)}" aria-label="${esc(k)}" data-letter="${esc(k)}"><summary><span class="ltr">${esc(k)}</span><span class="cnt">${ws.length} ${ws.length === 1 ? "word" : "words"}</span></summary><ul>${ws.map(li).join("")}</ul></details>`).join("")
    : '<p class="empty"><span data-s="glossaryEmpty">No words yet. Add the first one on the front page.</span> <a href="/">Paite Daily</a></p>';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Paite Word List</title>
<meta name="theme-color" content="#f5f1e8">
<link rel="canonical" href="https://paite.lamkalabs.com/glossary">
<meta property="og:site_name" content="Paite Daily">
<meta property="og:type" content="website">
<meta property="og:locale" content="en_IN">
<meta property="og:url" content="https://paite.lamkalabs.com/glossary">
<meta property="og:title" content="Paite Word List">
<meta property="og:description" content="The Paite Word List from our contributors: Paite words, English meanings and examples.">
<meta property="og:image" content="https://paite.lamkalabs.com/og.png?v=2">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="Paite Daily: a Paite–English corpus, verified by native speakers.">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="Paite Word List">
<meta name="twitter:description" content="The Paite word list from our contributors: Paite words, English meanings and examples.">
<meta name="twitter:image" content="https://paite.lamkalabs.com/og.png?v=2">
<meta name="twitter:image:alt" content="Paite Daily: a Paite–English corpus, verified by native speakers.">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
<link rel="icon" href="/favicon.ico" sizes="32x32">
<link rel="icon" href="/icons/emblem-small.svg" type="image/svg+xml">
<link rel="icon" href="/icons/icon-192.png" sizes="192x192">
<script>document.documentElement.className="js"</script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Young+Serif&family=Instrument+Serif:ital@1&family=Inter:wght@400;600;700&display=swap">
<link rel="stylesheet" href="/style.css">
<script src="/theme.js"></script>
<link rel="stylesheet" href="/contributors.css">
</head>
<body class="cp blue">
<header class="hero"><div class="hero-nav"><a class="back" href="/" data-back><span aria-hidden="true">&larr;</span> Back</a></div><h1 data-s="glossaryTitle">Paite Word List</h1><p data-s="glossaryLine">Words from the notes of our contributors.</p></header>
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
<p class="licence">Words that mean the same or the opposite: <a href="/same-opposite">Same &amp; Opposite</a>.</p>
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
