# Paite Daily

Paite Daily collects translations of simple English sentences into Paite. People answer on their phones with no account. Reviewers check the answers, and the verified ones go to the open dataset [paite-open-language-data](https://github.com/khooptong-sudo/paite-open-language-data) (answers sent before 2026-10-21 18:47 UTC are CC0 1.0, later ones CC BY 4.0; each line's `licence` field says which). The app is a Cloudflare Worker with a D1 database.

Live: https://paite.lamkalabs.com

## Owner steps (accounts needed)

1. Run `npx wrangler login` in this folder.
2. Turnstile: add a widget for `paite.lamkalabs.com`, mode Invisible. Note the site key and secret.
3. GitHub, Settings, Developer settings, Fine-grained tokens: create a token for only the repository `paite-open-language-data`, with Contents: Read and write.

## Reviewer sign-in

Reviewers sign in at `/review/login` with their email and a password. There is no Cloudflare Access application in front of `/review`.

- A reviewer is anyone in the `REVIEWERS` secret, an active row in the `reviewers` table, or an owner in `OWNER_EMAIL`.
- Nobody is given a password. On the sign-in page, "Set or reset my password" emails a one-time link (one hour) to choose one. Approving an application emails the new reviewer the same kind of link (seven days).
- A sign-in lasts 30 days on a device. Choosing a new password signs out every device.
- Ten wrong passwords for one email in fifteen minutes lock that email for the rest of the fifteen minutes. A new password through the emailed link clears the lock.
- The database holds a salted PBKDF2 hash of each password and a SHA-256 of each session and link token, never the values themselves. The code is in `src/login.ts`.

## Configure

```powershell
npx wrangler d1 create paite-daily
```

Copy the printed `database_id` into `wrangler.jsonc`. Set this var there: `TURNSTILE_SITE_KEY`. Do not put reviewer emails in this public file. Add the domain:

```jsonc
"routes": [{ "pattern": "paite.lamkalabs.com", "custom_domain": true }],
```

Set the secrets. Each command asks for the value. `REVIEWERS` is a JSON map of each reviewer email to a display name, for example `{"a@example.org":"Ann"}`. `OWNER_EMAIL` is the owner email. It may hold several emails, separated by commas.

```powershell
npx wrangler secret put TURNSTILE_SECRET
npx wrangler secret put SESSION_SECRET
npx wrangler secret put GITHUB_TOKEN
npx wrangler secret put REVIEWERS
npx wrangler secret put OWNER_EMAIL
```

For local runs, put the same values in `.dev.vars` (not committed). It must hold `TURNSTILE_SECRET`, `SESSION_SECRET`, `GITHUB_TOKEN`, `REVIEWERS` and `OWNER_EMAIL`.

For `SESSION_SECRET`, paste the output of `node -e "console.log(crypto.randomUUID()+crypto.randomUUID())"`.

## Migrate, seed, deploy

```powershell
node scripts/seed.mjs ../paite_corpus/prompts/everyday_en.txt seed.sql; if ($LASTEXITCODE -eq 0) { npx wrangler d1 migrations apply paite-daily --remote }; if ($LASTEXITCODE -eq 0) { npx wrangler d1 execute paite-daily --remote --file seed.sql }; if ($LASTEXITCODE -eq 0) { npx wrangler d1 execute paite-daily --remote --command "SELECT count(*) AS n FROM sentences" }; if ($LASTEXITCODE -eq 0) { npm run deploy }
```

The count must be 196.

## Mobile app

The site is also a Progressive Web App. `public/manifest.webmanifest` and `public/sw.js` make it installable, and the front page, the word list and the contributors page each carry a download row. The review page has no download row.

`public/paite-daily.apk` is a signed Android package. It is a Trusted Web Activity made with Bubblewrap, so Android opens the site in the app with no browser bar. `public/.well-known/assetlinks.json` holds the signing certificate fingerprint that makes that work.

The Android project and the signing key live outside this repository, at `F:\Resources\paite-android`. Keep them there. The key must never enter the repository. The keystore password is in `F:\KEYS\Paite Daily Android keystore.txt`.

Build a new package and copy it into the site:

```powershell
cd F:\Resources\paite-android
$env:BUBBLEWRAP_KEYSTORE_PASSWORD = (Select-String -Path "F:\KEYS\Paite Daily Android keystore.txt" -Pattern "^password: ").Line -replace "^password: ", ""
$env:BUBBLEWRAP_KEY_PASSWORD = $env:BUBBLEWRAP_KEYSTORE_PASSWORD
npx bubblewrap build
Copy-Item app-release-signed.apk F:\Resources\paite-daily\public\paite-daily.apk
```

Use the same signing key for every build. A different key breaks the update path on every installed device.

## Run tests

```powershell
npm test
```

## Licence

The code is dual-licensed: use it under either the [MIT licence](LICENSE-MIT) or the [Apache License 2.0](LICENSE-APACHE), whichever you prefer (SPDX: `MIT OR Apache-2.0`). Unless you say otherwise, any contribution you send is offered under the same two licences.

The data the site collects is not covered by these files. Each exported line carries its own `licence` field: `CC0-1.0` for answers sent before 2026-10-21 18:47 UTC, when the form said "public domain", and `CC-BY-4.0` after, when it says "with credit". The column `answers.licence` (migration `0031`) records it per answer. Voice recordings are CC BY 4.0, from the consent box on the recorder. The nightly `audio` job copies accepted clips to `audio/` in the dataset repo (at most 10 a night, `recordings.exported_at`, migration `0032`), rewrites `audio/recordings.jsonl`, and takes down any clip whose review was undone.
