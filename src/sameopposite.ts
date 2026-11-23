import { publicReviewerNames } from "./access";
import { esc } from "./contributors";
import { FOOTER } from "./footer";
import { getGlossary, hkey, headwordIds, LINK_HIDDEN } from "./glossary";
import type { Env } from "./types";

export type Pair = { paite: string; other: string; kind: "same" | "opposite"; added_by: string | null; reviewed_by: string | null };
export type Shared = { english: string; words: { paite: string; id: number }[] };
export type SameOpposite = { pairs: Pair[]; shared: Shared[]; ids: Map<string, number> };

/** Checked pairs, newest first, and the English meanings that two or more listed words share. */
export async function getSameOpposite(env: Env): Promise<SameOpposite> {
  const { results } = await env.DB.prepare(
    `SELECT paite, other, kind, contributor_name AS added_by, reviewed_by FROM word_links l WHERE status = 'approved' AND NOT ${LINK_HIDDEN} ORDER BY id DESC`,
  ).all<Pair>();
  const name = await publicReviewerNames(env);
  const pairs = results.map((r) => ({ ...r, reviewed_by: name(r.reviewed_by) }));
  const xs = await getGlossary(env);
  const ids = headwordIds(xs);
  const by = new Map<string, { english: string; words: Map<string, string> }>();
  for (const e of xs) {
    const k = e.english.trim().toLowerCase();
    const g = by.get(k) ?? { english: e.english.trim(), words: new Map<string, string>() };
    if (!g.words.has(hkey(e.paite))) g.words.set(hkey(e.paite), e.paite.trim());
    by.set(k, g);
  }
  const shared = [...by.values()]
    .filter((g) => g.words.size >= 2)
    .map((g) => ({ english: g.english, words: [...g.words].sort((a, b) => a[1].localeCompare(b[1])).slice(0, 12).map(([k, paite]) => ({ paite, id: ids.get(k)! })) }))
    .sort((a, b) => a.english.localeCompare(b.english));
  return { pairs, shared, ids };
}

export const sameOppositeJson = (xs: Pair[]) =>
  JSON.stringify({ pairs: [...xs].sort((a, b) => a.paite.localeCompare(b.paite)).map(({ paite, other, kind, added_by, reviewed_by }) => ({ paite, other, kind, added_by, reviewed_by })) }, null, 2) + "\n";

const JS = `(function(){var S=window.STRINGS||{};
function t(k,f){var s=S[k];return s&&s.pai?s.pai:(s&&s.en)||f}
document.querySelectorAll("[data-s]").forEach(function(e){var s=S[e.dataset.s];if(s&&s.pai)e.innerHTML=s.pai+"<small> "+s.en+"</small>";});
function setF(f){document.querySelectorAll(".filters button").forEach(function(x){x.setAttribute("aria-pressed",String(x.dataset.f===f))});
document.querySelectorAll("[data-kind]").forEach(function(li){li.hidden=!(f==="all"||li.dataset.kind===f)});
var sh=document.getElementById("shared");if(sh)sh.hidden=f==="opposite"}
document.querySelectorAll("button[data-f]").forEach(function(b){b.addEventListener("click",function(){setF(b.dataset.f)})});
var KEY="pd:phone",tsId=null,waiter=null;
function phone(){var v=null;try{v=JSON.parse(localStorage.getItem(KEY))}catch(e){}
if(!v||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)){v=(window.crypto&&window.crypto.randomUUID)?window.crypto.randomUUID():"xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g,function(c){var r=window.crypto&&window.crypto.getRandomValues?window.crypto.getRandomValues(new Uint8Array(1))[0]&15:Math.random()*16|0;return(c==="x"?r:(r&3)|8).toString(16)});try{localStorage.setItem(KEY,JSON.stringify(v))}catch(e){}}
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
var f=document.getElementById("pair-form");
f.addEventListener("submit",function(ev){ev.preventDefault();
var st=f.querySelector(".st"),btn=f.querySelector("button"),a=f.elements.paite,o=f.elements.other,k=f.elements.kind.value;
var av=a.value.trim(),ov=o.value.trim();if(!av){a.focus();return}if(!ov){o.focus();return}
btn.disabled=true;st.className="st";st.textContent=t("sending","Sending\u2026");
var nm=null;try{nm=JSON.parse(localStorage.getItem("pd:name"))}catch(e){}
nameSession().then(function(j){var body={paite:av,other:ov,kind:k};if(nm)body.name=nm;
return fetch("/api/link/pair",{method:"POST",headers:{"content-type":"application/json","X-Session":j.session},body:JSON.stringify(body)})})
.then(function(r){if(r.status===429)throw new Error("slow");if(!r.ok)throw new Error("bad");
st.className="st ok";st.textContent=t("proverbThanks","Thanks! A reviewer will check it.");a.value="";o.value="";btn.disabled=false;ask(f)})
.catch(function(e){btn.disabled=false;st.className="st err";
st.textContent=e.message==="slow"?t("tooFast","Slow down a little, then try again."):t("offline","Could not send. Check your internet and try again.")})});
var ak=document.getElementById("ask-name");
function named(){try{return !!JSON.parse(localStorage.getItem("pd:name"))||!!JSON.parse(localStorage.getItem("pd:noName"))}catch(e){return false}}
function ask(el){if(!ak||named())return;
ak.hidden=false;ak.scrollIntoView({block:"nearest"})}
function nameSession(){return token().then(function(tk){return fetch("/api/session",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({phoneId:phone(),turnstileToken:tk})})}).then(function(r){if(!r.ok)throw new Error("session");return r.json()})}
if(ak){
var nm=document.getElementById("name"),sv=document.getElementById("save-name"),nn=document.getElementById("no-name");
if(sv)sv.addEventListener("click",function(){var v=nm?nm.value.trim().slice(0,60):"";
if(!v){try{localStorage.setItem("pd:noName","true")}catch(e){}ak.hidden=true;return}
try{localStorage.setItem("pd:name",JSON.stringify(v))}catch(e){}ak.hidden=true;
nameSession().then(function(j){return fetch("/api/name",{method:"POST",headers:{"content-type":"application/json","X-Session":j.session},body:JSON.stringify({name:v})})}).catch(function(){})});
if(nn)nn.addEventListener("click",function(){try{localStorage.setItem("pd:noName","true")}catch(e){}ak.hidden=true});}
})();`;

export function renderSameOpposite(data: SameOpposite, siteKey = ""): string {
  const { pairs, shared, ids } = data;
  // A word on the list links to its entry; any other stays plain text.
  const ref = (w: string) => (ids.has(hkey(w)) ? `<a href="/glossary#w-${ids.get(hkey(w))}">${esc(w)}</a>` : esc(w));
  const pair = (p: Pair) => {
    const credit = [p.added_by ? `Added by ${esc(p.added_by)}` : "", p.reviewed_by ? `Reviewed by ${esc(p.reviewed_by)}` : ""].filter(Boolean).join(" · ");
    return `<li data-kind="${p.kind}"><b class="w">${ref(p.paite)}</b> <span class="k">${p.kind === "same" ? "same meaning as" : "opposite of"}</span> <b class="w">${ref(p.other)}</b>${
      credit ? `<span class="n by">${credit}</span>` : '<span class="n by" data-s="srcContributed">Added by a contributor</span>'
    }</li>`;
  };
  const checked = pairs.length ? `<section class="so"><h2 data-s="sameOppChecked">Checked by a Reviewer</h2><ul class="rows">${pairs.map(pair).join("")}</ul></section>` : "";
  const share = shared.length
    ? `<section class="so" id="shared"><h2 data-s="sameOppShared">Sharing an English Meaning</h2><p class="n" data-s="sameOppSharedNote">Words the list gives the same English meaning. Not checked as a pair.</p><ul class="rows">${shared
        .map((g) => `<li><p class="m">${esc(g.english)}</p><span class="w">${g.words.map((w) => `<a href="/glossary#w-${w.id}">${esc(w.paite)}</a>`).join(", ")}</span></li>`)
        .join("")}</ul></section>`
    : "";
  const body = checked || share ? checked + share : '<p class="empty"><span data-s="sameOppEmpty">No pairs yet. Suggest the first one.</span></p>';

  return `<!doctype html>
<html lang="en" data-sitekey="${esc(siteKey)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Same &amp; Opposite</title>
<meta name="theme-color" content="#f5f1e8">
<link rel="canonical" href="https://paite.lamkalabs.com/same-opposite">
<meta property="og:site_name" content="Paite Daily">
<meta property="og:type" content="website">
<meta property="og:locale" content="en_IN">
<meta property="og:url" content="https://paite.lamkalabs.com/same-opposite">
<meta property="og:title" content="Same &amp; Opposite">
<meta property="og:description" content="Paite words that mean the same, and words that mean the opposite, from our contributors.">
<meta property="og:image" content="https://paite.lamkalabs.com/og.png?v=2">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="Paite Daily: a Paite–English corpus, verified by native speakers.">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="Same &amp; Opposite">
<meta name="twitter:description" content="Paite words that mean the same, and words that mean the opposite.">
<meta name="twitter:image" content="https://paite.lamkalabs.com/og.png?v=2">
<meta name="twitter:image:alt" content="Paite Daily: a Paite–English corpus, verified by native speakers.">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
<link rel="icon" href="/favicon.ico" sizes="32x32">
<link rel="icon" href="/icons/emblem-small.svg" type="image/svg+xml">
<link rel="icon" href="/icons/icon-192.png" sizes="192x192">
<script>document.documentElement.className="js"</script>
<link rel="preload" href="/fonts/youngserif-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/instrumentserif-italic-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/inter-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/fonts.css">
<link rel="stylesheet" href="/style.css">
<script src="/theme.js"></script>
<link rel="stylesheet" href="/contributors.css">
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=onTurnstileLoad" defer></script>
</head>
<body class="cp blue">
<header class="hero"><div class="hero-nav"><a class="back" href="/" data-back><span aria-hidden="true">&larr;</span> Back</a></div><h1 data-s="sameOppTitle">Same &amp; Opposite</h1><p data-s="sameOppLine">Paite words that mean the same, and words that mean the opposite.</p></header>
<main class="gl">
<p class="filters"><button type="button" data-f="all" aria-pressed="true" data-s="filterAll">All</button><button type="button" data-f="same" aria-pressed="false" data-s="relSame">Same Meaning</button><button type="button" data-f="opposite" aria-pressed="false" data-s="relOpposite">Opposite</button></p>
${body}
<section class="so"><h2 data-s="sameOppSuggest">Suggest a Pair</h2>
<form id="pair-form" novalidate>
<label class="lbl" for="p-a" data-s="sameOppWord">Paite word</label>
<input id="p-a" name="paite" lang="pck" spellcheck="false" maxlength="60" autocomplete="off">
<p class="filters kinds"><label><input type="radio" name="kind" value="same" checked><span data-s="relSame">Same Meaning</span></label><label><input type="radio" name="kind" value="opposite"><span data-s="relOpposite">Opposite</span></label></p>
<label class="lbl" for="p-b" data-s="sameOppWord">Paite word</label>
<input id="p-b" name="other" lang="pck" spellcheck="false" maxlength="60" autocomplete="off">
<button type="submit" class="send" data-s="send">Send</button>
<p class="st" role="status"></p>
</form></section>
<a class="cta" href="/"><span>Paite Daily<small data-s="addSentence">Add a Sentence</small></span><span class="go" aria-hidden="true">&rarr;</span></a>
<div id="ask-name" hidden>
<p id="askName" data-s="askName">Want your name on the Paite contributors list?</p>
<input id="name" spellcheck="false" aria-labelledby="askName" maxlength="60" autocomplete="nickname" placeholder="Your Name">
<div class="actions"><button type="button" class="primary" id="save-name" data-s="saveName">Add My Name</button><button type="button" id="no-name" data-s="noThanks">No Thanks</button></div>
</div>
<p class="licence">Download the pairs as <a href="/same-opposite.json">JSON</a>.</p>
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
