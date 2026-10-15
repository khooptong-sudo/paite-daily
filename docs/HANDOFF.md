Newest first. Each session prepends one section directly under this line.

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
