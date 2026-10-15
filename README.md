# Paite Daily

Paite Daily collects translations of simple English sentences into Paite. People answer on their phones with no account. Reviewers check the answers, and the verified ones go to the open dataset [paite-open-language-data](https://github.com/khooptong-sudo/paite-open-language-data) under CC0. The app is a Cloudflare Worker with a D1 database.

Live: https://paite.lamkalabs.com

## Owner steps (accounts needed)

1. Run `npx wrangler login` in this folder.
2. Cloudflare dashboard, Zero Trust: create a team (free plan). Note the team domain, for example `lamkalabs.cloudflareaccess.com`.
3. Zero Trust, Access, Applications: add a self-hosted application with domain `paite.lamkalabs.com` and path `review`. Policy: Allow, Include, Emails, then the reviewer emails. Login method: One-time PIN. Note the Application Audience (AUD) tag.
4. Turnstile: add a widget for `paite.lamkalabs.com`, mode Invisible. Note the site key and secret.
5. GitHub, Settings, Developer settings, Fine-grained tokens: create a token for only the repository `paite-open-language-data`, with Contents: Read and write.

## Configure

```powershell
npx wrangler d1 create paite-daily
```

Copy the printed `database_id` into `wrangler.jsonc`. Set these vars there: `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`, `TURNSTILE_SITE_KEY`. Do not put reviewer emails in this public file. Add the domain:

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
