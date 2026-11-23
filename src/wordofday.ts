import data from "./word-of-day.json";

const IST_MS = 5.5 * 3600_000;
const DAY_MS = 86_400_000;

// Everyone sees the same word all day; it changes at IST midnight.
export function wordOfDay(now: number): Response {
  const ist = now + IST_MS;
  const [paite, english, type] = data.words[Math.floor(ist / DAY_MS) % data.words.length];
  const date = new Date(ist).toISOString().slice(0, 10);
  return new Response(JSON.stringify({ paite, english, type, date }), { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=600" } });
}
