// Gap-driven prompts. COMMON is everyday English, most used first. A word is covered once a
// verified Paite translation exists for a sentence that uses it; until then it is a gap,
// and an open sentence that fills gaps is served before one that does not. Earlier words
// in the list weigh more, so "water" is filled before "umbrella".

export const COMMON = `go come see know get make take give say tell want need like love eat drink sleep work walk run sit stand
look find think feel call ask help play read write sing cook buy sell pay open close wait start stop live die bring carry
wash learn teach keep leave put send meet visit hear speak listen understand remember forget try use build fix plant grow
rain cry laugh smile wake sweep cut fall throw catch hold pull push climb swim fly
water food rice tea milk meat fish egg fruit vegetable salt sugar bread curry soup
house home room door window bed kitchen roof wall floor table chair road village town city market school church shop field farm
garden river hill mountain tree forest stone fire wood
mother father brother sister son daughter child children baby friend family wife husband grandmother grandfather uncle aunt
man woman boy girl people teacher doctor pastor neighbour guest
day night morning evening today tomorrow yesterday week month year time hour minute
sun moon star sky wind cloud rain weather cold hot warm
dog cat cow pig chicken bird horse goat
head hand eye ear mouth face hair foot leg heart body tooth nose back
money work job book letter phone bus car bag clothes shirt shoe hat
good bad big small new old long short happy sad sick tired hungry thirsty beautiful clean dirty easy hard fast slow early late
right wrong true kind poor rich young strong far near full empty
one two three four five ten many few all some every
red white black green yellow blue
song word name story question answer news prayer gift game festival wedding funeral
always never often sometimes again together alone here there now soon already still`.split(/\s+/).filter((w, i, all) => w && all.indexOf(w) === i);

const forms = (w: string) => [w, w + "s", w + "es", w + "ed", w + "d", w + "ing", w + "er", w.replace(/y$/, "ies"), w.replace(/e$/, "ing")];
const words = (t: string) => new Set(t.toLowerCase().match(/[a-z']+/g) ?? []);

/** The common words this English line uses, by their place in COMMON. */
export function commonIn(english: string): number[] {
  const ws = words(english), out: number[] = [];
  COMMON.forEach((w, i) => { if (forms(w).some((f) => ws.has(f))) out.push(i); });
  return out;
}

/** How much serving this line now would fill: each uncovered common word it uses, earlier words weighing more. */
export const gapScore = (english: string, covered: Set<number>) =>
  commonIn(english).reduce((s, i) => (covered.has(i) ? s : s + 1 + (COMMON.length - i) / COMMON.length), 0);

let cache: { at: number; covered: Set<number> } | null = null;
export const clearGapCache = () => { cache = null; };
const TTL = 10 * 60_000;

/** Which common words already have a verified Paite example, rebuilt at most every ten minutes per worker. */
export async function coveredWords(db: D1Database, now: number): Promise<Set<number>> {
  if (cache && now - cache.at < TTL) return cache.covered;
  const { results } = await db.prepare(
    `SELECT DISTINCT s.english FROM sentences s JOIN answers a ON a.sentence_id = s.id
     WHERE s.direction = 'en2pai' AND a.status IN ('accepted', 'also_correct')`,
  ).all<{ english: string }>();
  const covered = new Set<number>();
  for (const r of results) for (const i of commonIn(r.english)) covered.add(i);
  cache = { at: now, covered };
  return covered;
}

/** The first `n` common words still without a verified example, for asking the generator to use them. */
export async function gapWords(db: D1Database, now: number, n = 25): Promise<string[]> {
  const covered = await coveredWords(db, now);
  return COMMON.filter((_, i) => !covered.has(i)).slice(0, n);
}
