// The About page. Static prose only: no DB, no session, no Turnstile.
// The shell below is copied from renderGlossary() on purpose: same header, same
// PUAN band, same footer, same font links, so /about cannot drift visually.
// It also carries the Dataset JSON-LD, so the corpus is machine-readable to
// anyone who indexes it (keyboard projects, MT researchers, archive crawlers).
// The section styling borrows the Puandum colours (red, yellow, green, black)
// and the charcoal bands of the shawl itself.
import { FOOTER } from "./footer";
import { PUAN } from "./puan";

const TITLE = "About Paite Daily";
const DESC =
  "Paite Daily is a free, volunteer-reviewed Paite–English corpus. 78,725 speakers, no spellchecker. Every pair is checked by a native speaker and released to the public domain.";
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
.about .facts b{display:block;font:400 1.75rem/1.1 var(--display);color:var(--ink)}
.about .facts span{display:block;margin-top:4px;font-size:.85rem;line-height:1.4;color:var(--muted)}
.about .timeline{list-style:none;margin:1.25rem 0 0;padding:0 0 0 1.4rem;border-left:2px solid var(--ink)}
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
.about .steps li:last-child::before{background:var(--grn);color:#000}
.about .steps p{margin:0;font-size:.95rem;color:var(--muted)}
.about .note{padding:14px 16px;border-left:4px solid var(--red);background:var(--surface);border-radius:0 12px 12px 0}
.about .cards{display:grid;gap:12px;margin:1.25rem 0 0}
.about .card2{display:block;padding:16px;border:1px solid var(--line);border-radius:14px;color:inherit;text-decoration:none}
.about a.card2:hover{border-color:var(--ink)}
.about .card2 small{display:block;font-size:.75rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}
.about .card2 strong{display:block;margin-top:4px;font-weight:700;overflow-wrap:anywhere}
.about .card2 span{display:block;margin-top:4px;font-size:.9rem;color:var(--muted)}
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
    "A volunteer-reviewed corpus of aligned Paite–English sentence pairs, proverbs and idioms. Every pair is checked by a native speaker before publication and released to the public domain (CC0).",
  url: "https://paite.lamkalabs.com/",
  license: "https://creativecommons.org/publicdomain/zero/1.0/",
  isAccessibleForFree: true,
  inLanguage: "pck",
  creator: { "@type": "Organization", name: "Lamka Labs", url: "https://lamkalabs.com" },
  keywords: ["Paite", "pck", "Tibeto-Burman", "parallel corpus", "language documentation", "Manipur"],
  spatialCoverage: { "@type": "Place", name: "Churachandpur, Manipur, India" },
});

export function renderAbout(): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${TITLE}</title>
<meta name="theme-color" content="#ffffff">
<meta name="description" content="${DESC}">
<link rel="canonical" href="${CANON}">
<meta property="og:site_name" content="Paite Daily">
<meta property="og:type" content="website">
<meta property="og:locale" content="en_IN">
<meta property="og:url" content="${CANON}">
<meta property="og:title" content="${TITLE}">
<meta property="og:description" content="${DESC}">
<meta property="og:image" content="https://paite.lamkalabs.com/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="Paite Daily: a Paite–English corpus, verified by native speakers.">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${TITLE}">
<meta name="twitter:description" content="${DESC}">
<meta name="twitter:image" content="https://paite.lamkalabs.com/og.png">
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
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Young+Serif&family=Atkinson+Hyperlegible:wght@400;700&display=swap">
<link rel="stylesheet" href="/style.css">
<link rel="stylesheet" href="/contributors.css">
${STYLE}
</head>
<body class="cp">
<header class="hero"><div class="hero-nav"><a class="back" href="/" data-back><span aria-hidden="true">&larr;</span> Back</a><a class="back" href="/glossary">Word list <span aria-hidden="true">&rarr;</span></a></div>${PUAN}<h1>About Paite Daily</h1><p>A free, volunteer-reviewed corpus of Paite.</p></header>
<main class="gl about">

<div>
<p class="lead"><strong>Paite Daily</strong> is a free, volunteer-run corpus of <strong>Paite</strong> (ISO 639-3: <code>pck</code>). Speakers send in Paite–English translations. A second person reviews each one. Only reviewed pairs appear on the site.</p>
<p>Nothing here is machine-generated. One person wrote every line, and another person approved it.</p>
</div>

<ul class="facts" aria-label="Paite at a glance">
<li style="--c:var(--red)"><b>78,725</b><span>mother-tongue speakers, Census of India 2011</span></li>
<li style="--c:var(--yel)"><b>1903</b><span>year the Paite Laimal alphabet was devised</span></li>
<li style="--c:var(--grn)"><b>2004</b><span>Paite approved as a Manipur University degree subject</span></li>
<li style="--c:var(--ink)"><b>CC0</b><span>every verified pair is in the public domain</span></li>
</ul>

<section aria-labelledby="people">
<p class="kicker"><b>01</b> The people</p>
<h2 id="people">Who the Paites are</h2>
<p>The word <em>Paite</em> means “the people who marched”. It joins <em>pai</em> (to march) and <em>te</em> (the plural marker).</p>
<p>The Paites are one of the Zo (Zomi) peoples of the India–Myanmar–Bangladesh borderlands. They are a recognised Scheduled Tribe in Manipur and in Mizoram. Most Paites live in Manipur. In Lamka, the main town of Churachandpur district, they are the dominant community. There, Paite is the everyday language of the street and the market.</p>
<p>The community took to print early. British missionaries brought Christianity in the nineteenth century. Schools, literacy and the written word followed, and they stayed. That is why a language of about 79,000 speakers has three dictionary editions, a reference grammar, a degree course and a daily radio broadcast.</p>
<p>Proverbs, folksongs and folktales still pass from speaker to speaker by word of mouth. The <em>pau upa</em> section of this site collects the proverbs and idioms.</p>
</section>

<section aria-labelledby="language">
<p class="kicker"><b>02</b> The language</p>
<h2 id="language">What Paite is</h2>
<p>Paite is an independent Tibeto-Burman language. People speak it mainly in Churachandpur district of Manipur. There are also Paite communities in Mizoram and Assam, and Paite families in Myanmar. The 2011 Census of India records <strong>78,725 people whose mother tongue is Paite</strong>.</p>
<p>Paite is a non-scheduled language of India. All India Radio Imphal broadcasts in Paite every day. The language also has more than a century of written work behind it:</p>
<ol class="timeline">
<li style="--c:var(--red)"><time>1903</time>T. Vialphung devises the <em>Paite Laimal</em>, the Paite alphabet.</li>
<li style="--c:var(--yel)"><time>1945</time>The Laimal is published in <em>Sintung Bu</em>.</li>
<li style="--c:var(--grn)"><time>1993</time>The Paite Tribe Council publishes its <em>English–Paite Dictionary</em>, after a century of word books. New editions follow in 2003 and 2014.</li>
<li style="--c:var(--red)"><time>2004</time>On 22 April, the Academic Council of Manipur University approves Paite as a modern Indian language subject for the three-year degree course.</li>
<li style="--c:var(--yel)"><time>2006</time>Naorem Saratchandra Singh publishes <em>A Grammar of Paite</em> (Mittal), the one book-length reference grammar.</li>
<li style="--c:var(--grn)"><time>2009</time>T. Thuamkhopau records Paite proverbs in <em>Paite paunaak leh pau upate</em>.</li>
<li style="--c:var(--ink)"><time>2011</time>The Census of India counts 78,725 speakers.</li>
</ol>
</section>

<div class="band" role="note">
<p>Paite has an alphabet, dictionaries, a grammar and a radio service. <span>What it does not have is a corpus.</span></p>
<div class="stripe" aria-hidden="true"></div>
</div>

<section aria-labelledby="why">
<p class="kicker"><b>03</b> The gap</p>
<h2 id="why">Why this site exists</h2>
<p>Paite life is well written down. The language itself is not in a machine. A speaker can write a Paite sentence by hand, but not easily on a phone. There is no spellchecker, no predictive keyboard, no parallel text and no machine translation.</p>
<p>All of these tools are built from aligned sentences that a computer can read. For Paite, nobody has assembled those sentences yet.</p>
<p class="note">That is the whole gap. Paite does not lack speakers. It lacks sentences in a form a computer can read. About 79,000 speakers and no spellchecker is a problem we can fix, not a tragedy.</p>
</section>

<section aria-labelledby="verify">
<p class="kicker"><b>04</b> The method</p>
<h2 id="verify">How a sentence gets verified</h2>
<ol class="steps">
<li><h3>Submit</h3><p>A speaker sends a translation and tags it <em>Gen Thoh</em> (spoken), <em>Gelh Thoh</em> (written) or <em>Anih In</em> (both). A bot check guards the form.</p></li>
<li><h3>Review</h3><p>A reviewer checks the translation against the source. The site never shows an unreviewed submission as an answer.</p></li>
<li><h3>Publish</h3><p>The approved pair joins the pool of verified sentences. Only then does it become a prompt for the next learner.</p></li>
</ol>
<p>Proverbs and idioms (<em>pau upa</em>) go through the same loop, in both directions, with a stricter rule: two reviewers must approve each one. Nothing is published without review. No model writes our data, and no model decides what counts as correct Paite.</p>
</section>

<section aria-labelledby="open">
<p class="kicker"><b>05</b> Open data</p>
<h2 id="open">Public domain, and built to outlast this site</h2>
<p>Every verified pair is dedicated to the public domain under CC0. This is not “free to use with attribution”. It is public domain, and the dedication cannot be withdrawn.</p>
<p>Use the data for a Paite keyboard dictionary, a spellchecker, a concordance, a school workbook or a translation model. You do not need to ask us. You do not need to credit us. We chose this on purpose: people ignore a corpus that needs permission, and an ignored corpus dies with its website.</p>
<div class="cards">
<a class="card2" href="https://github.com/khooptong-sudo/paite-open-language-data" target="_blank" rel="noopener"><small>Data on GitHub</small><strong>khooptong-sudo/paite-open-language-data</strong><span>The verified corpus, the open Paite&ndash;English dictionary and other Paite text.</span></a>
<a class="card2" href="https://doi.org/10.5281/zenodo.23349156" target="_blank" rel="noopener"><small>Citable releases on Zenodo</small><strong>doi.org/10.5281/zenodo.23349156</strong><span>Versioned deposits, starting with v1.0.0.</span></a>
</div>
<p style="margin-top:1rem">The site is a static export. Anyone can fork it and host it again for the price of a domain. If this project stops, the sentences do not.</p>
</section>

<section aria-labelledby="who">
<p class="kicker"><b>06</b> The people behind it</p>
<h2 id="who">Who runs this</h2>
<p>Min Khooptong (<a class="lab" href="https://lamkalabs.com" target="_blank" rel="noopener">Lamka <span>Labs</span></a>) builds and maintains Paite Daily in Lamka, with 5 volunteer reviewers. It is not a company, and it has no funding. Reviewers give their time for free, and hosting is paid out of pocket.</p>
<p>This site carries no advertising and never will. Ads on a page about a 79,000-speaker language would earn a few dollars a month at best. The reader’s attention would pay for them, not people who care about Paite.</p>
<p>If you want to help with running costs, there is a UPI code in the footer. It is entirely optional.</p>
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

<p class="updated">Last updated: 21 October 2026</p>

${FOOTER}
</main>
<script src="/strings.js"></script>
<script src="/back.js"></script>
<script src="/pwa.js"></script>
<script src="/track.js"></script>
</body></html>`;
}
