const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

export function normaliseEnglish(s: string): string {
  return s.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
}

/** NFC, trimmed, inner whitespace collapsed; null if empty, too long, or containing control characters. */
export function cleanText(s: unknown, max: number): string | null {
  if (typeof s !== "string" || CONTROL.test(s)) return null;
  const t = s.normalize("NFC").trim().replace(/\s+/g, " ");
  return t.length >= 1 && t.length <= max ? t : null;
}

export function isPhoneId(s: unknown): s is string {
  return typeof s === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

// Words always start with a capital, however they were typed.
export const cap = (v: string) => v.charAt(0).toLocaleUpperCase() + v.slice(1);

// Row ids arrive from the client, so bound them: a positive integer that fits in a row id.
export function isId(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v > 0 && v <= 2_147_483_647;
}

// A list of row ids from the client, with a cap so one call cannot carry a giant list.
export function isIdList(v: unknown, max = 50): v is number[] {
  return Array.isArray(v) && v.length <= max && v.every(isId);
}
