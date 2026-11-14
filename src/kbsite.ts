import { verifiedPairs } from "./chat";
import { getGlossary } from "./glossary";
import { sha256Hex } from "./kb";
import type { Env } from "./types";

export type SiteItem = { siteKey: string; title: string; url: string | null; text: string };
const MAX_TEXT = 4000;
const BATCH = 100;

const clean = (v: string | null | undefined) => (v ?? "").trim();
/** Labelled lines, leaving out any whose value is empty. Labels are English; values are stored text. */
function lines(rows: [string, string | null | undefined][]): string {
  const text = rows.filter(([, v]) => clean(v)).map(([k, v]) => `${k}: ${clean(v)}`).join("\n");
  if (text.length <= MAX_TEXT) return text;
  const cut = text.lastIndexOf("\n", MAX_TEXT);
  return text.slice(0, cut > 0 ? cut : MAX_TEXT);
}

/** What the wiki should hold from the site's own reviewed data. Reads env.DB only. */
export async function siteItems(env: Env): Promise<SiteItem[]> {
  const items: SiteItem[] = [];
  const { results: sayings } = await env.DB.prepare(
    "SELECT id, kind, paite, english, explainer, explainer_en FROM proverbs WHERE status = 'live' ORDER BY id",
  ).all<{ id: number; kind: string; paite: string | null; english: string | null; explainer: string | null; explainer_en: string | null }>();
  for (const p of sayings) {
    items.push({
      siteKey: `proverb:${p.id}`, title: `Saying: ${clean(p.paite) || clean(p.english)}`, url: `/proverbs#p-${p.id}`,
      text: lines([[`Paite saying (Pau Upa, ${p.kind})`, p.paite], ["English", p.english], ["Meaning (in Paite)", p.explainer], ["Meaning (in English)", p.explainer_en]]),
    });
  }
  for (const g of await getGlossary(env)) {
    items.push({
      siteKey: `glossary:${g.id}`, title: `Word: ${clean(g.paite)}`, url: `/glossary#w-${g.id}`,
      text: lines([["Paite word", g.paite], ["English", g.english], ["Note", g.note], ["Example in Paite", g.example?.paite], ["Example in English", g.example?.english]]),
    });
  }
  const seen = new Set<string>();
  for (const p of await verifiedPairs(env)) {
    const siteKey = "pair:" + (await sha256Hex(p.english.normalize("NFC").trim().toLowerCase().replace(/\s+/g, " "))).slice(0, 16);
    if (seen.has(siteKey)) continue;
    seen.add(siteKey);
    items.push({ siteKey, title: `Sentence: ${clean(p.english)}`, url: null, text: lines([["English", p.english], ["Paite", p.paite]]) });
  }
  return items;
}

/** Make the wiki's site sources match the site's data. Null when nothing changed. */
export async function syncSiteSources(env: Env, now: number): Promise<{ added: number; changed: number; removed: number; total: number } | null> {
  const wanted = await siteItems(env);
  const hashes = await Promise.all(wanted.map((w) => sha256Hex(w.text)));
  const { results: have } = await env.WIKI.prepare(
    "SELECT s.id, s.site_key, s.title, s.url, c.id AS chunk_id, c.sha256 FROM kb_sources s LEFT JOIN kb_chunks c ON c.source_id = s.id AND c.ordinal = 1 WHERE s.kind = 'site'",
  ).all<{ id: number; site_key: string; title: string; url: string | null; chunk_id: number | null; sha256: string | null }>();
  // A failed read must never wipe the index.
  if (wanted.length === 0 && have.length > 50) throw new Error("site sync: no site data read, refusing to empty the wiki");
  const byKey = new Map(have.map((h) => [h.site_key, h]));
  const keys = new Set(wanted.map((w) => w.siteKey));
  // Each group keeps a source insert next to its chunk insert (the chunk finds the source by site_key).
  const groups: D1PreparedStatement[][] = [];
  let cur: D1PreparedStatement[] = [];
  const push = (size: number, ...st: D1PreparedStatement[]) => {
    if (cur.length + size > BATCH) { groups.push(cur); cur = []; }
    cur.push(...st);
  };
  let added = 0, changed = 0, removed = 0;
  wanted.forEach((w, i) => {
    const h = byKey.get(w.siteKey);
    if (!h) {
      added++;
      push(2,
        env.WIKI.prepare("INSERT INTO kb_sources (kind, site_key, title, url, language, rights, exportable, trust, status, added_by, decided_by, decided_at, created_at, updated_at) VALUES ('site', ?1, ?2, ?3, 'mixed', 'open', 0, 1, 'approved', 'site', 'site', ?4, ?4, ?4)").bind(w.siteKey, w.title, w.url, now),
        env.WIKI.prepare("INSERT INTO kb_chunks (source_id, ordinal, locator, text, sha256) VALUES ((SELECT id FROM kb_sources WHERE site_key = ?1), 1, NULL, ?2, ?3)").bind(w.siteKey, w.text, hashes[i]));
    } else if (h.sha256 !== hashes[i] || h.title !== w.title || h.url !== w.url) {
      changed++;
      push(2,
        env.WIKI.prepare("UPDATE kb_chunks SET text = ?2, sha256 = ?3 WHERE source_id = ?1 AND ordinal = 1").bind(h.id, w.text, hashes[i]),
        env.WIKI.prepare("UPDATE kb_sources SET title = ?2, url = ?3, updated_at = ?4 WHERE id = ?1").bind(h.id, w.title, w.url, now));
    }
  });
  for (const h of have) {
    if (keys.has(h.site_key)) continue;
    removed++;
    push(2, env.WIKI.prepare("DELETE FROM kb_chunks WHERE source_id = ?1").bind(h.id), env.WIKI.prepare("DELETE FROM kb_sources WHERE id = ?1").bind(h.id));
  }
  if (cur.length) groups.push(cur);
  for (const g of groups) await env.WIKI.batch(g);
  return added + changed + removed === 0 ? null : { added, changed, removed, total: wanted.length };
}
