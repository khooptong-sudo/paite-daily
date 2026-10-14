import { verifyAccess } from "./access";
import { handleContributor } from "./contributor";
import { handleReview } from "./review";
import { verifyTurnstile } from "./turnstile";
import type { Deps, Env } from "./types";

export function createApp(deps: Deps) {
  return async (req: Request, env: Env): Promise<Response> => {
    const { pathname } = new URL(req.url);
    if (pathname.startsWith("/api/")) return handleContributor(req, env, deps);
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
  fetch: (req: Request, env: Env) => app(req, env),
} satisfies ExportedHandler<Env>;
