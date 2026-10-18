import { esc } from "./contributors";
import { FOOTER } from "./footer";
import { PUAN } from "./puan";
import { cap } from "./text";
import type { Env } from "./types";

export type Kind = "proverb" | "idiom";
export type Direction = "pai2en" | "en2pai";
export type Status = "open" | "pending" | "live" | "hidden";

export type Proverb = {
  id: number;
  kind: Kind;
  paite: string | null;
  english: string | null;
  explainer: string | null;
  explainer_en: string | null;
  entered_from: Direction;
  status: Status;
};

/** The line a saying is filed and grouped under: Paite where we have it. */
const lead = (p: Proverb) => p.paite ?? p.english ?? "";

/**
 * The public list. Live sayings, plus English idioms still waiting for a Paite
 * version — those are shown on purpose, marked, because the gap is the invitation.
 */
export async function getProverbs(env: Env, limit = -1): Promise<Proverb[]> {
  const { results } = await env.DB.prepare(
    `SELECT id, kind, paite, english, explainer, explainer_en, entered_from, status
       FROM proverbs WHERE status IN ('live', 'open') ORDER BY id LIMIT ?1`,
  )
    .bind(limit)
    .all<Proverb>();
  return results.map((r) => ({
    ...r,
    paite: r.paite ? cap(r.paite) : null,
    english: r.english ? cap(r.english) : null,
  }));
}

export const proverbsJson = (xs: Proverb[]) =>
  JSON.stringify(
    {
      entries: [...xs]
        .sort((a, b) => lead(a).localeCompare(lead(b)))
        .map(({ id, ...e }) => e),
    },
    null,
    2,
  ) + "\n";

const JS = `(function(){var S=window.STRINGS||{};
document.querySelectorAll("[data-s]").forEach(function(e){var s=S[e.dataset.s];if(s&&s.pai)e.innerHTML=s.pai+"<small> "+s.en+"</small>";});
var q=document.getElementById("q"),sr=S.search;if(sr&&sr.pai){q.placeholder=q.ariaLabel=sr.pai+" / "+sr.en;q.setAttribute("aria-label",q.placeholder)}
var dir="all";
function apply(){var t=q.value.trim().toLowerCase();
document.querySelectorAll(".gl li").forEach(function(li){li.hidden=!(dir==="all"||li.dataset.dir===dir)||(!!t&&li.dataset.q.indexOf(t)<0)});
document.querySelectorAll(".gl details.rows").forEach(function(g){var live=g.querySelectorAll("li:not([hidden])");g.hidden=!live.length;
var c=g.querySelector(".cnt");if(c)c.textContent=live.length;if(t||dir!=="all")g.open=!!live.length})}
document.querySelectorAll(".filters button").forEach(function(b){b.addEventListener("click",function(){dir=b.dataset.dir;
document.querySelectorAll(".filters button").forEach(function(x){x.setAttribute("aria-pressed",String(x===b))});apply()})});
q.addEventListener("input",apply);
function openHash(){var l=document.getElementById(location.hash.slice(1));if(!l)return;var d=l.querySelector("details");if(d)d.open=true;
var g=l.closest("details.rows");if(g)g.open=true;l.scrollIntoView()}
openHash();addEventListener("hashchange",openHash);
})();`;

const tag = (k: Kind) =>
  k === "idiom"
    ? '<span class="tag" data-s="kindIdiom">Idiom</span>'
    : '<span class="tag" data-s="kindProverb">Proverb</span>';

function item(p: Proverb): string {
  // Read in the direction it was entered: a Paite proverb leads with Paite, an
  // English idiom leads with English until a contributor supplies the Paite line.
  const first = p.entered_from === "en2pai" ? p.english : p.paite;
  const second = p.entered_from === "en2pai" ? p.paite : p.english;
  const q = [p.paite, p.english, p.explainer, p.explainer_en].filter(Boolean).join(" ").toLowerCase();
  const other = second
    ? `<small class="m">${esc(second)}</small>`
    : p.entered_from === "en2pai"
      ? '<small class="m" data-s="needsPaite">Needs a Paite version</small>'
      : "";
  return `<li id="p-${p.id}" data-dir="${p.entered_from}" data-q="${esc(q)}"><details open><summary><b class="w">${esc(first ?? "")}</b> ${other}${tag(p.kind)}</summary>${
    p.explainer ? `<p class="n">${esc(p.explainer)}</p>` : ""
  }${p.explainer_en ? `<p class="n en">${esc(p.explainer_en)}</p>` : ""}</details></li>`;
}

export function renderProverbs(xs: Proverb[]): string {
  const groups = new Map<string, Proverb[]>();
  for (const p of [...xs].sort((a, b) => lead(a).localeCompare(lead(b)))) {
    const l = lead(p).charAt(0).toUpperCase();
    const k = /\p{L}/u.test(l) ? l : "#";
    groups.set(k, [...(groups.get(k) ?? []), p]);
  }
  const body = groups.size
    ? [...groups]
        .map(
          ([k, ps]) =>
            `<details class="rows" aria-label="${esc(k)}" data-letter="${esc(k)}"><summary><span class="ltr">${esc(k)}</span><span class="cnt">${ps.length}</span></summary><ul>${ps
              .map(item)
              .join("")}</ul></details>`,
        )
        .join("")
    : '<p class="empty"><span data-s="proverbsEmpty">No sayings yet. Add the first one.</span> <a href="/">Paite Daily</a></p>';

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Paite Proverbs &amp; Idioms</title>
<meta name="theme-color" content="#ffffff">
<link rel="canonical" href="https://paite.lamkalabs.com/proverbs">
<meta property="og:site_name" content="Paite Daily">
<meta property="og:type" content="website">
<meta property="og:locale" content="en_IN">
<meta property="og:url" content="https://paite.lamkalabs.com/proverbs">
<meta property="og:title" content="Paite Proverbs &amp; Idioms">
<meta property="og:description" content="Paite proverbs and idioms with an explainer saying what each one means, and English idioms waiting for their Paite version.">
<meta property="og:image" content="https://paite.lamkalabs.com/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="Paite Daily: translate one sentence a day. Free and open data for the Paite language.">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="Paite Proverbs &amp; Idioms">
<meta name="twitter:description" content="Paite proverbs and idioms, each with an explainer.">
<meta name="twitter:image" content="https://paite.lamkalabs.com/og.png">
<meta name="twitter:image:alt" content="Paite Daily: translate one sentence a day.">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
<link rel="icon" href="/icons/icon-192.png" sizes="192x192">
<script>document.documentElement.className="js"</script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Young+Serif&family=Atkinson+Hyperlegible:wght@400;700&display=swap">
<link rel="stylesheet" href="/style.css">
<link rel="stylesheet" href="/contributors.css">
</head>
<body class="cp">
<header class="hero"><div class="hero-nav"><a class="back" href="/" data-back><span aria-hidden="true">&larr;</span> Back</a><a class="back" href="/review">Reviewer <span aria-hidden="true">&rarr;</span></a></div>${PUAN}<h1 data-s="proverbsTitle">Proverbs &amp; Idioms</h1><p data-s="proverbsLine">The sayings our elders use, and what each one means.</p></header>
<main class="gl">
<input id="q" type="search" placeholder="Search" aria-label="Search">
<p class="filters"><button type="button" data-dir="all" aria-pressed="true" data-s="filterAll">All</button><button type="button" data-dir="pai2en" aria-pressed="false" data-s="filterPai2En">Paite &rarr; English</button><button type="button" data-dir="en2pai" aria-pressed="false" data-s="filterEn2Pai">English &rarr; Paite</button></p>
${body}
<a class="cta" href="/"><span>Paite Daily<small data-s="addSentence">Add a Sentence</small></span><span class="go" aria-hidden="true">&rarr;</span></a>
${FOOTER}
</main>
<script src="/strings.js"></script>
<script src="/back.js"></script>
<script src="/pwa.js"></script>
<script src="/track.js"></script>
<script>${JS}</script>
</body></html>`;
}
