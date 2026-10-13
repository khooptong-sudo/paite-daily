const enc = new TextEncoder();

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}

function b64url(buf: ArrayBuffer): string {
  let bin = "";
  for (const b of new Uint8Array(buf)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function signSession(phoneId: string, expiresAt: number, secret: string): Promise<string> {
  const body = `${phoneId}.${expiresAt}`;
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(body));
  return `${body}.${b64url(sig)}`;
}

export async function readSession(token: string | null, now: number, secret: string): Promise<string | null> {
  if (!token) return null;
  const [phoneId, exp, sig] = token.split(".");
  if (!phoneId || !exp || !sig || !(Number(exp) > now)) return null;
  const expected = await signSession(phoneId, Number(exp), secret);
  if (expected.length !== token.length) return null;
  let diff = 0;
  for (let i = 0; i < token.length; i++) diff |= expected.charCodeAt(i) ^ token.charCodeAt(i);
  return diff === 0 ? phoneId : null;
}
