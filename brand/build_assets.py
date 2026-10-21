#!/usr/bin/env python3
"""
Paite Daily — brand assets v2.  SINGLE SOURCE OF TRUTH.

Two forms, two jobs:

  EMBLEM  "the sash"  — a woven band slung across a seal, the way a Puandum is
          actually worn (over one shoulder, on the diagonal), with the warp ends
          fraying off its edge. Hero mark: lockups, social card, print.

  SYMBOL  "the P"     — the monogram, with the Puandum lozenge as its counter.
          For one-colour reproduction: stamps, embroidery, letterpress, and any
          place the emblem's fine fringe would clog.

Rebuild:  python build_assets.py && python sheet2.py
"""
import subprocess, json
from pathlib import Path
from PIL import Image

OUT = Path(__file__).resolve().parent
TMP = OUT / "_render"; TMP.mkdir(exist_ok=True)
EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"

INK, CRIMSON, BONE, SAGE, OCHRE = "#12100E", "#C21B33", "#F7F3EC", "#4F6B4A", "#C8A24A"
DISPLAY = "'Young Serif',Georgia,'Times New Roman',serif"
BODY = "'Atkinson Hyperlegible','Segoe UI',Arial,sans-serif"
FONT_CSS = ("<style>@import url('https://fonts.googleapis.com/css2?"
            "family=Young+Serif&amp;family=Atkinson+Hyperlegible:wght@400;700&amp;display=swap');"
            "</style>")

# =====================================================================
# EMBLEM — the sash
# =====================================================================
E = dict(angle=-13, top=50, h=21, fringe=10, teeth=13, ring=2.2, r_ring=47, r_clip=43.5)


def emblem_body(selvedge=CRIMSON, fringed=True, small=False):
    d = dict(E)
    if small:                     # 32px cut: fewer, fatter threads; no fringe
        d.update(teeth=7, fringe=0, ring=2.8, h=23, top=49)
    p = [f'<rect x="-20" y="{d["top"]}" width="140" height="{d["h"]}" fill="{BONE}"/>']
    p.append(f'<rect x="-20" y="{d["top"]+2.4}" width="140" height="3.4" fill="{selvedge}"/>')
    if d["fringe"]:
        pitch = 140.0 / d["teeth"]
        w = pitch * 0.44
        x0 = -20 + (pitch - w) / 2
        for i in range(d["teeth"]):
            p.append(f'<rect x="{x0 + i*pitch:.2f}" y="{d["top"]+d["h"]}" '
                     f'width="{w:.2f}" height="{d["fringe"]}" fill="{BONE}"/>')
    inner = "".join(p)
    return (f'<rect width="100" height="100" fill="{INK}"/>'
            f'<defs><clipPath id="ec"><circle cx="50" cy="50" r="{d["r_clip"]}"/></clipPath></defs>'
            f'<g clip-path="url(#ec)"><g transform="rotate({d["angle"]} 50 50)">{inner}</g></g>'
            f'<circle cx="50" cy="50" r="{d["r_ring"]}" fill="none" stroke="{BONE}" '
            f'stroke-width="{d["ring"]}"/>')


# =====================================================================
# SYMBOL — the P with a lozenge counter
# =====================================================================
SX, SW, SY0, SY1 = 20, 16, 12, 84
BCX, BCY, BR, DH = 60, 38, 26, 15


def symbol_body(color=BONE, bg=INK):
    diamond = f'M {BCX},{BCY-DH} L {BCX+DH},{BCY} L {BCX},{BCY+DH} L {BCX-DH},{BCY} Z'
    bowl = (f'<path d="M {BCX-BR},{BCY} a {BR},{BR} 0 1,0 {BR*2},0 a {BR},{BR} 0 1,0 {-BR*2},0 Z '
            f'{diamond}" fill="{color}" fill-rule="evenodd"/>')
    stem = f'<rect x="{SX}" y="{SY0}" width="{SW}" height="{SY1-SY0}" fill="{color}"/>'
    ground = f'<rect width="100" height="100" fill="{bg}"/>' if bg else ""
    return f'{ground}{stem}{bowl}'


# =====================================================================
# SVG plumbing
# =====================================================================
def svg(body, w, h, vb=None, text=False):
    vb = vb or f"0 0 {w} {h}"
    head = FONT_CSS if text else ""
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" '
            f'viewBox="{vb}">{head}{body}</svg>')


V100 = "0 0 100 100"

files = {
    "emblem.svg": svg(emblem_body(), 512, 512, V100),
    "emblem-small.svg": svg(emblem_body(small=True), 64, 64, V100),
    "mark.svg": svg(symbol_body(), 512, 512, V100),
    "mark-small.svg": svg(symbol_body(), 64, 64, V100),
    "mark-mono.svg": svg(symbol_body(INK, bg=None), 512, 512, V100),
}


def lockup_h(w=1200, h=320):
    m, pad = h * 0.62, h * 0.09
    ty = (h - m) / 2
    tx = pad + m + h * 0.15
    return svg(
        f'<g transform="translate({pad},{ty}) scale({m/100})">{emblem_body()}</g>'
        f'<text x="{tx}" y="{h*0.435}" font-family="{DISPLAY}" font-size="{h*0.195}" font-weight="400" '
        f'letter-spacing="{h*0.026}" fill="{INK}">PAITE DAILY</text>'
        f'<rect x="{tx}" y="{h*0.505}" width="{h*0.66}" height="{max(1, h*0.007)}" fill="{CRIMSON}"/>'
        f'<text x="{tx}" y="{h*0.655}" font-family="{BODY}" font-size="{h*0.050}" font-weight="400" '
        f'letter-spacing="{h*0.019}" fill="{SAGE}">A PAITE&#8211;ENGLISH CORPUS</text>', w, h, None, True)


def lockup_v(w=800, h=800):
    m = h * 0.40
    return svg(
        f'<g transform="translate({(w-m)/2},{h*0.09}) scale({m/100})">{emblem_body()}</g>'
        f'<text x="{w/2}" y="{h*0.77}" text-anchor="middle" font-family="{DISPLAY}" '
        f'font-size="{h*0.086}" font-weight="400" letter-spacing="{h*0.010}" '
        f'fill="{INK}">PAITE DAILY</text>'
        f'<rect x="{w*0.34}" y="{h*0.805}" width="{w*0.32}" height="3" fill="{CRIMSON}"/>'
        f'<text x="{w/2}" y="{h*0.868}" text-anchor="middle" font-family="{BODY}" '
        f'font-size="{h*0.026}" font-weight="400" letter-spacing="{h*0.011}" fill="{SAGE}">'
        f'A PAITE&#8211;ENGLISH CORPUS</text>', w, h, None, True)


files["lockup-horizontal.svg"] = lockup_h(1200, 320)
files["lockup-stacked.svg"] = lockup_v(800, 800)

files["og.svg"] = svg(
    f'<rect width="1200" height="630" fill="{BONE}"/>'
    f'<rect x="0" y="0" width="1200" height="7" fill="{CRIMSON}"/>'
    f'<g transform="translate(96,136) scale(2.5)">{emblem_body()}</g>'
    f'<text x="404" y="246" font-family="{DISPLAY}" font-size="76" font-weight="400" letter-spacing="5" '
    f'fill="{INK}">PAITE DAILY</text>'
    f'<rect x="406" y="278" width="400" height="5" fill="{CRIMSON}"/>'
    f'<text x="406" y="332" font-family="{BODY}" font-size="25" font-weight="400" letter-spacing="5" '
    f'fill="{SAGE}">A PAITE&#8211;ENGLISH CORPUS</text>'
    f'<text x="406" y="400" font-family="{BODY}" font-size="26" font-weight="300" fill="{INK}">'
    f'78,725 speakers. No spellchecker.</text>'
    f'<text x="406" y="442" font-family="{BODY}" font-size="26" font-weight="300" fill="{INK}">'
    f'Every pair reviewed by a native speaker.</text>'
    f'<text x="406" y="484" font-family="{BODY}" font-size="26" font-weight="300" fill="{INK}">'
    f'Released to the public domain.</text>'
    f'<text x="96" y="562" font-family="{BODY}" font-size="19" font-weight="400" letter-spacing="4" '
    f'fill="{SAGE}">PAITE.LAMKALABS.COM</text>'
    f'<text x="1104" y="562" text-anchor="end" font-family="{BODY}" font-size="19" font-weight="400" '
    f'letter-spacing="4" fill="{SAGE}">LAMKA LABS</text>', 1200, 630, None, True)

for name, content in files.items():
    (OUT / name).write_text(content, encoding="utf-8")


# =====================================================================
# render + icons
# =====================================================================
def render(swg, png, w, h, scale=1):
    dst = (TMP / png).as_posix()
    subprocess.run([EDGE, "--headless=new", "--disable-gpu", "--hide-scrollbars",
                    f"--force-device-scale-factor={scale}", "--default-background-color=00000000",
                    f"--window-size={w},{h}", f"--screenshot={dst}",
                    f"file:///{(OUT / swg).as_posix()}"], capture_output=True, timeout=120)
    return TMP / png


print("rendering…")
em = render("emblem.svg", "em.png", 512, 512)
render("emblem.svg", "em1024.png", 512, 512, 2)
ems = render("emblem-small.svg", "ems.png", 64, 64)
render("emblem-small.svg", "ems16.png", 16, 16)
render("mark.svg", "mk.png", 512, 512)
render("lockup-horizontal.svg", "lk.png", 1200, 320, 2)
render("lockup-stacked.svg", "st.png", 800, 800, 2)
ogp = render("og.svg", "og.png", 1200, 630)

base = Image.open(em).convert("RGBA")
small = Image.open(ems).convert("RGBA")


def save_icon(px, src, name):
    src.resize((px, px), Image.LANCZOS).save(OUT / name)


save_icon(512, base, "icon-512.png")
save_icon(192, base, "icon-192.png")
save_icon(180, base, "apple-touch-icon.png")
save_icon(32, small, "favicon-32.png")
save_icon(16, small, "favicon-16.png")
base.resize((256, 256), Image.LANCZOS).save(
    OUT / "favicon.ico", format="ICO",
    sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])

# standalone og png
Image.open(ogp).convert("RGB").save(OUT / "og.png")

manifest = {
    "name": "Paite Daily — a Paite–English corpus",
    "short_name": "Paite Daily",
    "description": "A volunteer-reviewed Paite–English corpus. Every pair checked by a native speaker, released to the public domain.",
    "id": "/", "start_url": "/", "scope": "/", "display": "standalone",
    "background_color": INK, "theme_color": INK, "lang": "en",
    "icons": [
        {"src": "/icon-192.png", "sizes": "192x192", "type": "image/png"},
        {"src": "/icon-512.png", "sizes": "512x512", "type": "image/png"},
        {"src": "/emblem-small.svg", "sizes": "any", "type": "image/svg+xml", "purpose": "any"},
    ],
}
(OUT / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")

(OUT / "head-icons.html").write_text(
    '<!-- icons -->\n'
    '<link rel="icon" href="/favicon.ico" sizes="32x32">\n'
    '<link rel="icon" href="/emblem-small.svg" type="image/svg+xml">\n'
    '<link rel="apple-touch-icon" href="/apple-touch-icon.png">\n'
    '<link rel="manifest" href="/manifest.json">\n'
    '<meta name="theme-color" content="#12100E">\n', encoding="utf-8")

print("assets done")
