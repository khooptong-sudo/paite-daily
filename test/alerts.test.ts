import { env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { failingJobs, logged } from "../src/export";
import { call, fakeDeps } from "./helpers";

const run = (ok: boolean, job = "export") => env.DB.prepare("INSERT INTO job_runs (job, ok, detail) VALUES (?1, ?2, 'x')").bind(job, ok ? 1 : 0).run();
const fail = () => logged(env, "export", async () => { throw new Error("boom"); });
const pass = () => logged(env, "export", async () => ({}));
const as = (email: string | null) => call("/review/api/health", {}, fakeDeps({ verifyAccess: async () => email }));

describe("failingJobs", () => {
  it("two failures fail; failure then ok or single failure do not", async () => {
    await run(false); await run(false);
    await run(false, "a"); await run(true, "a");
    await run(false, "b");
    expect((await failingJobs(env.DB)).map((f) => f.job)).toEqual(["export"]);
  });
});

describe("health endpoint", () => {
  const saved = { o: env.OWNER_EMAIL, r: env.REVIEWERS };
  afterEach(() => { env.OWNER_EMAIL = saved.o; env.REVIEWERS = saved.r; });
  it("owner 200, reviewer 403, no access 401", async () => {
    env.OWNER_EMAIL = "own@example.org";
    env.REVIEWERS = JSON.stringify({ "own@example.org": "O", "rev@example.org": "R" });
    await run(false); await run(false);
    const ok = await as("own@example.org");
    expect(ok.status).toBe(200);
    expect((await ok.json<{ failing: { job: string }[] }>()).failing[0].job).toBe("export");
    expect((await as("rev@example.org")).status).toBe(403);
    expect((await as(null)).status).toBe(401);
  });
});

describe("alert email", () => {
  const saved = { o: env.OWNER_EMAIL, a: env.ALERT_EMAIL };
  afterEach(() => { env.OWNER_EMAIL = saved.o; env.ALERT_EMAIL = saved.a; vi.restoreAllMocks(); });
  const bind = (send: () => Promise<unknown>) => { env.OWNER_EMAIL = "own@example.org, b@example.org"; env.ALERT_EMAIL = { send } as unknown as SendEmail; };

  it("sends once on the 2nd consecutive failure, not the 3rd", async () => {
    const send = vi.fn(async () => ({})); bind(send);
    await fail(); expect(send).toHaveBeenCalledTimes(0);
    await fail(); expect(send).toHaveBeenCalledTimes(1);
    expect((send.mock.calls[0] as unknown[])[0]).toMatchObject({ to: ["own@example.org", "b@example.org"], subject: "Paite Daily: export failed twice" });
    await fail(); expect(send).toHaveBeenCalledTimes(1);
    await pass(); await fail(); await fail(); expect(send).toHaveBeenCalledTimes(2);
  });
  it("silent without the binding", async () => {
    env.OWNER_EMAIL = "own@example.org"; env.ALERT_EMAIL = undefined;
    await fail(); await fail();
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM job_runs WHERE ok = 0").first<{ n: number }>())!.n).toBe(2);
  });
  it("a throwing send does not break the job", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    bind(async () => { throw new Error("mail down"); });
    await fail(); await expect(fail()).resolves.toBeUndefined();
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM job_runs WHERE ok = 0").first<{ n: number }>())!.n).toBe(2);
  });
  it("still attempts the alert when the failure-row insert throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const send = vi.fn(async () => ({})); bind(send);
    await run(false); await run(false);
    const db = { prepare: (q: string) => (q.includes("INSERT INTO job_runs") ? { bind: () => ({ run: async () => { throw new Error("d1 down"); } }) } : env.DB.prepare(q)) };
    await expect(logged({ ...env, DB: db as unknown as D1Database }, "export", async () => { throw new Error("boom"); })).resolves.toBeUndefined();
    expect(send).toHaveBeenCalledTimes(1);
  });
});
