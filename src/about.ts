// The About page. Static prose only: no DB, no session, no Turnstile.
// The shell below is copied from renderGlossary() on purpose: same header, same
// footer, same font links, so /about cannot drift visually.
// It also carries the Dataset JSON-LD, so the corpus is machine-readable to
// anyone who indexes it (keyboard projects, MT researchers, archive crawlers).
// The section styling borrows the Puandum colours (red, yellow, green, black)
// and the charcoal bands of the shawl itself.
import { FOOTER } from "./footer";

const TITLE = "About Paite Daily";
const DESC =
  "Paite Daily is a free, volunteer-reviewed Paite–English corpus. 78,725 speakers, no spellchecker. Every pair is checked by a native speaker and free to use (CC0 or CC BY 4.0).";
const CANON = "https://paite.lamkalabs.com/about";

// Scoped to this page only, so no shared stylesheet is touched.
// Yellow and green fail contrast as text on white, so they are fills only.
const STYLE = `<style>
.about{--red:#d71920;--yel:#f6ff00;--grn:#00a651;--ink:#000;--coal:#202223;max-width:44rem;margin:0 auto}
.cp main.about{gap:0}
.about section{margin:0 0 3.25rem}
.about h2{font:400 clamp(1.5rem,5vw,1.9rem)/1.2 var(--display);margin:.35rem 0 1rem;text-wrap:balance}
.about h3{font:400 1.15rem/1.3 var(--display);margin:0 0 .4rem}
.about p,.about li{line-height:1.65}
.about p{margin:0 0 1rem;max-width:62ch}
.about em{font-style:italic}
.about code{font:.9em ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--surface);border:1px solid var(--line);border-radius:6px;padding:.08em .38em}
.about .stripe{height:6px;border-radius:3px;background:linear-gradient(90deg,var(--red) 0 25%,var(--yel) 25% 50%,var(--grn) 50% 75%,var(--ink) 75%)}
.about .kicker{display:flex;align-items:center;gap:.6rem;margin:0;font-size:.78rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--muted)}
.about .kicker b{color:var(--red);font-variant-numeric:tabular-nums}
.about .kicker::after{content:"";flex:1;height:1px;background:var(--line)}
.about .lead{font-size:1.2rem;line-height:1.55;color:var(--fg);margin:0 0 1rem}
.about .lead+p{color:var(--muted)}
.about .facts{list-style:none;display:grid;grid-template-columns:repeat(2,1fr);gap:12px;margin:2rem 0 3.25rem;padding:0}
.about .facts li{margin:0;padding:14px 14px 16px;border:1px solid var(--line);border-top:6px solid var(--c);border-radius:12px;background:var(--surface)}
.about .facts b{display:block;font:400 1.75rem/1.1 var(--display);color:var(--fg)}
.about .facts span{display:block;margin-top:4px;font-size:.85rem;line-height:1.4;color:var(--muted)}
.about .timeline{list-style:none;margin:1.25rem 0 0;padding:0 0 0 1.4rem;border-left:2px solid var(--hair)}
.about .timeline li{position:relative;margin:0 0 1rem;padding-left:.25rem}
.about .timeline li::before{content:"";position:absolute;left:calc(-1.4rem - 7px);top:.45em;width:12px;height:12px;border-radius:50%;background:var(--c,var(--red));box-shadow:0 0 0 2px var(--ink)}
.about .timeline time{display:block;font:400 1.05rem/1.2 var(--display)}
.about .band{margin:0 0 3.25rem;padding:28px 24px 0;border-radius:20px;background:var(--coal);color:#fff;overflow:hidden}
.about .band p{font:400 clamp(1.35rem,5vw,1.75rem)/1.3 var(--display);margin:0 0 24px;max-width:none;text-wrap:balance}
.about .band p span{color:var(--yel)}
.about .band .stripe{margin:0 -24px;border-radius:0;height:8px}
.about .steps{list-style:none;counter-reset:s;display:grid;gap:12px;margin:1.25rem 0 1.25rem;padding:0}
.about .steps li{counter-increment:s;margin:0;padding:16px 16px 16px 64px;position:relative;border:1px solid var(--line);border-radius:14px}
.about .steps li::before{content:counter(s);position:absolute;left:16px;top:16px;width:32px;height:32px;border-radius:50%;display:grid;place-items:center;background:var(--ink);color:#fff;font:400 1rem/1 var(--display)}
.about .steps li:nth-child(1)::before{background:var(--red);color:#fff}
.about .steps li:nth-child(2)::before{background:var(--yel);color:#000;box-shadow:inset 0 0 0 1px rgba(0,0,0,.25)}
.about .steps li:last-child::before{background:var(--grn);color:#000}
.about .steps p{margin:0;font-size:.95rem;color:var(--muted)}
.about .note{padding:14px 16px;border-left:4px solid var(--red);background:var(--surface);border-radius:0 12px 12px 0}
.about .cards{display:grid;gap:12px;margin:1.25rem 0 0}
.about .card2{display:block;padding:16px;border:1px solid var(--line);border-radius:14px;color:inherit;text-decoration:none}
.about a.card2:hover{border-color:var(--ink)}
.about .card2 small{display:block;font-size:.75rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}
.about .card2 strong{display:block;margin-top:4px;font-weight:700;overflow-wrap:anywhere}
.about .card2 span{display:block;margin-top:4px;font-size:.9rem;color:var(--muted)}
.about .rights{margin:0 0 1.25rem;padding:0;border-top:1px solid var(--line)}
.about .rights dt{margin:0;padding:12px 0 2px;font-weight:700;line-height:1.4}
.about .rights dd{margin:0;padding:0 0 12px;border-bottom:1px solid var(--line);line-height:1.6;color:var(--muted);max-width:62ch}
.about .plain{list-style:disc;margin:0 0 1rem;padding-left:1.2rem;max-width:62ch}
.about .plain li::marker{color:var(--muted)}
.about .plain li{margin:0 0 .45rem}
.about .refs{list-style:none;margin:0;padding:0;font-size:.92rem;color:var(--muted)}
.about .refs li{margin:0 0 .55rem;padding-left:1rem;text-indent:-1rem}
.about .updated{margin:0 0 2rem;font-size:.82rem;color:var(--muted)}
@media (min-width:640px){
.about .facts{grid-template-columns:repeat(4,1fr)}
.about .steps{grid-template-columns:repeat(3,1fr)}
.about .steps li{padding:64px 16px 16px}
.about .cards{grid-template-columns:1fr 1fr}
.about .band{padding:40px 40px 0}
.about .band .stripe{margin:0 -40px}
}
</style>`;

const JSONLD = JSON.stringify({
  "@context": "https://schema.org",
  "@type": "Dataset",
  name: "Paite Daily: a Paite–English verified corpus",
  description:
    "A volunteer-reviewed corpus of aligned Paite–English sentence pairs. Every pair is checked by a native speaker before publication. Each pair is CC0 1.0 or CC BY 4.0, as its licence field says.",
  url: "https://paite.lamkalabs.com/",
  license: ["https://creativecommons.org/licenses/by/4.0/", "https://creativecommons.org/publicdomain/zero/1.0/"],
  sameAs: [
    "https://github.com/khooptong-sudo/paite-open-language-data",
    "https://huggingface.co/datasets/LamkaLabs/paite-open-language-data",
    "https://doi.org/10.5281/zenodo.23349155",
  ],
  distribution: [
    { "@type": "DataDownload", encodingFormat: "application/jsonl", contentUrl: "https://github.com/khooptong-sudo/paite-open-language-data/tree/master/community" },
  ],
  isAccessibleForFree: true,
  inLanguage: "pck",
  creator: { "@type": "Organization", name: "Lamka Labs", url: "https://lamkalabs.com" },
  keywords: ["Paite", "pck", "Tibeto-Burman", "parallel corpus", "language documentation", "Manipur"],
  spatialCoverage: { "@type": "Place", name: "Churachandpur, Manipur, India" },
});

export function renderAbout(publicWiki = false): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${TITLE}</title>
<meta name="theme-color" content="#f5f1e8">
<meta name="description" content="${DESC}">
<link rel="canonical" href="${CANON}">
<meta property="og:site_name" content="Paite Daily">
<meta property="og:type" content="website">
<meta property="og:locale" content="en_IN">
<meta property="og:url" content="${CANON}">
<meta property="og:title" content="${TITLE}">
<meta property="og:description" content="${DESC}">
<meta property="og:image" content="https://paite.lamkalabs.com/og.png?v=2">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="Paite Daily: a Paite–English corpus, verified by native speakers.">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${TITLE}">
<meta name="twitter:description" content="${DESC}">
<meta name="twitter:image" content="https://paite.lamkalabs.com/og.png?v=2">
<meta name="twitter:image:alt" content="Paite Daily: a Paite–English corpus, verified by native speakers.">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
<link rel="icon" href="/favicon.ico" sizes="32x32">
<link rel="icon" href="/icons/emblem-small.svg" type="image/svg+xml">
<link rel="icon" href="/icons/icon-192.png" sizes="192x192">
<script type="application/ld+json">${JSONLD}</script>
<script>document.documentElement.className="js"</script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Young+Serif&family=Instrument+Serif:ital@1&family=Inter:wght@400;600;700&display=swap">
<link rel="stylesheet" href="/style.css">
<script src="/theme.js"></script>
<link rel="stylesheet" href="/contributors.css">
${STYLE}
</head>
<body class="cp blue">
<header class="hero"><div class="hero-nav"><a class="back" href="/" data-back><span aria-hidden="true">&larr;</span> Back</a><a class="back" href="/glossary">Word list <span aria-hidden="true">&rarr;</span></a></div><h1>About Paite Daily</h1><p>A free, volunteer-checked corpus of Paite.</p></header>
<main class="gl about">

<div>
<p class="lead"><strong>Paite Daily</strong> is a free corpus of <strong>Paite</strong>: a growing collection of everyday sentences in Paite and English. People who speak Paite send in the translations. Each translation is checked by a second person before it goes on the site.</p>
<p>No computer writes the Paite here. Every line was written by one person and checked by another.</p>
</div>

<ul class="facts" aria-label="Paite at a glance">
<li style="--c:var(--red)"><b>78,725</b><span>people whose mother tongue is Paite (Census of India, 2011)</span></li>
<li style="--c:var(--yel)"><b>1903</b><span>the year the Paite alphabet was made</span></li>
<li style="--c:var(--grn)"><b>2004</b><span>Paite became a degree subject at Manipur University</span></li>
<li style="--c:var(--ink)"><b>Free</b><span>every checked sentence is free for anyone to use</span></li>
</ul>

<section aria-labelledby="people">
<p class="kicker"><b>01</b> The people</p>
<h2 id="people">Who the Paites are</h2>
<p>The name <em>Paite</em> means “the people who marched”. It comes from <em>pai</em> (to march) and <em>te</em> (people, more than one).</p>
<p>The Paites are one of the Zo (Zomi) peoples who live where India, Myanmar and Bangladesh meet. They are a recognised tribe in Manipur and in Mizoram. Most Paites live in Manipur. In Lamka, the main town of Churachandpur district, Paite is what you hear on the street and in the market.</p>
<p>Paites started reading and writing early. Missionaries came in the 1800s, and schools and books came with them. That is why a language with about 79,000 speakers already has dictionaries, a grammar book, a university course and a daily radio programme.</p>
<p>Sayings, songs and old stories are still passed on by word of mouth. The <em>pau upa</em> part of this site collects the sayings.</p>
</section>

<section aria-labelledby="language">
<p class="kicker"><b>02</b> The language</p>
<h2 id="language">What Paite is</h2>
<p>Paite is an independent Tibeto-Burman language: a language of its own, from the same big family as Burmese and Tibetan. Most speakers live in Churachandpur district, Manipur. There are also Paite communities in Mizoram and Assam, and Paite families in Myanmar. The 2011 Census of India counted <strong>78,725 people whose mother tongue is Paite</strong>.</p>
<p>Paite is a non-scheduled language of India, which means it is not on the Constitution’s list of official languages. Even so, All India Radio Imphal broadcasts in Paite every day. People have been writing Paite for more than a hundred years:</p>
<ol class="timeline">
<li style="--c:var(--red)"><time>1903</time>T. Vialphung makes the <em>Paite Laimal</em>, the Paite alphabet.</li>
<li style="--c:var(--yel)"><time>1945</time>The alphabet is printed in <em>Sintung Bu</em>.</li>
<li style="--c:var(--grn)"><time>1993</time>The Paite Tribe Council publishes its <em>English–Paite Dictionary</em>. New editions follow in 2003 and 2014.</li>
<li style="--c:var(--red)"><time>2004</time>On 22 April, Manipur University makes Paite a subject in its three-year degree course.</li>
<li style="--c:var(--yel)"><time>2006</time>Naorem Saratchandra Singh writes <em>A Grammar of Paite</em>, still the only full grammar book.</li>
<li style="--c:var(--grn)"><time>2009</time>T. Thuamkhopau writes down Paite sayings in <em>Paite paunaak leh pau upate</em>.</li>
<li style="--c:var(--ink)"><time>2011</time>The Census of India counts 78,725 speakers.</li>
</ol>
</section>

<div class="band" role="note">
<p>Paite has an alphabet, dictionaries, a grammar book and a radio programme. <span>What it does not have is a corpus: a big, open collection of its sentences.</span></p>
<div class="stripe" aria-hidden="true"></div>
</div>

<section aria-labelledby="why">
<p class="kicker"><b>03</b> The gap</p>
<h2 id="why">Why this site exists</h2>
<p>You can write Paite on paper, but phones and computers do not help you with it. There is no spellchecker for Paite, no keyboard that guesses your next word, and no translation app.</p>
<p>Tools like these are built from many sentences written in two languages side by side, so a computer can learn from them. For Paite, nobody has gathered those sentences yet. This site is gathering them.</p>
<p class="note">So the problem is not a lack of speakers. Paite has plenty of those. It just needs its sentences written down in a form a computer can use, and that is something we can fix together.</p>
</section>

<section aria-labelledby="verify">
<p class="kicker"><b>04</b> How it works</p>
<h2 id="verify">How a sentence gets checked</h2>
<ol class="steps">
<li><h3>You send it</h3><p>You translate a sentence and say whether it is how people talk (<em>Gen Thoh</em>), how people write (<em>Gelh Thoh</em>), or both (<em>Anih In</em>). A quick check stops robots from sending answers.</p></li>
<li><h3>A reviewer checks it</h3><p>Another Paite speaker reads your translation and compares it with the original. Nothing goes on the site before this check.</p></li>
<li><h3>It joins the collection</h3><p>Once approved, your sentence joins the checked sentences, and it can be shown to the next person who comes to translate.</p></li>
</ol>
<p>Sayings and idioms (<em>pau upa</em>) are checked the same way, in both directions. A reviewer approves each one before anyone sees it. No computer writes our Paite, and no computer decides what good Paite is.</p>

<h3 style="margin-top:2rem">Where AI helps</h3>
<p>We do use an AI program (DeepSeek) behind the scenes. Part of what the coffee button pays for is this AI. It never writes, corrects or approves Paite. This is what it does:</p>
<ul class="plain">
<li>It suggests new everyday English sentences for people to translate.</li>
<li>It leaves reviewers a short note on each answer. Reviewers can ignore it.</li>
<li>It runs the Check English button. That button only suggests a fix; nothing changes until you tap Use this.</li>
<li>It picks out words for the word list from the notes people write, but only words that are in their checked Paite. Reviewers fix or hide any that are wrong.</li>
<li>In the chat, it reads the English you type and finds the checked Paite line that means the same, if there is one. The Paite you see is always the checked Paite, word for word.</li>
<li>If there is no match and you ask for that line to be added, it makes sure your line is clear everyday English before it goes to people to translate.</li>
</ul>

<h3 style="margin-top:2rem">What we count</h3>
<p>To see whether the site is reaching people, it counts visits itself. There are no cookies, and no outside company sees anything. It notes:</p>
<ul class="plain">
<li>which page you opened, and which site or app the link came from;</li>
<li>your device and browser and their versions, and the make of your phone;</li>
<li>your language and time zone, your screen size and sharpness, whether you use the dark or light look, and your connection type;</li>
<li>how fast the page loaded and how far down you read;</li>
<li>your region (we name a town only once two or more people have come from it);</li>
<li>what you did, such as sending an answer or opening a link to another site.</li>
</ul>
<p>A phone model, a network such as Jio or Airtel, and a time zone are also shown only once two or more people share them. We never collect anything you type. We do not keep your IP address. Each person is counted with a code that changes every day, so nobody can be followed from one day to the next. If your browser asks sites not to track you, you are not counted at all. Visits are deleted after 30 days; only the daily totals are kept.</p>
${publicWiki ? `<h3 style="margin-top:2rem">Tongdot | Tongsan and the Paite Wiki</h3><p>In the chat you can also ask about Paite words, sayings, culture or history. The answer is written in English, using only the Paite Wiki: our checked sayings, word list and sentences, plus books and articles that reviewers have approved. The AI writes only English. Any Paite in an answer is copied word for word from a source, and the site checks every quote against that source before you see it. If a check fails, you get no answer rather than a wrong one. Every answer shows where it came from, and you can tell us if it was wrong. The same rules apply to the articles on the <a href="/wiki">Paite Wiki</a>, and a reviewer checks each article before it goes up. <a href="/wiki/how">How the Paite Wiki works</a>.</p>` : ""}
</section>

<section aria-labelledby="open">
<p class="kicker"><b>05</b> Open data</p>
<h2 id="open">Free to use, and safe if this site ever stops</h2>
<p>All of it is kept in two public places on GitHub. Every night, the site copies its newly checked sentences and voice recordings to the first one. The second one holds the code that runs this site.</p>
<div class="cards">
<a class="card2" href="https://github.com/khooptong-sudo/paite-open-language-data" target="_blank" rel="noopener"><small>The sentences, on GitHub</small><strong>khooptong-sudo/paite-open-language-data</strong><span>The checked sentences and voice recordings from this site, along with the Paite Bible, the checked word list, corrections and files ready for training translation tools.</span></a>
<a class="card2" href="https://github.com/khooptong-sudo/paite-daily" target="_blank" rel="noopener"><small>The code, on GitHub</small><strong>khooptong-sudo/paite-daily</strong><span>Everything that runs this site. Free to reuse under the MIT or Apache 2.0 licence, whichever you prefer.</span></a>
<a class="card2" href="https://huggingface.co/datasets/LamkaLabs/paite-open-language-data" target="_blank" rel="noopener"><small>The same sentences, on Hugging Face</small><strong>LamkaLabs/paite-open-language-data</strong><span>Copied from GitHub every Monday, for people who build AI tools.</span></a>
<a class="card2" href="https://doi.org/10.5281/zenodo.23349155" target="_blank" rel="noopener"><small>Saved releases on Zenodo</small><strong>doi.org/10.5281/zenodo.23349155</strong><span>A permanent link you can cite. It always points to the newest release (now v1.2.0).</span></a>
</div>

<h3 id="rights" style="margin-top:2rem">What you may do with each part</h3>
<p>Different parts have different rules. The <a href="https://github.com/khooptong-sudo/paite-open-language-data/blob/master/LICENSE" target="_blank" rel="noopener">LICENSE file</a> on GitHub has the full details. In short:</p>
<dl class="rights">
<dt>Checked sentences from this site <code>community/</code></dt>
<dd>Each sentence is marked with its licence. Sentences sent before 21 October 2026, 18:47 UTC, when the form said “public domain”, are <a href="https://creativecommons.org/publicdomain/zero/1.0/" target="_blank" rel="noopener">CC0 1.0</a>: anyone can use them for anything, with no conditions. Sentences sent since then are <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>: anyone can use them for anything, even to make money, as long as they give credit.</dd>
<dt>Voice recordings <code>audio/</code></dt>
<dd>People reading checked Paite lines aloud. Each speaker agreed to CC BY 4.0 before recording, and a reviewer listened to every recording first. The file <code>audio/recordings.jsonl</code> lists each recording’s line and speaker.</dd>
<dt>Corrections, grammar notes and guides</dt>
<dd>CC BY 4.0.</dd>
<dt>Paite Bible <code>bible/laisiangthou/</code></dt>
<dd>The Laisiangthou translation by John Samte, shared with his permission. Credit John Samte, and ask him first before using it to make money.</dd>
<dt>English Bible <code>bible/world-english-bible/</code></dt>
<dd>The World English Bible, which belongs to everyone (public domain).</dd>
<dt>Files for training translation tools <code>training/</code></dt>
<dd>These mix all of the parts above. Each row says which part it came from, so you can see which rules apply.</dd>
<dt>The code of this site</dt>
<dd>Free to reuse under the <a href="https://github.com/khooptong-sudo/paite-daily/blob/main/LICENSE-MIT" target="_blank" rel="noopener">MIT licence</a> or the <a href="https://github.com/khooptong-sudo/paite-daily/blob/main/LICENSE-APACHE" target="_blank" rel="noopener">Apache License 2.0</a>, whichever you prefer. The same goes for the scripts on GitHub.</dd>
</dl>
<p>You could use the sentences to build a Paite keyboard, a spellchecker, a school workbook or a translation app. For the open parts, you do not need to ask us. Just credit “Paite Open Language Data, Lamka Labs” and link to it, or cite the Zenodo link.</p>
<p>The sentences do not depend on this website. They are on GitHub, with copies on Hugging Face and Zenodo. The code is public too, so anyone could run the site again. If this project ever stops, the sentences will still be there.</p>
</section>

<section aria-labelledby="who">
<p class="kicker"><b>06</b> The people behind it</p>
<h2 id="who">Who runs this</h2>
<p>Min Khooptong (<a class="lab" href="https://lamkalabs.com" target="_blank" rel="noopener">Lamka <span>Labs</span></a>) builds and looks after Paite Daily from Lamka, with five volunteer reviewers. It is not a company, and it has no funding. The reviewers give their time for free, and the running costs are paid out of pocket.</p>
<p>This site carries no advertising and never will. Ads on a site for a small language would earn only a few dollars a month, and you would pay for them with your attention.</p>
<p>If you would like to help with the running costs, there is a UPI code at the bottom of the page. It is completely optional.</p>
</section>

<section aria-labelledby="refs">
<p class="kicker"><b>07</b> Sources</p>
<h2 id="refs">References</h2>
<ul class="refs">
<li>Saratchandra Singh, Naorem. 2006. <em>A Grammar of Paite</em>. New Delhi: Mittal Publications.</li>
<li>Paite Tribe Council. 1993, 2003, 2014. <em>English–Paite Dictionary</em>. Lamka, Manipur.</li>
<li>Thuamkhopau, T. 2009. <em>Paite paunaak leh pau upate</em>.</li>
<li>Census of India 2011, language tables (Paite, <code>pck</code>).</li>
</ul>
</section>

<p class="updated">Last updated: 15 November 2026</p>

${FOOTER}
</main>
<script src="/strings.js"></script>
<script src="/back.js"></script>
<script src="/pwa.js"></script>
<script src="/track.js"></script>
</body></html>`;
}
