#!/usr/bin/env python3
"""Brand sheet v2 — emblem + symbol, alpha handled correctly."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).resolve().parent
TMP = OUT / "_render"
INK, CRIMSON, BONE, SAGE, OCHRE = "#12100E", "#C21B33", "#F7F3EC", "#4F6B4A", "#C8A24A"


def fit(path, mw, mh, bg=BONE):
    im = Image.open(path).convert("RGBA")
    c = Image.new("RGBA", im.size, bg); c.alpha_composite(im)
    im = c.convert("RGB"); im.thumbnail((mw, mh), Image.LANCZOS); return im


def flat(path, px, bg=BONE):
    im = Image.open(path).convert("RGBA")
    c = Image.new("RGBA", im.size, bg); c.alpha_composite(im)
    return c.convert("RGB").resize((px, px), Image.LANCZOS)


def f(sz, light=True):
    for p in ((r"C:\Windows\Fonts\segoeuil.ttf" if light else r"C:\Windows\Fonts\segoeui.ttf"),
              r"C:\Windows\Fonts\arial.ttf"):
        try:
            return ImageFont.truetype(p, sz)
        except Exception:
            pass
    return ImageFont.load_default()


W, H = 1700, 1400
s = Image.new("RGB", (W, H), BONE)
d = ImageDraw.Draw(s)
d.rectangle([0, 0, W, 6], fill=CRIMSON)

d.text((70, 44), "PAITE DAILY", font=f(42), fill=INK)
d.text((72, 98), "the sash  ·  emblem v2  ·  Lamka Labs", font=f(19), fill=SAGE)

lk = fit(TMP / "lk.png", 1460, 250)
s.paste(lk, (70, 148))
d.line([70, 148 + lk.size[1] + 26, 70 + 1460, 148 + lk.size[1] + 26], fill="#E4DDCE")
y = 148 + lk.size[1] + 54

d.text((70, y), "EMBLEM", font=f(16), fill=SAGE)
x = 70
for px in (150, 96, 64, 48, 32, 16):
    s.paste(flat(TMP / "em.png", px), (x, y + 32))
    d.text((x, y + 32 + px + 10), f"{px}px", font=f(13), fill=SAGE)
    x += px + 34

d.text((820, y), "ONE-COLOUR SYMBOL", font=f(16), fill=SAGE)
s.paste(flat(TMP / "mk.png", 118), (820, y + 32))
d.text((820, y + 164), "stamps, embroidery, letterpress", font=f(13), fill=SAGE)

py = y + 250
d.text((70, py), "PALETTE", font=f(16), fill=SAGE)
sx = 70
for name, hexv in [("INK", INK), ("CRIMSON", CRIMSON), ("BONE", BONE), ("SAGE", SAGE), ("OCHRE", OCHRE)]:
    d.rectangle([sx, py + 32, sx + 158, py + 126], fill=hexv, outline="#DED6C6")
    d.text((sx, py + 136), name, font=f(15), fill=INK)
    d.text((sx, py + 158), hexv.upper(), font=f(12), fill=SAGE)
    sx += 176

oy = py + 208
d.text((70, oy), "SOCIAL CARD  1200 × 630", font=f(16), fill=SAGE)
og = fit(TMP / "og.png", 690, 380)
s.paste(og, (70, oy + 30))

tx = 800
d.text((tx, oy + 36), "The band crosses on the diagonal because that is", font=f(17), fill=INK)
d.text((tx, oy + 64), "how a Puandum is worn — over one shoulder, not", font=f(17), fill=INK)
d.text((tx, oy + 92), "laid flat. The teeth on its lower edge are warp", font=f(17), fill=INK)
d.text((tx, oy + 120), "ends: the fringe of the cloth.", font=f(17), fill=INK)

d.text((tx, oy + 172), "One band, one accent, one ring. Four saturated", font=f(15), fill=SAGE)
d.text((tx, oy + 196), "colours would read as a flag, not as cloth.", font=f(15), fill=SAGE)

s.save(OUT / "brand-sheet.png")
print("wrote brand-sheet.png", s.size)
