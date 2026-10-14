import type { Env } from "./types";

type Row = { name: string; n: number; badge: Badge; reviewer?: boolean };
export type Badge = null | 10 | 50 | 100 | 500;
export type Contributors = {
  contributors: { name: string; verified: number; weekly: number; badge: Badge; reviewer: boolean }[];
  reviewers: { name: string; decisions: number; weekly: number }[];
  thisWeek: { contributors: Row[]; reviewers: Row[] };
  allTime: { contributors: Row[]; reviewers: Row[] };
};

export const badgeFor = (verified: number): Badge => ([500, 100, 50, 10] as const).find((t) => verified >= t) ?? null;

const byCountThenName = <T extends { name: string }>(key: (x: T) => number) => (a: T, b: T) => key(b) - key(a) || a.name.localeCompare(b.name);

export async function getContributors(env: Env): Promise<Contributors> {
  const c = await env.DB.prepare(
    `SELECT n.name, n.verified, n.weekly, EXISTS (SELECT 1 FROM reviewer_phones r WHERE r.phone_id = n.phone_id) AS reviewer FROM (
       SELECT a.phone_id, COUNT(*) AS verified,
         SUM(EXISTS (SELECT 1 FROM reviews r WHERE r.decision = 'accept' AND r.undone_at IS NULL AND r.created_at >= datetime('now', '-7 days')
           AND a.id IN (SELECT value FROM json_each(COALESCE(r.answer_ids, '[]'))))) AS weekly,
         (SELECT b.contributor_name FROM answers b WHERE b.phone_id = a.phone_id AND TRIM(COALESCE(b.contributor_name, '')) <> '' ORDER BY b.id DESC LIMIT 1) AS name
       FROM answers a WHERE a.status IN ('accepted', 'also_correct') GROUP BY a.phone_id
     ) n WHERE n.name IS NOT NULL`,
  ).all<{ name: string; verified: number; weekly: number; reviewer: number }>();
  const counts = await env.DB.prepare("SELECT lower(reviewer_email) AS email, COUNT(*) AS n, SUM(created_at >= datetime('now', '-7 days')) AS w FROM reviews WHERE undone_at IS NULL GROUP BY 1")
    .all<{ email: string; n: number; w: number }>();
  const done = new Map(counts.results.map((r) => [r.email, r]));
  let map: Record<string, string> = {};
  try { map = JSON.parse(env.REVIEWERS); } catch {}
  const contributors = c.results.map((r) => ({ name: r.name, verified: r.verified, weekly: r.weekly, badge: badgeFor(r.verified), reviewer: r.reviewer === 1 })).sort(byCountThenName((x) => x.verified));
  const reviewers = Object.entries(map).map(([email, name]) => ({ name, decisions: done.get(email.toLowerCase())?.n ?? 0, weekly: done.get(email.toLowerCase())?.w ?? 0 })).sort(byCountThenName((x) => x.decisions));
  const rank = (xs: Row[], keepZero = false) => xs.filter((x) => keepZero || x.n > 0).sort(byCountThenName((x) => x.n));
  const cr = (n: (x: (typeof contributors)[number]) => number) => rank(contributors.map((x) => ({ name: x.name, n: n(x), badge: x.badge, reviewer: x.reviewer })));
  const rr = (n: (x: (typeof reviewers)[number]) => number, keepZero = false) => rank(reviewers.map((x) => ({ name: x.name, n: n(x), badge: null })), keepZero);
  return {
    contributors,
    reviewers,
    thisWeek: { contributors: cr((x) => x.weekly), reviewers: rr((x) => x.weekly) },
    allTime: { contributors: cr((x) => x.verified), reviewers: rr((x) => x.decisions, true) },
  };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const mdEsc = (s: string) => s.replace(/[\\`*_{}\[\]()#+\-.!|<>~&]/g, "\\$&").replace(/\s+/g, " ");

export function renderPage(d: Contributors): string {
  const rev = ' <span class="badge" data-s="reviewerBadge">Reviewer</span>';
  const li = (x: Row, b: boolean) => `<li><span>${esc(x.name)}${x.badge ? ` <span class="badge">${x.badge}</span>` : ""}${b ? rev : ""}</span> <b>${x.n}</b> <small data-s="sentences">sentences</small></li>`;
  const list = (xs: Row[], b: (x: Row) => boolean) => `<ul>${xs.map((x) => li(x, b(x))).join("")}</ul>`;
  const block = (k: "thisWeek" | "allTime") => `<section class="card"><div class="label" data-s="${k}">${k === "thisWeek" ? "This week" : "All time"}</div>${list(d[k].contributors, (x) => !!x.reviewer)}<div class="label" data-s="reviewerBadge">Reviewer</div>${list(d[k].reviewers, () => true)}</section>`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Paite contributors</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Young+Serif&family=Atkinson+Hyperlegible:wght@400;700&display=swap">
<link rel="stylesheet" href="/style.css"></head>
<body><main>
<header><h1 data-s="contributorsTitle">Paite contributors</h1></header>
${block("thisWeek")}
${block("allTime")}
<p><a href="/">Paite Daily</a></p>
</main>
<script src="/strings.js"></script>
<script>document.querySelectorAll("[data-s]").forEach(function(e){var s=window.STRINGS[e.dataset.s];if(s&&s.pai)e.innerHTML=s.pai+"<small> "+s.en+"</small>";});</script>
</body></html>`;
}

export function renderMarkdown(d: Contributors): string {
  const rows = (xs: { name: string; n: number }[]) => xs.map((x) => `- ${mdEsc(x.name)}: ${x.n}`).join("\n") || "_None yet._";
  return `# Paite contributors\n\n## Contributors (verified sentences)\n\n${rows(d.contributors.map((c) => ({ name: c.name + (c.badge ? ` [${c.badge}]` : "") + (c.reviewer ? " (reviewer)" : ""), n: c.verified })))}\n\n## Reviewers (decisions)\n\n${rows(d.reviewers.map((r) => ({ name: r.name, n: r.decisions })))}\n`;
}
