import { handleContributor } from "./contributor";
import { verifyTurnstile } from "./turnstile";
import type { Deps, Env } from "./types";

export function createApp(deps: Deps) {
  return async (req: Request, env: Env): Promise<Response> => {
    const { pathname } = new URL(req.url);
    if (pathname.startsWith("/api/")) return handleContributor(req, env, deps);
    return env.ASSETS.fetch(req);
  };
}

const app = createApp({
  verifyTurnstile: (t, ip, env) => verifyTurnstile(t, ip, env),
  verifyAccess: async () => null,
  now: () => Date.now(),
});

export default {
  fetch: (req: Request, env: Env) => app(req, env),
} satisfies ExportedHandler<Env>;
