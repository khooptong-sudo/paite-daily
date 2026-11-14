import type { Env } from "./types";
const PAGE = 1000;
const KEEP_DAYS = 30;
type BackupResult = { key: string; tables: number; rows: number; bytes: number; deleted: number };
/**
 * Nightly full copy of every D1 table into the private AUDIO bucket, so pending data survives losing D1.
 * Never public: publicAudio only streams keys it finds in the recordings table, and no row holds a backups/ key.
 */
export async function runBackup(env: Env, now: number): Promise<BackupResult> {
  return backupDb(env.DB, env.AUDIO, () => false, now);
}
/**
 * The same nightly copy for the wiki database, into its own private bucket. The full-text index and its
 * shadow tables are skipped: they are rebuilt from kb_chunks, so copying them would only double the size.
 */
export async function runWikiBackup(env: Env, now: number): Promise<BackupResult> {
  return backupDb(env.WIKI, env.WIKI_FILES, (t) => t.startsWith("kb_chunks_fts"), now);
}
async function backupDb(db: D1Database, bucket: R2Bucket, skip: (table: string) => boolean, now: number): Promise<BackupResult> {
  // Discovered at run time so new tables are never forgotten. d1_migrations is wrangler's bookkeeping, not data.
  const names = (await db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name <> 'd1_migrations' ORDER BY name",
  ).all<{ name: string }>()).results.map((r) => r.name).filter((t) => !skip(t));
  const tables: Record<string, unknown[]> = {};
  let rows = 0;
  for (const t of names) {
    const all: unknown[] = [];
    // Paged so no single query is huge. Names come from sqlite_master, so quoting them is safe.
    for (let n = 0; ; n += PAGE) {
      const { results } = await db.prepare(`SELECT * FROM "${t}" ORDER BY rowid LIMIT ${PAGE} OFFSET ${n}`).all();
      all.push(...results);
      if (results.length < PAGE) break;
    }
    tables[t] = all;
    rows += all.length;
  }
  const body = JSON.stringify({ createdAt: new Date(now).toISOString(), tables });
  const gz = await new Response(new Blob([body]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer();
  const key = `backups/${new Date(now).toISOString().slice(0, 10)}.json.gz`;
  await bucket.put(key, gz, { httpMetadata: { contentType: "application/json", contentEncoding: "gzip" } });
  // Keep the last 30 days; the date in the key decides, not the upload time.
  const cutoff = new Date(now - KEEP_DAYS * 86400000).toISOString().slice(0, 10);
  const old: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix: "backups/", cursor });
    for (const o of page.objects) {
      const d = /^backups\/(\d{4}-\d{2}-\d{2})\.json\.gz$/.exec(o.key)?.[1];
      if (d && d < cutoff) old.push(o.key);
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  if (old.length) await bucket.delete(old);
  return { key, tables: names.length, rows, bytes: gz.byteLength, deleted: old.length };
}
