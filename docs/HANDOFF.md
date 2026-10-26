# Handoff, 26 October 2026 (blue look, Check spelling, counts, Hear it, Check English)

Start a new session with: **Read the top section of docs/HANDOFF.md, then ask the owner what to work on next, or start on value addition 5.**

## Where things stand
- Live version `4673df25`, from `main` at `1615a62`, pushed. Live site, GitHub and `main` all match. Service worker cache **`v35`**.
- Remote D1 has every migration through **`0027_grammar_checks.sql`**. Nothing pending.
- R2 bucket **`paite-daily-audio`** exists, bound as `AUDIO` in `wrangler.jsonc`.
- 268 tests pass, `tsc` clean.

## Shipped 26 October, later
- **Blue look on every page.** `body.blue` (front page, 404, 500, reviewer pages) and `body.cp.blue` (About, Panlate, word list, sayings) in `public/style.css`; `public/review/proverbs.html` carries its own copy. Near-black top fading through blue to pale `#eef2fb` over a fixed 1500px. Type on the dark top is solid white; cards are frosted white glass with solid ink text; the main action of each form is **solid blue** (owner approved, replaces the outlined-only rule). Body text is **Inter** everywhere; titles stay Young Serif. Owner wants text crisp: no faded or see-through type.
- **Check spelling** (value addition 2). Paite fields (`data-lang="pai"`) get a Check spelling pill (`public/grammar.js`). `POST /api/spelling` and `/review/api/spelling` (`src/spelling.ts`) look each word up in verified answers (through `finalPaite`) and the visible word list; an unseen word gets up to three nearest seen spellings (edit distance 1 for short words, 2 otherwise, swaps count as one), most used first. Tapping one swaps it into the field. No AI, no rate limit; the word table is cached per worker for ten minutes. **Pill text is English only: ask the owner for Paite.**
- **Swipe review and shortcuts** (value addition 3), in `public/review/review.js`. With several answers, words not in every answer are marked yellow. On a phone (`pointer: coarse`) an answer swipes right to accept, left to reject that answer only (30% of its width; scrolling wins when the finger moves more vertically). Desktop: J/K, arrows or 1 to 9 move between answers; A or Enter accepts the highlighted one, X rejects it, E edits it (Esc back), V ticks it as a variant; S, N, R, U and ? as before. Checked with stand-in data only; the owner should try it on the real queue.
- **Spelling rulebook** (value addition 4), `src/rules.ts`. Rules are read back from accepted reviews with a correction (`final_paite`) on English-to-Paite sentences, so an undo drops a rule by itself; no new table. The two lines are aligned word by word; a changed run pairs off one to one only when both sides have the same number of words and each pair still looks alike (edit distance at most half the longer word), so rewrites do not become rules. Public at **`/rules`** and **`/rules.json`** (added to `run_worker_first` in `wrangler.jsonc`; a new public path must be added there too). At review time each answer lists rules for its words with a "Use" pill that makes the change in the edit box (`/review/api/rules`). Linked from the reviewer header only. **Page title and copy are English only.**
- Cache **`v41`**. 277 tests.

## Shipped 25 and 26 October
- **Counts for each section.** `/api/me` returns `total` (sentences), `words`, `meanings`, `sayings`, `recordings`, `verified`, `badge`. Each front-page box shows a quiet "You: N"; `/proverbs` reads the stored copy (`localStorage pd:me`). The shawl weaves a thread per item in every section, and its share card lists each section. The old score share and its `app.js` code are gone.
- **Hear it** (value addition 1). The card shows only to phones with at least one verified sentence. One-time CC BY 4.0 consent (kept on the phone, sent with every upload), record up to 20 s, play back, send. Clips go to R2 (`src/recordings.ts`, `public/hear.js`, migration `0026`). Reviewer page `/review/audio`: one accept publishes at `/audio/<id>`, Undo returns the clip to the queue. Three voices per line at most. **No recordings yet, and no public play button yet.**
- **A reviewer's correction stands over the submission everywhere.** `src/final.ts` `finalPaite(alias)` is the one rule: the reviewer's `final_paite` when they accepted that answer, else the contributor's text. The chat demo, word-list examples, word extraction and reverse prompts all use it. Export, feedback and Hear it already used `final_paite`.
- **Spellcheck by language and Check English.** Fields carry `data-lang="en"` or `"pai"` (`public/grammar.js`, `window.pdLang`). English fields spellcheck in English and get a Check English pill. Paite fields have spellcheck off. The answer box and the reviewer correction box switch with the sentence's direction. The check calls DeepSeek for grammar, spelling and punctuation only (`src/grammar.ts`), applies nothing until "Use this", 10 a minute and 200 a day per person (migration `0027`). Confirmed working on the owner's phone.
- **Sayings reviewer**: a proverb/idiom dropdown on every card (`/review/api/proverbs/kind`), and the missing `var blocks = []` fix. `public/review/proverbs.html` is committed again; the old never-commit rule is retired.
- **Look and words.** Every card title is Young Serif at regular weight with its English as a small uppercase caption (`.card h2`, `.card h2 small`). The owner kept Young Serif after previewing Morenn and Rosehot. Contributor-facing "sayings" are now **Pau Upa** (proverbs & idioms). "About This Project" sits right-aligned under Reviewer and matches the footer link. Ask a relative is a WhatsApp pill on its own row with the owner's Paite how-to above the English. The Paite licence line opens "A utteng".

## Value additions still to do (suggested order)
5. **Gap-driven prompts**: serve sentences for common English words with no Paite example first.
6. **Keyboard and dataset exports**: weekly word-frequency list for Gboard / AnySoftKeyboard; Hugging Face mirror with a dataset card.
7. **Where you learned it**: optional village tag per answer, shown on a map.
8. **Seasonal themes and a charcoal dark mode** (Chavang Kut, Christmas).
9. **Ask a relative, version 2**: deep link to the exact sentence (`/?s=<id>`), credited to the relative.
Concepts for several are in the private artifact "Paite Daily Rewoven": https://claude.ai/artifact/2Edbcjuqmzyx4hqD11n1hv

## Loose ends
- **Hear it has no public player.** Accepted clips play at `/audio/<id>` but no page shows them yet; the chat demo or the corpus export are the obvious places. Rejected clips stay in R2.
- **Hear it card text is English only.** The owner can supply Paite for "Hear it" and the consent line.
- The owner has not yet seen the Hear it card on their phone. Their three linked phones have verified sentences, so it is most likely a different browser. Ask whether it shows now.
- Word-list entries extracted before 25 Oct may carry uncorrected Paite; reviewers fix them with Edit.
- Reviewer pages still say "saying"; only contributor-facing text became Pau Upa.
- Open decisions from before: the footer coffee note says "AI and server costs" while /about says nothing is machine-generated.

## How to work in this repo
- **Ship fully.** When the owner approves a change ("push", "go ahead", "ship it"), commit, push, apply any pending migration, deploy and check the live site in one go. Still ask first about anything new or risky (new outside service, new bucket, destructive migration).
- **Order:** migration first (`CI=1 node_modules/.bin/wrangler d1 migrations apply paite-daily --remote`), then push, then deploy. A deploy before its migration breaks the new endpoints.
- **Deploy only from a clean worktree:** `git worktree add -q .claude/worktrees/deploy-x <sha>`, copy `.dev.vars` in, run `../../../node_modules/.bin/tsc --noEmit` and `../../../node_modules/.bin/vitest run`, then `../../../node_modules/.bin/wrangler deploy`, all inside that folder. Then `rm -rf` it (it holds `.dev.vars`) and `git worktree prune`. Run each step in a subshell `( cd ... )` so the session never sits inside the folder, or Windows refuses to delete it.
- **Git in this folder:** files are owned by another Windows account, so plain `git` refuses. Use `git -c safe.directory=*`. Push with `git -c credential.helper='!gh auth git-credential' push origin main`.
- **Running tests in the main folder** also picks up the old `.claude/worktrees/paite-footer` copy; use `npx vitest run --exclude ".claude/**"`.
- **Editing files from Bash:** Windows Python under Git Bash does not read heredoc stdin, so write the script to the scratchpad and run `python script.py < /dev/null`. Many files are CRLF; match line endings when replacing text.
- **Cloudflare login:** `wrangler login` alone fails in Firefox (it reaches `localhost` over IPv6). Run `npx wrangler login --callback-host 127.0.0.1 --callback-port 8976` in a terminal tab that stays open; if the browser still says "Unable to connect", change `localhost` to `127.0.0.1` in the address bar.
- **Browser pane:** it fails the site's Turnstile check, so it never gets a contributor session. Hear it, Check English and anything behind `/api/*` must be tried on the owner's phone. Layout checks work by injecting CSS on the live page.
- Raise the service worker `CACHE` in `public/sw.js` with every shell change.
- House rules: no em dashes in copy, the main action solid blue and the small chips outlined, never classify Paite with a colonial exonym.

Newest first. Each session prepends one section directly under this line.

## ✅ 22102026 EoS: About, footer, podium, Nampuan Liangbat Gat

- `/about` rewritten, licence **CC BY 4.0** everywhere (About, JSON-LD, home metadata, `strings.js`, `src/export.ts`). Older corpus lines on GitHub still say CC0.
- Shared footer on every page (`src/footer.ts`, copies in `public/index.html`, `404.html`, `500.html`, kept in step by `test/footer.test.ts`) with the waveform (`public/footer.js`).
- Reviewer emails removed from public output (`publicReviewerNames` in `src/access.ts`).
- Outlined forms and buttons, woven podium with Share chips (`public/podium-share.js`), A to Z rail on the word list.
- **Nampuan Liangbat Gat** (`public/mypuan.js`): the name picks Puandum, BA / Siamsin Puan or Ngoutekhelh.
- **Ask a relative**: WhatsApp with the current sentence and the site link; replies are not saved.

## ✅ 21102026 EoS: a brand, an About page, and a sayings queue that reviews

### Shipped

- **Brand identity**, in `brand/`: the **sash** emblem (a woven band slung across a seal, fringed with warp ends, because a Puandum is worn over one shoulder and not laid flat) and the **P symbol** with a lozenge counter for one-colour work. Full icon set, 1200x630 social card, `INSTALL.md` mapping every file to its real path, and `build_assets.py` so the whole kit regenerates from one file. Wordmark is Young Serif, the site's own display face. Original icons are preserved in `brand/before/`.
- **The About page** at `/about` (`src/about.ts`): server rendered, sharing the glossary shell so the header, the shawl band and the footer cannot drift. Carries the `Dataset` JSON-LD with a CC0 licence and `inLanguage: pck`, and cites the real Zenodo DOI (`10.5281/zenodo.23349156`, v1.0.0) instead of a placeholder. Reached from the footer on every page.
- **Terminology is now enforced by test.** `test/about.test.ts` fails the build if Kuki, Chin, Tedim or Tiddim appear on that page, if "one sentence a day" returns, or if a placeholder survives. Paite is described as an independent Tibeto-Burman language, never as a variety of a neighbour.
- **Head sweep across four files** (`public/index.html`, `glossary.ts`, `proverbs.ts`, `contributors.ts`): "one sentence a day" retired everywhere, new title and description built on 78,725 speakers and the missing spellchecker, corrected `og:image:alt` and `twitter:image:alt`, favicon and emblem links added.
- **Sayings reviewer** on the same rails as the sentence lane. `proverb_reviews` mirrors `reviews` (`decision`, `final_paite`, `note`, `undone_at`), `proverb_answers` gained `also_correct`. Reviewer sees the English line, every candidate rendering with a correction box, "Also correct (keep as variant)", Accept and Reject, then Skip, Reject all and Retire saying, with an Undo bar.
- **One click accepts.** The separate Save button is gone: Accept submits immediately with the correction, the ticks and the note. `REQUIRED_REVIEWERS` is **1**, so a single accept publishes.
- **The line goes back out.** Publishing sets `accepting_more`, the public page shows the saying again with *Another version welcome* and the Paite line withheld, and `submitProverbAnswer` accepts the new rendering. The next submission lands beside the published line, which can be corrected and re-published, or replaced (the old answer stays on record as an accepted alternative).
- **`docs/grant-narrative.md`**: ~1,430 words, budget in named line items at US$2,000 with no overhead, cost per verified pair, plus an appendix on classification for forms and one on what not to claim.

Migrations: `0021_proverb_votes.sql` (superseded by `0022`), `0022_proverb_reviews.sql`, `0023_proverb_skips.sql`, `0024_proverb_review_undo.sql`, `0025_proverb_reviews_partial_unique.sql`. HEAD `e6e29a48`. 407 tests, `tsc` clean.

### What needs updating

- **The licence contradicts itself.** The Zenodo record says CC-BY-4.0. `/about` says every verified pair is CC0, "you do not need to credit us", and the narrative makes the same promise in section 7. Pick one. My recommendation is CC0 everywhere, because for a language this size the binding constraint is adoption, not credit.
- **The comparison card has never met real data.** No published saying has received a fresh submission yet, so the published-line-beside-new-line view is proven by test only. Watch the first one that arrives.
- **Migration numbering collides** at `0021`: `0021_chat_wants.sql` from the previous session and `0021_proverb_votes.sql` from this one. Both applied cleanly and the second is superseded, but renumber before the next migration so the history stays readable.
- **The sayings reviewer is a separate page**, `public/review/proverbs.html`, linked from the reviewer header. The glossary lane lives as a tab inside `review.js`. Folding proverbs in would make the reviewer one surface instead of two.
- **The register select is deliberately absent** from the saying card. Sayings have no spoken/written register; sentences do.
- The narrative is 1,430 words. If a funder caps at 1,000, cut section 5 and keep the budget table.

### Facts worth not rediscovering

- `REQUIRED_REVIEWERS` in `src/proverbreview.ts` is the only switch. `src/proverbcard.ts` used to hardcode `< 2` in its own publish check, so the card sat waiting while the API published. It imports the constant now.
- The unique index on `proverb_reviews` **must stay partial**, `WHERE undone_at IS NULL`. When it counted undone rows, an undo permanently used up that reviewer's slot: `INSERT OR IGNORE` did nothing, no review was recorded, and the publish count ran without them.
- One accept decides a saying, so a publish is a real accusation of correctness. Do not accept lines to test the UI; accept, look, then Undo.
- `/review` is behind Cloudflare Access, which also supplies the reviewer identity. The OTP goes to `khooptong@gmail.com`. Seven people have reviewer history, most of it `sut.tonsing@gmail.com`. Adding a reviewer means adding their address to the Access policy first.
- The reviewer can be driven without the browser tool: Edge with `--remote-debugging-port=9222 --user-data-dir=<scratch profile>`, then `cdp.py` in the session scratch folder (`eval`, `shot`, `goto`). That is how the click-through was verified.
- When a migration adds a table the code needs, apply the migration **before** deploying. The reverse leaves the reviewer throwing on a missing table.
- House rules from this session: no em dashes, no filled or black buttons (translucent surface, hairline border, blur, hierarchy from weight and width), and never classify Paite with a colonial exonym.


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
