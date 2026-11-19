import { env } from "cloudflare:test";
import { beforeEach } from "vitest";
import { createApp } from "../src/index";
import { clearGapCache } from "../src/gaps";
import { clearRulesCache } from "../src/rules";
import { clearSpellingCache } from "../src/spelling";
import { clearWordExtrasCache } from "../src/glossary";
import { clearTodayCache } from "../src/today";
import { forgetSalt } from "../src/visitors";
import { signSession } from "../src/session";
import { normaliseEnglish } from "../src/text";
import type { Deps } from "../src/types";

// Storage is not isolated between tests in this pool version; wipe all tables (children first).
beforeEach(async () => {
  // Per-worker caches would carry one test's words into the next.
  clearGapCache(); clearRulesCache(); clearSpellingCache(); clearWordExtrasCache(); clearTodayCache(); forgetSalt();
  await env.DB.batch(["reviewer_login_attempts", "reviewer_password_links", "reviewer_sessions", "reviewer_passwords", "grammar_checks","recordings", "chat_wants", "job_locks", "word_submissions", "word_links", "reviewer_applications", "reviewers", "proverb_answers", "proverbs", "glossary", "locks", "skips", "reviewer_phones", "reviews", "exports", "job_runs", "seen", "answers", "sentences", "errors", "events", "visit_stats", "visit_salts"].map((t) => env.DB.prepare(`DELETE FROM ${t}`)));
  // The wiki database too; chunks first so the FTS delete trigger clears the index.
  await env.WIKI.batch(["kb_test_results", "kb_test_runs", "kb_tests", "kb_article_revs", "kb_articles", "kb_vectors","kb_ask_dismissed", "kb_flags","kb_ask_cache", "kb_asks", "kb_counters", "kb_chunks", "kb_sources"].map((t) => env.WIKI.prepare(`DELETE FROM ${t}`)));
});

export const PHONE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const PHONE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
export const PHONE_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
export const NOW = 1_800_000_000_000;

export function fakeDeps(overrides: Partial<Deps> = {}): Deps {
  return {
    verifyTurnstile: async () => true,
    verifyReviewer: async () => null,
    now: () => NOW,
    ...overrides,
  };
}

export async function addSentences(...english: string[]): Promise<number[]> {
  const ids: number[] = [];
  for (const e of english) {
    const r = await env.DB.prepare("INSERT INTO sentences (english, english_key, source) VALUES (?1, ?2, 'test') RETURNING id")
      .bind(e, normaliseEnglish(e))
      .first<{ id: number }>();
    ids.push(r!.id);
  }
  return ids;
}

export function session(phoneId: string): Promise<string> {
  return signSession(phoneId, NOW + 3_600_000, env.SESSION_SECRET);
}

export async function call(path: string, init: RequestInit & { session?: string } = {}, deps = fakeDeps()) {
  const headers = new Headers(init.headers);
  if (init.session) headers.set("X-Session", init.session);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  return createApp(deps)(new Request(`https://paite.lamkalabs.com${path}`, { ...init, headers }), env);
}
