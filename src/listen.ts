import { esc } from "./contributors";
import { FOOTER } from "./footer";
import type { Env } from "./types";

export type Clip = { id: number; paite: string; english: string; readBy: string | null };

/** Every accepted recording, newest first. Reads recordings by (status, id) and joins sentences by primary key. */
export async function getClips(env: Env): Promise<Clip[]> {
  const { results } = await env.DB.prepare(
    `SELECT r.id, r.paite, s.english, nullif(trim(r.contributor_name), '') AS readBy
     FROM recordings r JOIN sentences s ON s.id = r.sentence_id WHERE r.status = 'accepted' ORDER BY r.id DESC`,
  ).all<Clip>();
  return results;
}

export function renderListen(clips: Clip[]): string {
  const item = (c: Clip) => `<li><b class="w" lang="pck">${esc(c.paite)}</b><p class="m">${esc(c.english)}</p><span class="play-row"><button type="button" class="play" data-audio="${c.id}" aria-label="Listen"></button>${c.readBy ? `<span class="by-line">Read by ${esc(c.readBy)}</span>` : ""}</span></li>`;
  const body = clips.length ? `<section class="so"><ul class="rows">${clips.map(item).join("")}</ul></section>` : '<p class="empty">No recordings yet.</p>';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Listen · Paite Daily</title>
<meta name="theme-color" content="#f5f1e8">
<link rel="canonical" href="https://paite.lamkalabs.com/listen">
<meta property="og:site_name" content="Paite Daily">
<meta property="og:type" content="website">
<meta property="og:locale" content="en_IN">
<meta property="og:url" content="https://paite.lamkalabs.com/listen">
<meta property="og:title" content="Listen · Paite Daily">
<meta property="og:description" content="Checked Paite lines, read aloud by the people who wrote and checked them.">
<meta property="og:image" content="https://paite.lamkalabs.com/og.png?v=2">
<meta name="twitter:card" content="summary_large_image">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
<link rel="icon" href="/favicon.ico" sizes="32x32">
<link rel="icon" href="/icons/emblem-small.svg" type="image/svg+xml">
<script>document.documentElement.className="js"</script>
<link rel="preload" href="/fonts/youngserif-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/instrumentserif-italic-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/inter-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/fonts.css">
<link rel="stylesheet" href="/style.css">
<script src="/theme.js"></script>
<link rel="stylesheet" href="/contributors.css">
</head>
<body class="cp blue">
<header class="hero"><div class="hero-nav"><a class="back" href="/" data-back><span aria-hidden="true">&larr;</span> Back</a></div><h1>Listen</h1><p>Checked Paite lines, read aloud by the people who wrote and checked them. Tap to listen.</p></header>
<main class="gl">
${body}
<a class="cta" href="/"><span>Paite Daily<small data-s="addSentence">Add a Sentence</small></span><span class="go" aria-hidden="true">&rarr;</span></a>
<p class="licence">Recordings are shared under CC BY 4.0.</p>
${FOOTER}
</main>
<script src="/strings.js"></script>
<script src="/play.js"></script>
<script src="/back.js"></script>
<script src="/pwa.js"></script>
<script src="/track.js"></script>
</body></html>`;
}
