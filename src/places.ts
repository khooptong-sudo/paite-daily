import { esc } from "./contributors";
import { FOOTER } from "./footer";
import { PUAN } from "./puan";
import { cleanText } from "./text";
import type { Env } from "./types";

// Where you learned it. A contributor may name the village or town their Paite comes from;
// the public sees only how many verified answers each place has given, never who.
// KNOWN places get a dot on the map; any other name is listed under it until its
// coordinates are added here. Coordinates are town centres, rounded.
export const KNOWN: { name: string; lat: number; lng: number; aka?: string[] }[] = [
  { name: "Lamka", lat: 24.33, lng: 93.68, aka: ["churachandpur", "ccpur"] },
  { name: "Imphal", lat: 24.82, lng: 93.94 },
  { name: "Aizawl", lat: 23.73, lng: 92.72 },
  { name: "Champhai", lat: 23.47, lng: 93.33 },
  { name: "Tedim", lat: 23.37, lng: 93.65, aka: ["tiddim"] },
  { name: "Kalay", lat: 23.19, lng: 94.05, aka: ["kalemyo", "kalaymyo"] },
];

/** The place as typed, tidied: a known place by its own name, anything else in title case. Blank is null. */
export function cleanPlace(v: unknown): string | null | undefined {
  if (v === undefined || v === null || (typeof v === "string" && !v.trim())) return null;
  const s = cleanText(v, 60);
  if (!s) return undefined;
  const k = s.toLowerCase();
  const hit = KNOWN.find((p) => p.name.toLowerCase() === k || p.aka?.includes(k));
  return hit ? hit.name : s.replace(/\p{L}+/gu, (w) => w[0].toUpperCase() + w.slice(1));
}

export type PlaceCount = { name: string; n: number; lat?: number; lng?: number };

/** Verified answers per place, most first. */
export async function getPlaces(env: Env): Promise<PlaceCount[]> {
  const { results } = await env.DB.prepare(
    "SELECT place AS name, count(*) AS n FROM answers WHERE place IS NOT NULL AND status IN ('accepted', 'also_correct') GROUP BY place ORDER BY n DESC, place",
  ).all<{ name: string; n: number }>();
  return results.map((r) => { const k = KNOWN.find((p) => p.name === r.name); return k ? { ...r, lat: k.lat, lng: k.lng } : r; });
}

// A plain projected box over the Paite homeland: no tiles, so no outside requests.
const BOX = { w: 340, h: 300, lat0: 22.9, lat1: 25.1, lng0: 92.4, lng1: 94.4 };
const xy = (lat: number, lng: number) => [((lng - BOX.lng0) / (BOX.lng1 - BOX.lng0)) * BOX.w, ((BOX.lat1 - lat) / (BOX.lat1 - BOX.lat0)) * BOX.h];

export function renderPlaces(ps: PlaceCount[]): string {
  const max = Math.max(1, ...ps.map((p) => p.n));
  const onMap = new Map(ps.filter((p) => p.lat !== undefined).map((p) => [p.name, p]));
  const dots = KNOWN.map((k) => {
    const [x, y] = xy(k.lat, k.lng), p = onMap.get(k.name), r = p ? 6 + 18 * Math.sqrt(p.n / max) : 3;
    return `<g class="${p ? "on" : "off"}"><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(1)}"/><text x="${(x + r + 4).toFixed(1)}" y="${(y + 4).toFixed(1)}">${esc(k.name)}${p ? ` · ${p.n}` : ""}</text></g>`;
  }).join("");
  const rows = ps.map((p) => `<li><b>${esc(p.name)}</b><span>${p.n}</span></li>`).join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Where Paite Comes From · Paite Daily</title>
<meta name="description" content="The villages and towns where Paite Daily contributors learned their Paite, counted by verified translations.">
<link rel="canonical" href="https://paite.lamkalabs.com/places">
<link rel="icon" href="/favicon.ico" sizes="32x32">
<link rel="icon" href="/icons/emblem-small.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Young+Serif&family=Inter:wght@400;500;600;700&display=swap">
<link rel="stylesheet" href="/style.css">
<link rel="stylesheet" href="/contributors.css">
<style>
.map{width:100%;height:auto;display:block;background:linear-gradient(180deg,#eef3ff,#f7f9ff);border:1px solid var(--line);border-radius:16px}
.map .grid{stroke:rgba(11,20,48,.08);stroke-width:1}
.map .on circle{fill:rgba(11,75,255,.25);stroke:#0b4bff;stroke-width:2}
.map .off circle{fill:rgba(11,20,48,.25)}
.map text{font:600 11px var(--body);fill:var(--fg)}
.map .off text{fill:var(--muted);font-weight:400}
.places{list-style:none;margin:0;padding:0;display:grid;gap:8px}
.places li{display:flex;justify-content:space-between;gap:12px;border-top:1px solid var(--line);padding-top:8px}
.places li:first-child{border-top:0;padding-top:0}
.places span{font-variant-numeric:tabular-nums;color:var(--muted)}
</style>
</head>
<body class="cp blue">
<header class="hero"><div class="hero-nav"><a class="back" href="/" data-back><span aria-hidden="true">&larr;</span> Back</a><a class="back" href="/contributors">Contributors <span aria-hidden="true">&rarr;</span></a></div>${PUAN}<h1>Where Paite Comes From</h1><p>The villages and towns where our contributors learned their Paite, counted by verified translations.</p></header>
<main class="gl">
<svg class="map" viewBox="0 0 ${BOX.w + 80} ${BOX.h}" role="img" aria-label="Places by number of verified translations">${[1, 2, 3].map((i) => `<line class="grid" x1="0" x2="${BOX.w + 80}" y1="${(BOX.h * i) / 4}" y2="${(BOX.h * i) / 4}"/><line class="grid" y1="0" y2="${BOX.h}" x1="${(BOX.w * i) / 4}" x2="${(BOX.w * i) / 4}"/>`).join("")}${dots}</svg>
${ps.length ? `<ol class="places">${rows}</ol>` : '<p class="empty">No places yet. Add yours with your next translation on the front page.</p>'}
<p class="licence">Only verified translations count, and a place is never shown beside a name. Places without a dot are listed until we add them to the map.</p>
${FOOTER}
</main>
<script src="/back.js"></script>
<script src="/track.js"></script>
</body>
</html>`;
}
