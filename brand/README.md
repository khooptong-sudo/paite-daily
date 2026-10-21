# Paite Daily — brand kit v2

Two forms, two jobs. Don't swap them.

**EMBLEM — "the sash".** A woven band slung across a seal, with its warp ends fraying off the
lower edge. The band crosses on the **diagonal** because that is how a Puandum is worn: over one
shoulder, not laid flat. This is the brand mark — lockups, social card, print, anything at or above
32px.

**SYMBOL — "the P".** The monogram, with the Puandum lozenge as its counter. One-colour cut for
stamps, embroidery, letterpress, and any process where the emblem's fine fringe would clog.

Between them: nothing else. No gradients, no second accent, no illustrated shawl.

## Files

| File | Use |
|---|---|
| `emblem.svg` | The brand mark. Master vector, 100×100 artboard |
| `emblem-small.svg` | Optical cut for 32px and below: fewer, fatter threads, no fringe |
| `icon-512.png` | PWA / store icon, 512×512 |
| `icon-192.png` | PWA icon 192, and the served favicon |
| `apple-touch-icon.png` | 180×180, opaque, iOS home screen |
| `favicon.ico` | 16/24/32/48/64/128/256 multi-res |
| `favicon-16.png`, `favicon-32.png` | PNG fallbacks |
| `mark.svg`, `mark-small.svg` | The P symbol, full and small |
| `mark-mono.svg` | The P on transparent, single ink — stamps, embroidery, foil |
| `lockup-horizontal.svg` | Emblem + wordmark + rule + descriptor |
| `lockup-stacked.svg` | Centred lockup, for covers and print |
| `og.svg`, `og.png` | 1200×630 social card |
| `manifest.json` | Generic PWA manifest — **reference only**, the site uses `manifest.webmanifest` |
| `head-icons.html` | **Reference only** — live icon paths are under `/icons/`. Use `INSTALL.md` |
| `INSTALL.md` | Where each file goes in `paite-daily`, with backups |
| `brand-sheet.png` | Flattened sheet for sharing |
| `build_assets.py`, `sheet2.py` | Regenerate everything |

Rebuild: `python build_assets.py && python sheet2.py` (needs Pillow + Microsoft Edge for headless
SVG rasterisation).

## Palette

| Token | Hex | Role |
|---|---|---|
| Ink | `#12100E` | Ground. Warm near-black, never `#000` |
| Crimson | `#C21B33` | **One** accent: the selvedge line, the rule, the active state |
| Bone | `#F7F3EC` | The cloth, inverse type |
| Sage | `#4F6B4A` | Secondary type, metadata |
| Ochre | `#C8A24A` | Tertiary. Metrics only |

A Puandum is black, red, green and yellow. Held at this restraint it reads as textile rather than
as a flag — crimson is the only saturated field, sage and ochre appear at hairline weight or as
type. Four saturated colours is the failure mode; resist it.

## Rules

- **Clear space** all sides = 25% of the emblem's diameter. Nothing enters it.
- **Minimum sizes** — emblem 32px (use `emblem-small.svg` below that), horizontal lockup 120px
  wide, stacked lockup 180px wide, symbol 16px.
- **The fringe is the point.** Never redraw it as a comb, a barcode or a dashed rule. If a process
  can't hold 13 threads at the target size, drop to `emblem-small.svg`.
- **Never** recolour the crimson selvedge to anything but crimson or Ink.
- **Never** place the emblem on a busy photograph. On photography, put a solid Ink disc behind it.
- **Never** stretch, rotate, add a stroke, add a shadow, or re-round it — the emblem is already
  circular; the OS applies its own mask.
- One-colour reproduction: swap to `mark-mono.svg`. Ink on Bone, or Bone on Ink. Nothing else.

## Typography

Wordmark: **Young Serif** (the site's display face). Descriptor and metadata: **Atkinson
Hyperlegible**. Both are `@import`ed from Google Fonts inside the SVGs, so they render correctly in
a browser and fall back to Georgia offline.

**Before print, signage or store assets, convert the text to outlines.** A logo that reflows on a
machine without your fonts is not a logo.

## Swapping the name

1. Edit the `<text>` strings in `lockup_h()`, `lockup_v()` and the og block in `build_assets.py`.
2. `python build_assets.py && python sheet2.py`.
3. In the site's JSON-LD, set `"alternateName"` to the **old** name for one full cycle so existing
   search history carries across.
4. Sweep **all four** head files — `public/index.html`, `src/glossary.ts`, `src/proverbs.ts`,
   `src/contributors.ts` — plus `manifest.webmanifest` and the repo description. A cleaned body
   with a stale `<title>` still fails.

## Provenance

Every form is geometry derived from the reference photographs at `paite.org` (Puandum, Aksi Puan,
Ngoutekhelh), the published Paite Laimal, and the way the shawl is actually worn. No stock assets,
no traced source, no generated raster. All SVG is hand-authored and rebuildable from
`build_assets.py`.
