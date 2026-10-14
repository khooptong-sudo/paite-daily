import { env } from "cloudflare:test";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { beforeAll, expect, it } from "vitest";
import { verifyAccess } from "../src/access";

let keys: Awaited<ReturnType<typeof generateKeyPair>>;
let jwks: ReturnType<typeof createLocalJWKSet>;
const cfg = { ...env, ACCESS_TEAM_DOMAIN: "lamkalabs.cloudflareaccess.com", ACCESS_AUD: "aud-123" };

beforeAll(async () => {
  keys = await generateKeyPair("RS256");
  jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(keys.publicKey)), alg: "RS256", kid: "k1" }] });
});

const token = (claims: Record<string, unknown>, aud = "aud-123", iss = "https://lamkalabs.cloudflareaccess.com") =>
  new SignJWT(claims).setProtectedHeader({ alg: "RS256", kid: "k1" }).setAudience(aud).setIssuer(iss).setExpirationTime("5m").sign(keys.privateKey);

const req = (jwt?: string) => new Request("https://paite.lamkalabs.com/review/api/next", { headers: jwt ? { "Cf-Access-Jwt-Assertion": jwt } : {} });

it("returns the email from a valid Access token", async () => {
  expect(await verifyAccess(req(await token({ email: "Rev@Example.org" })), cfg, jwks)).toBe("rev@example.org");
});

it("refuses missing, wrong-audience, and wrong-issuer tokens", async () => {
  expect(await verifyAccess(req(), cfg, jwks)).toBeNull();
  expect(await verifyAccess(req(await token({ email: "rev@example.org" }, "other-aud")), cfg, jwks)).toBeNull();
  expect(await verifyAccess(req(await token({ email: "rev@example.org" }, "aud-123", "https://evil.example")), cfg, jwks)).toBeNull();
});

it("refuses an expired token and a token without email", async () => {
  const expired = await new SignJWT({ email: "rev@example.org" }).setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setAudience("aud-123").setIssuer("https://lamkalabs.cloudflareaccess.com").setExpirationTime(Math.floor(Date.now() / 1000) - 60).sign(keys.privateKey);
  expect(await verifyAccess(req(expired), cfg, jwks)).toBeNull();
  expect(await verifyAccess(req(await token({})), cfg, jwks)).toBeNull();
});
