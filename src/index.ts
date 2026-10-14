import { verifyAccess } from "./access";
import { logged, runNightly } from "./export";
import { runPrereview } from "./prereview";
import { runRefill } from "./refill";
import { handleContributor } from "./contributor";
import { getContributors, renderPage } from "./contributors";
import { getGlossary, renderGlossary } from "./glossary";
import { handleReview } from "./review";
import { verifyTurnstile } from "./turnstile";
import type { Deps, Env } from "./types";

export function createApp(deps: Deps) {
  return async (req: Request, env: Env, ctx?: ExecutionContext): Promise<Response> => {
    const { pathname } = new URL(req.url);
    if (pathname === "/glossary") return new Response(renderGlossary(await getGlossary(env)), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
    if (pathname === "/contributors") return new Response(renderPage(await getContributors(env), undefined, env.TURNSTILE_SITE_KEY), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
    if (pathname.startsWith("/api/")) return handleContributor(req, env, deps, ctx);
    if (pathname.startsWith("/review/api/")) return handleReview(req, env, deps);
    if (pathname === "/" || pathname === "/index.html") {
      const page = await env.ASSETS.fetch(req);
      return new HTMLRewriter()
        .on("html", { element: (el) => { el.setAttribute("data-sitekey", env.TURNSTILE_SITE_KEY); } })
        .transform(page);
    }
    return env.ASSETS.fetch(req);
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
      c.cron === "*/15 * * * *" ? logged(env, "prereview", () => runPrereview(env, fetch))
      : c.cron === "0 2 * * *" ? logged(env, "refill", () => runRefill(env, fetch, Date.now()))
      : runNightly(env, fetch));
  },
} satisfies ExportedHandler<Env>;
