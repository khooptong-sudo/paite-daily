import type { Env } from "./types";

export type Contributors = {
  contributors: { name: string; verified: number; reviewer: boolean }[];
  reviewers: { name: string; decisions: number }[];
};

const byCountThenName = <T extends { name: string }>(key: (x: T) => number) => (a: T, b: T) => key(b) - key(a) || a.name.localeCompare(b.name);

export async function getContributors(env: Env): Promise<Contributors> {
  const c = await env.DB.prepare(
    `SELECT n.name, n.verified, EXISTS (SELECT 1 FROM reviewer_phones r WHERE r.phone_id = n.phone_id) AS reviewer FROM (
       SELECT a.phone_id, COUNT(*) AS verified,
         (SELECT b.contributor_name FROM answers b WHERE b.phone_id = a.phone_id AND TRIM(COALESCE(b.contributor_name, '')) <> '' ORDER BY b.id DESC LIMIT 1) AS name
       FROM answers a WHERE a.status IN ('accepted', 'also_correct') GROUP BY a.phone_id
     ) n WHERE n.name IS NOT NULL`,
  ).all<{ name: string; verified: number; reviewer: number }>();
  const counts = await env.DB.prepare("SELECT lower(reviewer_email) AS email, COUNT(*) AS n FROM reviews WHERE undone_at IS NULL GROUP BY 1")
    .all<{ email: string; n: number }>();
  const done = new Map(counts.results.map((r) => [r.email, r.n]));
  let map: Record<string, string> = {};
  try { map = JSON.parse(env.REVIEWERS); } catch {}
  return {
    contributors: c.results.map((r) => ({ name: r.name, verified: r.verified, reviewer: r.reviewer === 1 })).sort(byCountThenName((x) => x.verified)),
    reviewers: Object.entries(map).map(([email, name]) => ({ name, decisions: done.get(email.toLowerCase()) ?? 0 })).sort(byCountThenName((x) => x.decisions)),
  };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const mdEsc = (s: string) => s.replace(/[\\`*_{}\[\]()#+\-.!|<>~&]/g, "\\$&").replace(/\s+/g, " ");

export function renderPage(d: Contributors): string {
  const badge = ' <span class="badge" data-s="reviewerBadge">Reviewer</span>';
  const li = (name: string, n: number, b: boolean) => `<li><span>${esc(name)}${b ? badge : ""}</span> <b>${n}</b> <small data-s="sentences">sentences</small></li>`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Paite contributors</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Young+Serif&family=Atkinson+Hyperlegible:wght@400;700&display=swap">
<link rel="stylesheet" href="/style.css"></head>
<body><main>
<header><h1 data-s="contributorsTitle">Paite contributors</h1></header>
<section class="card"><ul>${d.contributors.map((c) => li(c.name, c.verified, c.reviewer)).join("")}</ul></section>
<section class="card"><div class="label" data-s="reviewerBadge">Reviewer</div><ul>${d.reviewers.map((r) => li(r.name, r.decisions, true)).join("")}</ul></section>
<p><a href="/">Paite Daily</a></p>
</main>
<script src="/strings.js"></script>
<script>document.querySelectorAll("[data-s]").forEach(function(e){var s=window.STRINGS[e.dataset.s];if(s&&s.pai)e.innerHTML=s.pai+"<small> "+s.en+"</small>";});</script>
</body></html>`;
}

export function renderMarkdown(d: Contributors): string {
  const rows = (xs: { name: string; n: number }[]) => xs.map((x) => `- ${mdEsc(x.name)}: ${x.n}`).join("\n") || "_None yet._";
  return `# Paite contributors\n\n## Contributors (verified sentences)\n\n${rows(d.contributors.map((c) => ({ name: c.name + (c.reviewer ? " (reviewer)" : ""), n: c.verified })))}\n\n## Reviewers (decisions)\n\n${rows(d.reviewers.map((r) => ({ name: r.name, n: r.decisions })))}\n`;
}
