// The About page. Static prose only: no DB, no session, no Turnstile.
// The shell below is copied from renderGlossary() on purpose: same header, same
// PUAN band, same footer, same font links, so /about cannot drift visually.
// It also carries the Dataset JSON-LD, so the corpus is machine-readable to
// anyone who indexes it (keyboard projects, MT researchers, archive crawlers).
import { FOOTER } from "./footer";
import { PUAN } from "./puan";

const TITLE = "About Paite Daily";
const DESC =
  "Paite Daily is a free, volunteer-reviewed Paite–English corpus. 78,725 speakers, no spellchecker. Every pair is checked by a native speaker and released to the public domain.";
const CANON = "https://paite.lamkalabs.com/about";

// Scoped to this page only, so no shared stylesheet is touched.
const STYLE = `<style>
.about{max-width:44rem}
.about h2{font:400 1.35rem/1.25 var(--head,inherit);margin:2.2rem 0 .6rem}
.about h2:first-of-type{margin-top:.4rem}
.about p,.about li{line-height:1.62}
.about p{margin:0 0 .9rem}
.about ul,.about ol{margin:0 0 1rem;padding-left:1.15rem}
.about li{margin:0 0 .45rem}
.about li::marker{color:var(--muted)}
.about code{font:.9em ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--surface);border:1px solid var(--line);border-radius:6px;padding:.08em .38em}
.about em{font-style:italic}
.about .refs{font-size:.92rem;color:var(--muted)}
.about .refs li{margin-bottom:.3rem}
.about .updated{margin-top:2rem;font-size:.82rem;color:var(--muted)}
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

<p><strong>Paite Daily</strong> is a free, volunteer-run corpus of <strong>Paite</strong> (ISO 639-3: <code>pck</code>). It does three things: it shows reviewed Paite–English sentence pairs, it collects new translations from speakers, and a human reviewer checks every one before it appears. Nothing here is machine-generated. Every line comes from a pair that one person wrote and another person approved.</p>

<h2>Who the Paites are</h2>

<p>The word <em>Paite</em> means “the people who marched”. It comes from <em>pai</em>, to march, and <em>te</em>, the plural marker. The Paites are one of the Zo (Zomi) peoples of the India–Myanmar–Bangladesh borderlands, and a recognised Scheduled Tribe in both Manipur and Mizoram. They are concentrated in Manipur, and are the dominant community in Lamka, the town at the heart of Churachandpur district, where Paite is the everyday language of the street and the market.</p>

<p>The community took to print early: Christianity arrived in the nineteenth century through British missionaries, and schooling, literacy and the written word followed and held. That is why a language of fewer than eighty thousand speakers has dictionaries in three editions, a reference grammar, a degree-level curriculum and a daily radio broadcast. Folksongs and folktales still travel by mouth alongside all of it, which is what the <em>pau upa</em> section of this site collects.</p>

<h2>What Paite is</h2>

<p>Paite is an independent Tibeto-Burman language, spoken mainly in Churachandpur district of Manipur, with communities in Mizoram and Assam and among Paite families in Myanmar. The 2011 Census of India records <strong>78,725 people whose mother tongue is Paite</strong>. Paite is a non-scheduled language of India, and one of the modern Indian language subjects approved for the three-year degree course at Manipur University by its Academic Council on 22 April 2004. All India Radio Imphal broadcasts in Paite daily.</p>

<p>Paite has its own alphabet, the <em>Paite Laimal</em>, devised by T. Vialphung in 1903 and published in <em>Sintung Bu</em> in 1945. It has its own dictionary tradition, from the Paite Tribe Council’s <em>English–Paite Dictionary</em> (1993, 2003, 2014) back through a century of word books. It has proverbs, recorded in T. Thuamkhopau’s <em>Paite paunaak leh pau upate</em> (2009), and one book-length reference grammar, Naorem Saratchandra Singh’s <em>A Grammar of Paite</em> (Mittal, 2006).</p>

<p>What it does not have is a corpus.</p>

<h2>Why this site exists</h2>

<p>Every part of Paite life is written down. The language itself is not in a machine. A Paite speaker can write a sentence by hand and cannot write it on a phone: there is no spellchecker, no predictive keyboard, no parallel text and no machine translation, because all of those things are built from aligned, machine-readable sentences. For Paite, those sentences have never been assembled.</p>

<p>That is the whole gap. The shortage is not speakers. It is sentences a computer can read in a row. Seventy-eight thousand speakers and no spellchecker is an addressable problem, not a tragedy.</p>

<h2>How a sentence gets verified</h2>

<ol>
<li>A speaker submits a translation and tags it <em>Gen Thoh</em> (spoken), <em>Gelh Thoh</em> (written) or <em>Anih In</em> (both). Submissions are gated against bots.</li>
<li>A reviewer checks it against the source. Unreviewed submissions are never shown as answers.</li>
<li>Only after review does the pair join the pool of verified sentences. Only then does it become the prompt for the next learner.</li>
</ol>

<p>Proverbs and idioms (<em>pau upa</em>) go through the same loop, in both directions, with the same rule: a reviewer checks each one. Nothing is published unreviewed. No model writes our data, and no model decides what counts as correct Paite.</p>

<h2>What “public domain” means here</h2>

<p>Every verified pair is dedicated to the public domain (CC0). Not “free to use with attribution”. Public domain, irrevocably. If you are building a Paite keyboard dictionary, a spellchecker, a concordance, a school workbook or a translation model, you do not need to ask us and you do not need to credit us. That is deliberate. A corpus that requires permission is a corpus that gets ignored, and a corpus that gets ignored dies with its website.</p>

<h2>Who runs this</h2>

<p>Paite Daily is built and maintained by Min Khooptong (<a class="lab" href="https://lamkalabs.com" target="_blank" rel="noopener">Lamka <span>Labs</span></a>) in Lamka, with 5 volunteer reviewers. It is not a company and it is not funded. Reviewer time is unpaid; hosting is paid out of pocket.</p>

<p>Corrections are welcome and are treated as data, not as complaints. If a pair is wrong, it should be fixed at the source.</p>

<h2>Where the data lives</h2>

<p>The verified corpus is exported and published at <a href="https://github.com/khooptong-sudo/paite-open-language-data" target="_blank" rel="noopener">khooptong-sudo/paite-open-language-data</a>, alongside the open Paite&ndash;English dictionary and other Paite text. Versioned releases are deposited with Zenodo at <a href="https://doi.org/10.5281/zenodo.23349156" target="_blank" rel="noopener">doi.org/10.5281/zenodo.23349156</a> (v1.0.0), so the corpus can be cited. The site itself is a static export and can be forked and rehosted by anyone for the price of a domain. If this project stops, the sentences do not.</p>

<h2>No advertising</h2>

<p>This site carries no advertising and never will. A page about a 79,000-speaker language would earn a few dollars a month at best, and it would be paid for by the reader’s attention rather than by anyone who cares about Paite. Hosting is paid out of pocket. If you would like to contribute to reviewer costs, there is a UPI code in the footer, and it is entirely optional.</p>

<h2>References</h2>

<ul class="refs">
<li>Saratchandra Singh, Naorem. 2006. <em>A Grammar of Paite</em>. New Delhi: Mittal Publications.</li>
<li>Paite Tribe Council. 1993, 2003, 2014. <em>English–Paite Dictionary</em>. Lamka, Manipur.</li>
<li>Thuamkhopau, T. 2009. <em>Paite paunaak leh pau upate</em>.</li>
<li>Census of India 2011, language tables (Paite, <code>pck</code>).</li>
</ul>

<h2>Contact</h2>

<p>Email: <a href="mailto:theconcierge@lamkalabs.com">theconcierge@lamkalabs.com</a><br>
Data, corrections, partnerships and reviewer volunteers: same address.</p>

<p class="updated">Last updated: 21 October 2026</p>

${FOOTER}
</main>
<script src="/strings.js"></script>
<script src="/back.js"></script>
<script src="/pwa.js"></script>
<script src="/track.js"></script>
</body></html>`;
}
