import { renderAbout } from "./about";
import { verifyAccess } from "./access";
import { logged, runNightly } from "./export";
import { runPrereview } from "./prereview";
import { lockedRefill } from "./refill";
import { handleContributor } from "./contributor";
import { getContributors, renderPage } from "./contributors";
import { getGlossary, renderGlossary } from "./glossary";
import { getProverbs, proverbsJson, renderProverbs } from "./proverbs";
import { errorPage, handleEvent, recordError } from "./observability";
import { handleReview } from "./review";
import { verifyTurnstile } from "./turnstile";
import type { Deps, Env } from "./types";

export function createApp(deps: Deps) {
  return async (req: Request, env: Env, ctx?: ExecutionContext): Promise<Response> => {
    const { pathname } = new URL(req.url);
    try {
      if (pathname === "/api/event" && req.method === "POST") return await handleEvent(req, env);
      if (pathname === "/glossary") return new Response(renderGlossary(await getGlossary(env)), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
      if (pathname === "/proverbs") return new Response(renderProverbs(await getProverbs(env), env.TURNSTILE_SITE_KEY), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
      if (pathname === "/proverbs.json") return new Response(proverbsJson(await getProverbs(env)), { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=300" } });
      if (pathname === "/contributors") return new Response(renderPage(await getContributors(env), undefined, env.TURNSTILE_SITE_KEY), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
      if (pathname === "/about") return new Response(renderAbout(), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=3600" } });
      if (pathname.startsWith("/api/")) return await handleContributor(req, env, deps, ctx);
      if (pathname.startsWith("/review/api/")) return await handleReview(req, env, deps);
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
  verifyAccess: (req, env) => verifyAccess(req, env),
  now: () => Date.now(),
});

export default {
  fetch: (req: Request, env: Env, ctx: ExecutionContext) => app(req, env, ctx),
  scheduled: async (c: ScheduledController, env: Env, ctx: ExecutionContext) => {
    ctx.waitUntil(
      c.cron === "*/15 * * * *" ? logged(env, "prereview", () => runPrereview(env, fetch)).then(() => logged(env, "refill", () => lockedRefill(env, fetch, Date.now())))
      : c.cron === "0 2 * * *" ? logged(env, "refill", () => lockedRefill(env, fetch, Date.now()))
      : runNightly(env, fetch));
  },
} satisfies ExportedHandler<Env>;
