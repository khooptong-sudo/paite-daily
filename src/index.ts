import { handleContributor } from "./contributor";
import type { Deps, Env } from "./types";

export function createApp(deps: Deps) {
  return async (req: Request, env: Env): Promise<Response> => {
    const { pathname } = new URL(req.url);
    if (pathname.startsWith("/api/")) return handleContributor(req, env, deps);
    return env.ASSETS.fetch(req);
  };
}
