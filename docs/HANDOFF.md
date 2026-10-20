Newest first. Each session prepends one section directly under this line.

## ✅ 20102026 EoS — sayings you can translate, reviewer credit everywhere, and a chat demo that cannot lie

### Shipped

- **Proverbs & Idioms** (`/proverbs`): fixed pairs of Paite line + English line + explainer, submitted from the front page in either
  direction, reviewed before they appear. The page opens on **Paite → English** (the owner's default; the Paite list is his to supply)
  and says plainly that it is still being gathered, with a one-tap jump to the English side.
- **A real English list to translate**: 172 sourced sayings added (142 idioms, 30 proverbs) on top of the 51 already seeded, so 224
  English lines wait for a Paite version. Idioms and their definitions come from Wikipedia's *English-language idioms* table; the
  proverbs come from *List of proverbial phrases* and carry a one-line gloss we wrote. Deduplicated against every seed file, which
  needed a punctuation-stripped key — the seeder only catches exact repeats, so `Don't judge a book…` and `An arm and a leg` slipped past it.
- **Reviewer credit on every reviewed entity**, not just sayings: `glossary.reviewed_by` (migration `0020`) is written when a word
  submission is approved, taking the reviewer's name from the `reviewers` table with their email as fallback; `/glossary` and
  `glossary.json` read `Added by X · Reviewed by Y`; the sentence feedback card signs the reviewer's note. Existing history was
  backfilled from `word_submissions.decided_by` — 309 rows, 301 resolving to a name.
- **Chat demo at the top of the front page** (`src/chat.ts`, `public/chat.js`): five conversations built only from verified pairs, plus
  a lookup that answers from the corpus or says it cannot. No generation. A miss offers *Ask contributors for this line*, stored in
  `chat_wants` (migration `0021`, deduped, counted) — the most-wanted uncovered lines are the next prompts for refill. Returning
  contributors see the card folded to one line.
- **Daily caps removed** for the word, meaning, saying-translation and saying-submission forms. The only remaining limits are ten
  answers a minute on sentences and the reviewer-application day cap.
- **UI corrections**: `Translate into Paite` is a bordered row with a chevron instead of a caption; the send button in that form was a
  black circle (Paite label stacked over English inside a 999px radius) and is now a normal pill; the sayings card gained a quiet arrow
  to `/proverbs` and the name **Paunakte leh Pau Upa / Pau Kulmut**.

Migrations: `0020_glossary_reviewed.sql`, `0021_chat_wants.sql`. HEAD `ad5455d`. 376 tests, `tsc` clean, cache `v16`.

### What needs updating

- **The reviewer queue is still the missing piece.** Sayings, words and sentence corrections all land `pending`, and nothing in the UI
  lists them. Until it exists, the reviewer credit added this week stays invisible in practice.
- `chat_wants` is written but not read: `wantedLines()` exists and is unused. Wire it into `refill` (behind the same lock) so demand
  actually becomes sentences.
- No live translation box, by decision. If one is ever added, it must be badged as an AI draft and never presented as reviewed.
- The corpus still carries 11 accepted answers that are English on both sides, 8 with `/` alternates and 8 under ten characters. The
  chat demo filters them out rather than fixing them; a reviewer pass over those rows would let more lines into the demo.
- `Where do you live?` has a two-variant accepted answer, so it cannot appear in a scene until someone picks one.

### Facts worth not rediscovering

- Chat scenes are English-only in code and look Paite up at request time, so a scene cannot show an unreviewed rendering and heals
  when a pair is corrected. Do not bake Paite strings into `SCENES`.
- The lookup scores F1 over content words with a 0.7 floor. `how`, `what` and `where` must stay out of the `STOP` set or
  "how much is this" becomes zero tokens and matches nothing.
- `small { display: block; color: var(--muted) }` is global: inside a dark button the English label renders black-on-black. Set
  `display:inline; color:inherit` in the button's own rule.
- The sayings page script must call `apply()` on load or the first paint ignores `var dir="pai2en"` and shows everything.
- `wrangler dev` can leave two listeners on one port; requests hang and curl reports `000`. Kill the node parents by PID from
  `Get-CimInstance Win32_Process | ? CommandLine -match wrangler`, then confirm with `netstat` before restarting.
- Push with `git -c credential.helper='!gh auth git-credential' push origin main`; a plain push waits for a TTY that never arrives.

## ✅ 16102026 EoS — hardening, error tracking, backups, social cards, contact

### Shipped

- **Auth audit**: four public routes (`/api/session`, `/api/apply`, `/api/contributors`, `/api/goal`); every
  other `/api/*` needs a signed HMAC session; every `/review/api/*` needs an Access identity plus a
  reviewer row; owner paths check `OWNER_EMAIL`. No route trusted the UI.
- **Input checks**: `isId()` and `isIdList()` in `src/text.ts` now guard every client id and id list (cap 50);
  the session call caps the turnstile token at 4096 bytes; `/api/event` drops more than 60 events a minute
  from one tab id.
- **Errors never leak**: `src/index.ts` wraps every request. A throw writes a row into the new `errors`
  table, mails the owner once per failure per six hours, and answers HTML (`/500`) for a page or JSON for
  an API path. Unit tests cover both branches plus the no-assets fallback.
- **404 and 500 pages**: `public/404.html`, `public/500.html`, and `not_found_handling: "404-page"` in
  `wrangler.jsonc`. Live: `/noseuchpage` answers 404 with the page; `/500` answers 200 with the page.
- **Analytics**: `public/track.js` → `POST /api/event` → `events`. Page, card, answer, blocked, install,
  share. No cookie, no third party, no personal data, one tab id, Do Not Track honoured. Owner cards on
  `/review`: funnel, drop-off, days, devices. Live rows were recorded during the verification run.
- **Social and contact**: Open Graph and Twitter cards with `public/og.png` (1200x630, rendered from an
  HTML card) on all three public pages; the owner's two addresses and the WhatsApp number in the footer
  and on both error pages.
- **Speed and the cheap phone**: the 91 KB UPI image no longer loads until the panel opens; the word list
  and contributors pages preconnect to the font host; `app.js` no longer needs `crypto.randomUUID` or
  `??=`; footer contact links are finger-sized. Measured on the live site at 1.6 Mbps and 4x CPU
  slowdown, cold cache: `/` 2683 ms (was 3114 ms), `/glossary` 566 ms, `/contributors` 763 ms. At 360x640
  with an Android 8.1 user agent no page scrolls sideways and no control is under 24 px.
- **Backups**: `scripts/backup-d1.ps1` exports the remote D1 to `F:\Backups\paite-daily`, restores the dump
  into the local D1 and compares every table's row count. Verified: 718 KB, all 14 tables matched. Windows
  scheduled task "Paite Daily D1 backup" runs it daily at 03:20 (interactive only, because wrangler needs
  the owner's Cloudflare credentials).

Migrations: `0014_review_variant.sql` (the Save decision), `0015_observability.sql` (`errors`, `events`).

### What needs updating

- The funnel counts only the browser. A contributor who answers from the Android package is counted in the
  same way, but nothing yet separates the package from the browser.
- `events` keeps 30 days only. Longer trends need a summary table.
- Error mail goes to `OWNER_EMAIL` through the existing `ALERT_EMAIL` binding. If that quota is spent, the
  row is still stored and the cards still show it.
- The backup task runs only while the owner is logged on, and it says nothing when it fails beyond the log
  file. A failure alert would need a second check.
- No physical cheap Android phone was used. The evidence is a throttled desktop browser with a mobile
  viewport and an Android 8.1 user agent.
- The 91 KB QR image is still 91 KB; it is only lazy now. A re-encode needs a QR decoder to prove the
  payment code still scans.

## ✅ 15102026 EoS — Starter video, PWA, Android package, and a lighter button set

### Shipped today

- **Starter video**, 18 s, two cuts. `video/paite-intro/` (1920×1080) and `video/paite-vertical/` (1080×1920). Both carry a voice over and captions on the real screen. Commits `5572c85`, `aca6d23`.
- **PWA**: `public/manifest.webmanifest`, `public/sw.js`, `public/pwa.js`, `public/icons/`, plus a manifest link and a registration line on all three public pages. The site installs from the browser. Commit `61d9c43`.
- **Android package**: `public/paite-daily.apk`, 1.13 MB, package `com.lamkalabs.paitedaily`, version 1.0.0, signed on schemes v1/v2/v3. It is a Trusted Web Activity, so Android opens the site with no browser bar.
- **Asset links**: `public/.well-known/assetlinks.json`. Google's own checker returns the statement, so the package is trusted by the domain.
- **Download rows** on `/`, `/glossary` and `/contributors`, and none on `/review`.
- **Buttons**: every filled control is now a pale wash under an ink edge (`rgba(0,0,0,.03)` fill, `rgba(0,0,0,.4)` edge, black label). The older fills were near solid black. Commits `1b1730e`, `7d7e6f7`.
- **Form spacing**: `#form` and `#word-form` now stack their fields at 16 px. A card gap does not reach inside a form, so the fields and the Send button touched. Commit `1b1730e`.
- **Label**: the acknowledgement button reads `Awle, theisiam`, with `Got it` beneath it. Commit `0669da3`.
- **Service worker repair**: it answers from the network first now, and the cache name moved to v2. Commit `cd8ac31`.
- Live version `23f7cf01`. HEAD `cd8ac31`, pushed.

### What needs updating

- The service worker repair is proven by reading the deployed bytes only. No browser that had the old worker installed has been observed reloading, so the arrival of the fix on such a device is unproven.
- `versionCode` is 2 in `twa-manifest.json` and 1 in the built package. Align them before the next build.
- `.dev.vars` holds `TURNSTILE_SECRET`, `TURNSTILE_SITE_KEY` and `SESSION_SECRET`. `REVIEWERS`, `GITHUB_TOKEN` and `OWNER_EMAIL` are absent, so a local run cannot exercise the reviewer flow, the export, or owner alerts.
- Nothing tests the video project. A broken render would be found by hand.
- The package is signed with a local key only. It is not ready for the Play Store.
- The turnstile widget needs a `paite.lamkalabs.com` entry per origin, so the local pages show the loading state.

### Facts worth not rediscovering

- Deploy is `npm run deploy` in this folder. Migrations go first: `npx wrangler d1 migrations apply paite-daily --remote`.
- **The Android project and its signing key live outside this repository**, at `F:\Resources\paite-android`. The keystore password is in `F:\KEYS\Paite Daily Android keystore.txt`. Keep that key: a new key breaks updates on every phone that already has the app. Rebuild steps are in `README.md`.
- **`public/sw.js` must stay network-first.** A cache-first worker hid four deploys today, because the worker file itself never changed, so no update check fired. Full story in the vault, `Dev - A Cache-First Service Worker Masks Its Own Updates`.
- Video rebuild: `npx hyperframes render <project> --quality high --fps 30`. The local voice needs `HYPERFRAMES_PYTHON` pointing at a venv that holds `kokoro-onnx` and `soundfile` (`C:\Users\Khooptong\.hyperframes\tts-venv`).
- Gradle cannot reserve its default 1536 MB heap on this box. `F:\Resources\paite-android\gradle.properties` sets 1024 MB and turns the daemon off.
- `npx wrangler dev` respawns its workers on Windows. One kill leaves the port open. Kill the whole tree twice, then check the port.
- Left untouched, and not mine: the untracked `.anchor/` and `.claude/` folders.
