# Installing the brand kit

Target repo: `H:\Resources\paite-daily` (`/h/Resources/paite-daily`)
This folder (`brand/`) is **source, not shipped**. Nothing here is served yet. The site's actual
icon and social-card paths are different from the flat filenames in this kit, see the mapping.

## 0. Before you touch anything

```bash
cd /h/Resources/paite-daily
mkdir -p brand/before
cp public/icons/apple-touch-icon.png public/icons/icon-192.png \
   public/icons/icon-512.png public/icons/icon-maskable-512.png \
   public/og.png public/manifest.webmanifest public/index.html brand/before/
```

Six files, backed up and committable. If the new mark is rejected you restore in one `cp`.

## 1. Icons → `public/icons/`

The site already points at `/icons/…` and uses a 192 PNG as its favicon, so keep the same
filenames rather than adding new ones.

| Kit file | Destination | Notes |
|---|---|---|
| `apple-touch-icon.png` | `public/icons/apple-touch-icon.png` | 180×180 |
| `icon-192.png` | `public/icons/icon-192.png` | also serves as the favicon |
| `icon-512.png` | `public/icons/icon-512.png` | |
| `icon-512.png` | `public/icons/icon-maskable-512.png` | same art; the emblem already keeps a 6% margin inside the circle |
| `favicon.ico` | `public/favicon.ico` | new, nothing occupies this path today |
| `emblem-small.svg` | `public/icons/emblem-small.svg` | new, crisp at any size |

```bash
cp brand/apple-touch-icon.png brand/icon-192.png brand/icon-512.png public/icons/
cp brand/icon-512.png public/icons/icon-maskable-512.png
cp brand/favicon.ico public/favicon.ico
cp brand/emblem-small.svg public/icons/emblem-small.svg
```

## 2. `public/index.html`, head

Three changes only. **Do not** add my `head-icons.html` wholesale: it uses `/emblem-small.svg`,
but your icons live under `/icons/`.

```diff
-<meta name="theme-color" content="#ffffff">
+<meta name="theme-color" content="#12100E">
 <link rel="manifest" href="/manifest.webmanifest">
 <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
-<link rel="icon" href="/icons/icon-192.png" sizes="192x192">
+<link rel="icon" href="/favicon.ico" sizes="32x32">
+<link rel="icon" href="/icons/emblem-small.svg" type="image/svg+xml">
+<link rel="icon" href="/icons/icon-192.png" sizes="192x192">
...
-<meta property="og:title" content="Paite Daily, one sentence a day">
+<meta property="og:title" content="Paite Daily, a Paite word corpus">
-<meta name="twitter:title" content="Paite Daily, one sentence a day">
+<meta name="twitter:title" content="Paite Daily, a Paite word corpus">
```

Also drop the two `one sentence a day` phrases from `og:description` and `twitter:description`,
and from `og:image:alt` / `twitter:image:alt`, which currently repeat it.

**`theme-color` is optional.** `#12100E` matches the mark; `#ffffff` matches the page. On a light
site the browser chrome going dark is a design choice, not a correctness one, pick one and stop
thinking about it.

## 3. ⚠️ The head is duplicated in four places

This is the trap. The same `<head>` block is emitted from four files:

```
public/index.html
src/glossary.ts
src/proverbs.ts
src/contributors.ts
```

Any title, OG or icon change has to land in **all four**, or `/glossary` and `/proverbs` will
keep serving the old card and the old title. Sweep them together:

```bash
grep -rn "one sentence a day\|og:title\|icon-192\|apple-touch-icon" \
  public/index.html src/*.ts
```

## 4. `public/manifest.webmanifest`

Keep the file name and the existing keys, add, don't replace:

```diff
-  "background_color": "#ffffff",
-  "theme_color": "#ffffff",
+  "background_color": "#12100E",
+  "theme_color": "#12100E",
   "icons": [
     { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
     { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" },
-    { "src": "/icons/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
+    { "src": "/icons/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" },
+    { "src": "/icons/emblem-small.svg", "sizes": "any", "type": "image/svg+xml", "purpose": "any" }
   ]
```

`brand/manifest.json` is my generic version, useful as a reference, **not** a drop-in: it is
named `.json`, sits at a different path, and drops `orientation` and `categories`.

## 5. `public/og.png`

`brand/og.png` is 1200×630 and replaces the current card. It is the most visible asset here, view
both before swapping, and keep the old one in `brand/before/`. Note that `og:image`, `twitter:image`
in the four head files all point at `/og.png`, so the filename stays the same and no code changes.

## 6. What is *not* installable

`brand/` contains no `/about` page, because your site has no static pages, `glossary`, `proverbs`
and `contributors` are TypeScript routes that build HTML strings and import `FOOTER` from
`./footer`. The approved About copy has to become `src/about.ts` in the same shape, and be wired
into whatever router `src/index.ts` uses. That's a code change, not a file copy.

## 7. Regenerating

```bash
cd brand
python build_assets.py     # SVG sources -> _render -> icons, ico, og, manifest
python sheet2.py           # contact sheet
```

Requires Python with Pillow, and Microsoft Edge for headless SVG rasterisation
(`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`). If Edge moves, edit `EDGE` in
`build_assets.py`. `_render/` is scratch, add it to `.gitignore`.
