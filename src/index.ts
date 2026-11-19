import { renderAbout } from "./about";
import { verifyReviewer } from "./login";
import { logged, runNightly } from "./export";
import { runPrereview } from "./prereview";
import { lockedRefill } from "./refill";
import { queueWanted } from "./wants";
import { syncSiteSources } from "./kbsite";
import { syncVectors } from "./kbvec";
import { handleContributor } from "./contributor";
import { getContributors, renderPage } from "./contributors";
import { getGlossary, getWordExtras, renderGlossary } from "./glossary";
import { getSameOpposite, renderSameOpposite, sameOppositeJson } from "./sameopposite";
import { getProverbs, proverbsJson, renderProverbs } from "./proverbs";
import { getRules, renderRules, rulesJson } from "./rules";
import { keyboardFile } from "./keyboard";
import { getPlaces, renderPlaces } from "./places";
import { errorPage, handleEvent, recordError } from "./observability";
import { publicAudio } from "./recordings";
import { handleReview } from "./review";
import { handleAdmin } from "./admin";
import { handleIngest } from "./kbapi";
import { renderArticlePage, renderWikiHow, renderWikiIndex } from "./kbarticle";
import { verifyTurnstile } from "./turnstile";
import type { Deps, Env } from "./types";

export function createApp(deps: Deps) {
  return async (req: Request, env: Env, ctx?: ExecutionContext): Promise<Response> => {
    const { pathname } = new URL(req.url);
    try {
      if (pathname === "/api/event" && req.method === "POST") return await handleEvent(req, env, deps.now());
      if (pathname === "/glossary") { const xs = await getGlossary(env); return new Response(renderGlossary(xs, await getWordExtras(env, xs, deps.now())), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } }); }
      if (pathname === "/proverbs") return new Response(renderProverbs(await getProverbs(env), env.TURNSTILE_SITE_KEY), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
      if (pathname === "/proverbs.json") return new Response(proverbsJson(await getProverbs(env)), { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=300" } });
      if (pathname === "/same-opposite") return new Response(renderSameOpposite(await getSameOpposite(env), env.TURNSTILE_SITE_KEY), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
      if (pathname === "/same-opposite.json") return new Response(sameOppositeJson((await getSameOpposite(env)).pairs), { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=300" } });
      if (pathname === "/contributors") return new Response(renderPage(await getContributors(env), undefined, env.TURNSTILE_SITE_KEY), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
      if (pathname === "/rules") return new Response(renderRules(await getRules(env, deps.now())), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
      if (pathname === "/rules.json") { const r = rulesJson(await getRules(env, deps.now())); r.headers.set("cache-control", "public, max-age=300"); return r; }
      if (pathname === "/words.tsv" || pathname === "/paite-wordlist.xml" || pathname === "/paite-gboard.zip") return (await keyboardFile(env, pathname, deps.now()))!;
      if (pathname === "/places") return new Response(renderPlaces(await getPlaces(env)), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
      if (pathname === "/about") return new Response(renderAbout(env.WIKI_PUBLIC === "1"), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=3600" } });
      if (pathname.startsWith("/audio/") && req.method === "GET") return await publicAudio(env, pathname);
      if (pathname.startsWith("/wiki/api/ingest/")) return await handleIngest(req, env, deps.now());
      if (env.WIKI_PUBLIC === "1" && req.method === "GET" && (pathname === "/wiki" || /^\/wiki\/[a-z0-9-]{1,80}$/.test(pathname))) {
        const page = pathname === "/wiki" ? await renderWikiIndex(env) : pathname === "/wiki/how" ? renderWikiHow() : await renderArticlePage(env, pathname.slice(6));
        if (page !== null) return new Response(page, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300" } });
      }
      if (pathname.startsWith("/api/")) return await handleContributor(req, env, deps, ctx);
      if (pathname.startsWith("/review/api/")) return await handleReview(req, env, deps, ctx);
      if (pathname.startsWith("/admin/api/")) return await handleAdmin(req, env, deps, ctx);
      if (pathname === "/" || pathname === "/index.html") {
        const page = await env.ASSETS.fetch(req);
        return new HTMLRewriter()
          .on("html", { element: (el) => { el.setAttribute("data-sitekey", env.TURNSTILE_SITE_KEY); } })
          .transform(page);
      }
      return await env.ASSETS.fetch(req);
    } catch (err) {
      // Nothing may reach the visitor as a raw stack trace: log it, alert the owner, serve a plain page.
      const task = recordError(env, pathname, req.method, err);
      if (ctx) ctx.waitUntil(task); else await task;
      return errorPage(req, env);
    }
  };
}

const app = createApp({
  verifyTurnstile: (t, ip, env) => verifyTurnstile(t, ip, env),
  verifyReviewer: (req, env) => verifyReviewer(req, env, Date.now()),
  now: () => Date.now(),
});

export default {
  fetch: (req: Request, env: Env, ctx: ExecutionContext) => app(req, env, ctx),
  scheduled: async (c: ScheduledController, env: Env, ctx: ExecutionContext) => {
    ctx.waitUntil(
      c.cron === "*/15 * * * *" ? logged(env, "prereview", () => runPrereview(env, fetch)).then(() => logged(env, "refill", () => lockedRefill(env, fetch, Date.now()))).then(() => logged(env, "wants", () => queueWanted(env, fetch))).then(() => logged(env, "wiki_site", () => syncSiteSources(env, Date.now()))).then(() => logged(env, "wiki_vectors", () => syncVectors(env, Date.now())))
      : c.cron === "0 2 * * *" ? logged(env, "refill", () => lockedRefill(env, fetch, Date.now()))
      : runNightly(env, fetch));
  },
} satisfies ExportedHandler<Env>;
