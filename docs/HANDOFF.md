Newest first. Each session prepends one section directly under this line.

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
