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

Set the secrets. Each command asks for the value. `REVIEWERS` is a JSON map of each reviewer email to a display name, for example `{"a@example.org":"Ann"}`. `OWNER_EMAIL` is the owner email.

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
node scripts/seed.mjs ../paite_corpus/prompts/everyday_en.txt seed.sql; npx wrangler d1 migrations apply paite-daily --remote; npx wrangler d1 execute paite-daily --remote --file seed.sql; npx wrangler d1 execute paite-daily --remote --command "SELECT count(*) AS n FROM sentences"; npm run deploy
```

The count must be 196.

## Run tests

```powershell
npm test
```
