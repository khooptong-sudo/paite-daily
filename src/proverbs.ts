import { publicReviewerNames } from "./access";
import { esc } from "./contributors";
import { FOOTER } from "./footer";
import { PUAN } from "./puan";
import { cap, cleanText, isId } from "./text";
import { json, type Env } from "./types";

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
  accepting_more: number;
  answers: number;
  by: string | null;
  reviewed_by: string | null;
};

const opt = (v: unknown, max: number) => (v === undefined || v === null || v === "" ? null : cleanText(v, max));

/** The line a saying is filed and grouped under: Paite where we have it. */
const lead = (p: Proverb) => p.paite ?? p.english ?? "";

/**
 * The public list. Live sayings, plus English idioms still waiting for a Paite
 * version — those are shown on purpose, marked, because the gap is the invitation.
 */
export async function getProverbs(env: Env, limit = -1): Promise<Proverb[]> {
  const { results } = await env.DB.prepare(
    `SELECT p.id, p.kind, p.paite, p.english, p.explainer, p.explainer_en, p.entered_from, p.status, p.accepting_more,
            p.contributor_name AS by, p.reviewed_by,
            (SELECT count(*) FROM proverb_answers a WHERE a.proverb_id = p.id AND a.status <> 'rejected') AS answers
       FROM proverbs p WHERE p.status IN ('live', 'open') ORDER BY p.id LIMIT ?1`,
  )
    .bind(limit)
    .all<Proverb>();
  // Public: the page and /proverbs.json show the reviewer's name, never the email.
  const name = await publicReviewerNames(env);
  return results.map((r) => ({
    ...r,
    reviewed_by: name(r.reviewed_by),
    paite: r.paite ? cap(r.paite) : null,
    english: r.english ? cap(r.english) : null,
  }));
}

export const proverbsJson = (xs: Proverb[]) =>
  JSON.stringify(
    {
      entries: [...xs]
        .sort((a, b) => lead(a).localeCompare(lead(b)))
        .map(({ id, answers, ...e }) => e),
    },
    null,
    2,
  ) + "\n";

/**
 * POST /api/proverb/answer, after the contributor session check: a Paite version
 * of an English idiom. Stored for a reviewer, never published straight away.
 */
export async function submitProverbAnswer(env: Env, phoneId: string, b: Record<string, unknown>): Promise<Response> {
  const paite = cleanText(b.paite, 300), explainer = opt(b.explainer, 600), explainer_en = opt(b.explainer_en, 600), name = opt(b.name, 60);
  if (!isId(b.id) || !paite) return json({ error: "bad_request" }, 400);
  if ((b.explainer && !explainer) || (b.explainer_en && !explainer_en) || (b.name && !name)) return json({ error: "bad_request" }, 400);
  const p = await env.DB.prepare("SELECT status, accepting_more FROM proverbs WHERE id = ?1")
    .bind(b.id)
    .first<{ status: string; accepting_more: number }>();
  if (!p) return json({ error: "not_found" }, 404);
  // A saying takes renderings while it waits for its first Paite line, and again
  // once a reviewed line has published and the saying is collecting more.
  const collecting = p.status === "open" || p.status === "pending" || (p.status === "live" && p.accepting_more === 1);
  if (!collecting) return json({ error: "closed" }, 409);
  const dup = await env.DB.prepare("SELECT 1 FROM proverb_answers WHERE proverb_id = ?1 AND phone_id = ?2 AND lower(paite) = lower(?3)").bind(b.id, phoneId, paite).first();
  if (!dup)
    await env.DB.prepare(
      "INSERT INTO proverb_answers (proverb_id, paite, explainer, explainer_en, phone_id, contributor_name) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
    )
      .bind(b.id, cap(paite), explainer, explainer_en, phoneId, name)
      .run();
  return json({ ok: true });
}

/**
 * POST /api/proverb/submit, after the contributor session check: a whole saying
 * pair from the front page, in either direction. It waits for a reviewer.
 */
export async function submitProverbPair(env: Env, phoneId: string, b: Record<string, unknown>): Promise<Response> {
  const paite = cleanText(b.paite, 300), english = cleanText(b.english, 300);
  const explainer = opt(b.explainer, 600), explainer_en = opt(b.explainer_en, 600), name = opt(b.name, 60);
  const kind = b.kind === "idiom" ? "idiom" : "proverb";
  const direction = b.direction === "pai2en" ? "pai2en" : "en2pai";
  if (!paite || !english) return json({ error: "bad_request" }, 400);
  if ((b.explainer && !explainer) || (b.explainer_en && !explainer_en) || (b.name && !name)) return json({ error: "bad_request" }, 400);
  // Either line already known means the saying is already here: answer ok, insert nothing.
  const dup = await env.DB.prepare("SELECT 1 FROM proverbs WHERE lower(paite) = lower(?1) OR lower(english) = lower(?2)").bind(paite, english).first();
  if (!dup)
    await env.DB.prepare(
      `INSERT INTO proverbs (kind, paite, english, explainer, explainer_en, entered_from, status, source, submitted_by, contributor_name)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'pending', 'contributed', ?7, ?8)`,
    )
      .bind(kind, cap(paite), cap(english), explainer, explainer_en, direction, phoneId, name)
      .run();
  return json({ ok: true });
}

const JS = `(function(){var S=window.STRINGS||{};
try{var me=JSON.parse(localStorage.getItem("pd:me"));if(me&&me.sayings>0){var y=document.getElementById("you");y.textContent="You: "+me.sayings;y.hidden=false}}catch(e){}
function t(k,f){var s=S[k];return s&&s.pai?s.pai:(s&&s.en)||f}
document.querySelectorAll("[data-s]").forEach(function(e){var s=S[e.dataset.s];if(s&&s.pai)e.innerHTML=s.pai+"<small> "+s.en+"</small>";});
var q=document.getElementById("q"),sr=S.search;if(sr&&sr.pai){q.placeholder=q.ariaLabel=sr.pai+" / "+sr.en;q.setAttribute("aria-label",q.placeholder)}
var dir="pai2en";
function apply(){var v=q.value.trim().toLowerCase();
var pn=document.getElementById("paite-thin");if(pn)pn.hidden=dir!=="pai2en";
var wn=document.getElementById("waiting");if(wn){var jb=wn.querySelector(".jump");if(jb)jb.hidden=dir==="en2pai"}
document.querySelectorAll(".gl li").forEach(function(li){li.hidden=!(dir==="all"||li.dataset.dir===dir)||(!!v&&li.dataset.q.indexOf(v)<0)});
document.querySelectorAll(".gl details.rows").forEach(function(g){var live=g.querySelectorAll("li:not([hidden])");g.hidden=!live.length;
var c=g.querySelector(".cnt");if(c)c.textContent=live.length;if(v||dir!=="all")g.open=!!live.length})}
function setDir(d){dir=d;document.querySelectorAll(".filters button").forEach(function(x){x.setAttribute("aria-pressed",String(x.dataset.dir===d))});apply()}
document.querySelectorAll("button[data-dir]").forEach(function(b){b.addEventListener("click",function(){setDir(b.dataset.dir)})});
q.addEventListener("input",apply);
apply();
function openHash(){var l=document.getElementById(location.hash.slice(1));if(!l)return;var d=l.querySelector("details");if(d)d.open=true;
var g=l.closest("details.rows");if(g)g.open=true;l.scrollIntoView()}
openHash();addEventListener("hashchange",openHash);

var KEY="pd:phone",tsId=null,waiter=null;
function phone(){var v=null;try{v=JSON.parse(localStorage.getItem(KEY))}catch(e){}
if(!v){v=(window.crypto&&window.crypto.randomUUID)?window.crypto.randomUUID():String(Date.now())+Math.random().toString(36).slice(2);try{localStorage.setItem(KEY,JSON.stringify(v))}catch(e){}}
return v}
var tsReady=new Promise(function(res){if(window.turnstile)return res();window.onTurnstileLoad=res;
var i=setInterval(function(){if(window.turnstile){clearInterval(i);res()}},50)});
function token(){return new Promise(function(resolve,reject){
var timer=setTimeout(function(){if(waiter===me)waiter=null;reject(new Error("turnstile timeout"))},15000);
var me=waiter={resolve:function(v){clearTimeout(timer);resolve(v)},reject:function(e){clearTimeout(timer);reject(e)}};
tsReady.then(function(){
if(tsId===null){tsId=window.turnstile.render("#turnstile",{sitekey:document.documentElement.dataset.sitekey,appearance:"interaction-only",callback:function(v){waiter&&waiter.resolve(v)},"error-callback":function(){waiter&&waiter.reject(new Error("turnstile"))}})}
else{window.turnstile.reset(tsId)}
}).catch(function(e){waiter&&waiter.reject(e)})})}
document.querySelectorAll("form[data-id]").forEach(function(f){
f.addEventListener("submit",function(ev){ev.preventDefault();
var st=f.querySelector(".st"),btn=f.querySelector("button"),ta=f.querySelector("textarea[name=paite]"),ex=f.querySelector("textarea[name=explainer]");
var paite=ta.value.trim();if(!paite){ta.focus();return}
btn.disabled=true;st.className="st";st.textContent=t("sending","Sending\u2026");
token().then(function(tk){return fetch("/api/session",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({phoneId:phone(),turnstileToken:tk})})})
.then(function(r){if(!r.ok)throw new Error("session");return r.json()})
.then(function(j){return fetch("/api/proverb/answer",{method:"POST",headers:{"content-type":"application/json","X-Session":j.session},body:JSON.stringify({id:Number(f.dataset.id),paite:paite,explainer:ex?ex.value.trim():""})})})
.then(function(r){if(r.status===429)throw new Error("slow");if(!r.ok)throw new Error("bad");
st.className="st ok";st.textContent=t("proverbThanks","Thanks! A reviewer will check it.");ta.value="";if(ex)ex.value="";btn.disabled=false})
.catch(function(e){btn.disabled=false;st.className="st err";
st.textContent=e.message==="slow"?t("tooFast","Slow down a little, then try again."):t("offline","Could not send. Check your internet and try again.")})})});
})();`;

const tag = (k: Kind) =>
  k === "idiom"
    ? '<span class="tag" data-s="kindIdiom">Idiom</span>'
    : '<span class="tag" data-s="kindProverb">Proverb</span>';

function form(p: Proverb): string {
  return `<details class="tr"><summary data-s="translateIt">Translate into Paite</summary><form data-id="${p.id}">
<label class="lbl" for="p-${p.id}" data-s="yourVersion">Your Paite version</label>
<textarea id="p-${p.id}" name="paite" rows="2" maxlength="300" required></textarea>
<label class="lbl" for="e-${p.id}" data-s="explainerOptional">Explain what it means (optional)</label>
<textarea id="e-${p.id}" name="explainer" rows="2" maxlength="600"></textarea>
<button type="submit" class="send" data-s="send">Send</button>
<p class="st" role="status"></p></form></details>`;
}

function item(p: Proverb): string {
  // Read in the direction it was entered: a Paite proverb leads with Paite, an
  // English idiom leads with English until a contributor supplies the Paite line.
  const first = p.entered_from === "en2pai" ? p.english : p.paite;
  const second = p.entered_from === "en2pai" ? p.paite : p.english;
  const waiting = !p.paite;
  const collecting = waiting || p.accepting_more === 1;
  const q = [p.paite, p.english, p.explainer, p.explainer_en].filter(Boolean).join(" ").toLowerCase();
  const more = p.paite && p.accepting_more === 1
    ? ' <small class="m" data-s="anotherVersion">Another version welcome</small>'
    : "";
  const other = second
    ? `<small class="m">${esc(second)}</small>${more}`
    : waiting
      ? '<small class="m" data-s="needsPaite">Needs a Paite version</small>'
      : "";
  const count = p.answers > 0 ? `<span class="n">${p.answers} ${p.answers === 1 ? "translation" : "translations"} so far</span>` : "";
  // Credit both sides of a reviewed entry: who contributed it, and who cleared it.
  const credit = [p.by ? `Added by ${esc(p.by)}` : "", p.reviewed_by ? `Reviewed by ${esc(p.reviewed_by)}` : ""].filter(Boolean).join(" · ");
  const creditLine = credit ? `<p class="n by">${credit}</p>` : "";
  return `<li id="p-${p.id}" data-st="${collecting ? "open" : "live"}" data-dir="${p.entered_from}" data-q="${esc(q)}"><details open><summary><b class="w">${esc(first ?? "")}</b> ${other}${tag(p.kind)}</summary>${
    p.explainer ? `<p class="n">${esc(p.explainer)}</p>` : ""
  }${p.explainer_en ? `<p class="n en">${esc(p.explainer_en)}</p>` : ""}${count}${creditLine}${collecting ? form(p) : ""}</details></li>`;
}

export function renderProverbs(xs: Proverb[], siteKey = ""): string {
  const groups = new Map<string, Proverb[]>();
  for (const p of [...xs].sort((a, b) => lead(a).localeCompare(lead(b)))) {
    const l = lead(p).charAt(0).toUpperCase();
    const k = /\p{L}/u.test(l) ? l : "#";
    groups.set(k, [...(groups.get(k) ?? []), p]);
  }
  const waiting = xs.filter((p) => !p.paite).length;
  const paiteCount = xs.length - waiting;
  const body = groups.size
    ? [...groups]
        .map(
          ([k, ps]) =>
            `<details class="rows" aria-label="${esc(k)}" data-letter="${esc(k)}"><summary><span class="ltr">${esc(k)}</span><span class="cnt">${ps.length}</span></summary><ul>${ps
              .map(item)
              .join("")}</ul></details>`,
        )
        .join("")
    : '<p class="empty"><span data-s="proverbsEmpty">No Pau Upa yet. Add the first one.</span> <a href="/">Paite Daily</a></p>';

  return `<!doctype html>
<html lang="en" data-sitekey="${esc(siteKey)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Paite Proverbs &amp; Idioms</title>
<meta name="theme-color" content="#ffffff">
<link rel="canonical" href="https://paite.lamkalabs.com/proverbs">
<meta property="og:site_name" content="Paite Daily">
<meta property="og:type" content="website">
<meta property="og:locale" content="en_IN">
<meta property="og:url" content="https://paite.lamkalabs.com/proverbs">
<meta property="og:title" content="Paite Proverbs &amp; Idioms">
<meta property="og:description" content="Paite proverbs and idioms with an explainer for each, and English proverbs and idioms waiting for their Paite version.">
<meta property="og:image" content="https://paite.lamkalabs.com/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="Paite Daily: a Paite–English corpus, verified by native speakers.">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="Paite Proverbs &amp; Idioms">
<meta name="twitter:description" content="Paite proverbs and idioms, each with an explainer.">
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
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Young+Serif&family=Atkinson+Hyperlegible:wght@400;700&display=swap">
<link rel="stylesheet" href="/style.css">
<link rel="stylesheet" href="/contributors.css">
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=onTurnstileLoad" defer></script>
</head>
<body class="cp">
<header class="hero"><div class="hero-nav"><a class="back" href="/" data-back><span aria-hidden="true">&larr;</span> Back</a><a class="back" href="/review">Reviewer <span aria-hidden="true">&rarr;</span></a></div>${PUAN}<h1 data-s="proverbsTitle">Proverbs &amp; Idioms</h1><p data-s="proverbsLine">Pau Upa: the proverbs and idioms our elders use, and what each one means.</p><p class="you" id="you" hidden></p></header>
<main class="gl">
<input id="q" type="search" placeholder="Search" aria-label="Search">
<p class="filters"><button type="button" data-dir="all" aria-pressed="false" data-s="filterAll">All</button><button type="button" data-dir="pai2en" aria-pressed="true" data-s="filterPai2En">Paite &rarr; English</button><button type="button" data-dir="en2pai" aria-pressed="false" data-s="filterEn2Pai">English &rarr; Paite</button></p>
${paiteCount < 5 ? `<p class="note" id="paite-thin"><span data-s="paiteThin">Paite Pau Upa (proverbs &amp; idioms) are still being gathered. The English list is open for translating.</span></p>` : ""}
${waiting ? `<p class="note" id="waiting"><span data-s="waitingNote">English idioms and proverbs are here for translation into Paite.</span> ${waiting} waiting. <button type="button" class="jump" data-dir="en2pai" data-s="filterEn2Pai">English &rarr; Paite</button></p>` : ""}
${body}
<a class="cta" href="/"><span>Paite Daily<small data-s="addSentence">Add a Sentence</small></span><span class="go" aria-hidden="true">&rarr;</span></a>
${FOOTER}
</main>
<div id="turnstile"></div>
<script src="/strings.js"></script>
<script src="/back.js"></script>
<script src="/pwa.js"></script>
<script src="/track.js"></script>
<script>${JS}</script>
</body></html>`;
}
