import { PUAN } from "./puan";
import { getGoal } from "./goal";
import type { Env } from "./types";

type Row = { name: string; n: number; badge: Badge; reviewer?: boolean };
export type Badge = null | 10 | 50 | 100 | 500;
export type Contributors = {
  goal: { verified: number; goal: number };
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
  const merged = new Map<string, { name: string; decisions: number; weekly: number }>();
  for (const [email, name] of Object.entries(map)) {
    const d = done.get(email.toLowerCase()), m = merged.get(name) ?? { name, decisions: 0, weekly: 0 };
    m.decisions += d?.n ?? 0; m.weekly += d?.w ?? 0; merged.set(name, m);
  }
  const reviewers = [...merged.values()].sort(byCountThenName((x) => x.decisions));
  const rank = (xs: Row[], keepZero = false) => xs.filter((x) => keepZero || x.n > 0).sort(byCountThenName((x) => x.n));
  const cr = (n: (x: (typeof contributors)[number]) => number) => rank(contributors.map((x) => ({ name: x.name, n: n(x), badge: x.badge, reviewer: x.reviewer })));
  const rr = (n: (x: (typeof reviewers)[number]) => number, keepZero = false) => rank(reviewers.map((x) => ({ name: x.name, n: n(x), badge: null })), keepZero);
  return {
    goal: await getGoal(env),
    contributors,
    reviewers,
    thisWeek: { contributors: cr((x) => x.weekly), reviewers: rr((x) => x.weekly) },
    allTime: { contributors: cr((x) => x.verified), reviewers: rr((x) => x.decisions, true) },
  };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const mdEsc = (s: string) => s.replace(/[\\`*_{}\[\]()#+\-.!|<>~&]/g, "\\$&").replace(/\s+/g, " ");

const SEAL = '<svg class="seal-mark" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l2.6 2.2 3.4-.2 1 3.3 2.9 1.8-1.1 3.2 1.1 3.2-2.9 1.8-1 3.3-3.4-.2L12 22l-2.6-2.2-3.4.2-1-3.3-2.9-1.8 1.1-3.2L2.1 9l2.9-1.8 1-3.3 3.4.2z"/><path d="M8 12.2l2.7 2.7L16 9.6"/></svg>';
const JS = `(function(){var S=window.STRINGS||{};
document.querySelectorAll("[data-s]").forEach(function(e){var s=S[e.dataset.s];if(s&&s.pai)e.innerHTML=s.pai+"<small> "+s.en+"</small>";});
var iv=S.inviteText,inv=document.getElementById("invite");if(iv&&inv)inv.href="https://wa.me/?text="+encodeURIComponent((iv.pai?iv.pai+" ":"")+iv.en+" https://paite.lamkalabs.com");
var m=document.querySelector("main"),v=m.querySelectorAll("[data-view]"),b=m.querySelectorAll(".seg button");
function show(k){v.forEach(function(x){x.classList.toggle("on",x.dataset.view===k)});b.forEach(function(x){x.setAttribute("aria-pressed",x.dataset.v===k)})}
b.forEach(function(x){x.addEventListener("click",function(){show(x.dataset.v)})});show(m.dataset.start);
function up(e){var n=+e.dataset.n,t=null;function f(T){t=t||T;var p=Math.min((T-t)/700,1);e.textContent=Math.round(n*(1-Math.pow(1-p,3)));if(p<1)requestAnimationFrame(f)}requestAnimationFrame(f)}
if(!matchMedia("(prefers-reduced-motion: reduce)").matches&&"IntersectionObserver"in window){var io=new IntersectionObserver(function(es){es.forEach(function(x){if(x.isIntersecting){io.unobserve(x.target);up(x.target)}})});document.querySelectorAll("b[data-n]").forEach(function(e){io.observe(e)})}
})();`;

const INVITE_EN = "Help write Paite into the future. One sentence a day:";
const goalBar = (g: { verified: number; goal: number }) =>
  `<div class="goal"><div class="goal-t"><b>${g.verified}</b> / ${g.goal} <span data-s="goalLine">verified sentences</span></div><div class="goal-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${g.goal}" aria-valuenow="${g.verified}"><i style="width:${Math.min(100, Math.round((g.verified / g.goal) * 100))}%"></i></div></div>`;

export function renderPage(d: Contributors, css = '<link rel="stylesheet" href="/contributors.css">'): string {
  const count = (n: number, key: string, en: string) => `<span class="c"><b data-n="${n}">${n}</b><span class="u" data-s="${key}">${en}</span></span>`;
  const pills = (x: Row) => `${x.badge ? `<span class="badge t${x.badge}">${x.badge}+</span>` : ""}${x.reviewer ? '<span class="badge seal" data-s="reviewerBadge">Reviewer</span>' : ""}`;
  const contributors = (xs: Row[], empty: string) => {
    if (!xs.length) return `<p class="empty" data-s="${empty}">${empty === "emptyWeek" ? "No one yet this week. Be the first!" : "No one yet. Be the first!"}</p>`;
    const cnt = (x: Row) => count(x.n, "sentences", "sentences");
    const podium = xs.slice(0, 3).map((x, i) => `<li class="p p${i + 1}" style="--i:${i}"><span class="ring">${i + 1}</span><span class="nm">${esc(x.name)}</span><span class="bg">${pills(x)}</span>${cnt(x)}</li>`).join("");
    const rest = xs.slice(3).map((x, i) => `<li style="--i:${i + 3}"><span class="rk">${i + 4}</span><span class="nm">${esc(x.name)}<span class="bg">${pills(x)}</span></span>${cnt(x)}</li>`).join("");
    return `<ol class="podium">${podium}</ol>${rest ? `<ol class="rows" start="4">${rest}</ol>` : ""}`;
  };
  const reviewers = (xs: Row[]) => xs.length
    ? `<h3 data-s="reviewers">Reviewers</h3><ol class="rows">${xs.map((x, i) => `<li style="--i:${i}">${SEAL}<span class="nm">${esc(x.name)}</span>${count(x.n, "reviewed", "reviewed")}</li>`).join("")}</ol>`
    : "";
  const view = (k: "thisWeek" | "allTime") => `<section class="view" data-view="${k}" aria-labelledby="h-${k}"><h2 id="h-${k}" data-s="${k}">${k === "thisWeek" ? "This week" : "All time"}</h2>${contributors(d[k].contributors, k === "thisWeek" ? "emptyWeek" : "emptyAll")}${reviewers(d[k].reviewers)}</section>`;
  const start = d.thisWeek.contributors.length + d.thisWeek.reviewers.length ? "thisWeek" : "allTime";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Pan Late - Paite contributors</title>
<meta name="theme-color" content="#000000">
<script>document.documentElement.className="js"</script>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Young+Serif&family=Atkinson+Hyperlegible:wght@400;700&display=swap">
<link rel="stylesheet" href="/style.css">
${css}</head>
<body class="cp">
<header class="hero">${PUAN}<h1 data-s="contributorsTitle">Paite contributors</h1><p data-s="heroLine">The people writing Paite into the future.</p></header>
${goalBar(d.goal)}
<main data-start="${start}">
<div class="seg" role="group" aria-label="Period"><button type="button" data-v="thisWeek" aria-pressed="false" data-s="thisWeek">This week</button><button type="button" data-v="allTime" aria-pressed="false" data-s="allTime">All time</button></div>
${view("thisWeek")}
${view("allTime")}
<a class="cta" href="/"><span>Paite Daily<small data-s="addSentence">Add a sentence</small></span><span class="go" aria-hidden="true">&rarr;</span></a>
<a class="cta glass-btn" id="invite" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(INVITE_EN + " https://paite.lamkalabs.com")}"><span data-s="invite">Send to a friend</span><span class="go" aria-hidden="true">&rarr;</span></a>
</main>
<script src="/strings.js"></script>
<script>${JS}</script>
</body></html>`;
}

export function renderMarkdown(d: Contributors): string {
  const rows = (xs: { name: string; n: number }[]) => xs.map((x) => `- ${mdEsc(x.name)}: ${x.n}`).join("\n") || "_None yet._";
  return `# Paite contributors\n\n## Contributors (verified sentences)\n\n${rows(d.contributors.map((c) => ({ name: c.name + (c.badge ? ` [${c.badge}]` : "") + (c.reviewer ? " (reviewer)" : ""), n: c.verified })))}\n\n## Reviewers (decisions)\n\n${rows(d.reviewers.map((r) => ({ name: r.name, n: r.decisions })))}\n`;
}
