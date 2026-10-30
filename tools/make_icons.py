import os
from PIL import Image, ImageDraw, ImageFilter

BASE = "/scratch/work/app/res"

def glass_glyph(size, fg_only=False):
    """Draw the app icon glyph: four rounded glass tiles in a 2x2 grid."""
    S = size * 4  # supersample
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    if not fg_only:
        # background gradient
        bg = Image.new("RGB", (S, S), (0, 0, 0))
        bd = ImageDraw.Draw(bg)
        for y in range(S):
            t = y / S
            r = int(20 + 71 * t)
            g = int(20 + 41 * t)
            b = int(43 + 202 * t)
            bd.line([(0, y), (S, y)], fill=(r, g, b))
        img = bg.convert("RGBA")
        d = ImageDraw.Draw(img)

    # scale factor: glyph occupies ~52% of canvas for adaptive foreground
    scale = 0.40 if fg_only else 0.56
    box = S * scale
    cx, cy = S / 2, S / 2
    gap = box * 0.14
    cell = (box - gap) / 2
    x0 = cx - box / 2
    y0 = cy - box / 2
    rad = cell * 0.30

    for i in range(2):
        for j in range(2):
            x = x0 + i * (cell + gap)
            y = y0 + j * (cell + gap)
            alpha = [235, 175, 205, 145][j * 2 + i]
            layer = Image.new("RGBA", (S, S), (0, 0, 0, 0))
            ld = ImageDraw.Draw(layer)
            ld.rounded_rectangle([x, y, x + cell, y + cell], radius=rad,
                                 fill=(255, 255, 255, alpha))
            img = Image.alpha_composite(img, layer)
            d = ImageDraw.Draw(img)
            # inner highlight
            d.rounded_rectangle([x + cell * .12, y + cell * .12, x + cell * .88, y + cell * .16],
                                radius=cell * .02, fill=(255, 255, 255, 120))

    return img.resize((size, size), Image.LANCZOS)

dens = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}

for name, m in dens.items():
    ddir = f"{BASE}/drawable-{name}"
    os.makedirs(ddir, exist_ok=True)
    fg = glass_glyph(int(108 * m), fg_only=True)
    fg.save(f"{ddir}/ic_launcher_foreground.png")

    mdir = f"{BASE}/mipmap-{name}"
    os.makedirs(mdir, exist_ok=True)
    ic = glass_glyph(int(48 * m))
    ic.save(f"{mdir}/ic_launcher.png")
    # round variant: circular mask
    r = ic.copy()
    mask = Image.new("L", r.size, 0)
    ImageDraw.Draw(mask).ellipse([0, 0, r.size[0] - 1, r.size[1] - 1], fill=255)
    r.putalpha(mask)
    r.save(f"{mdir}/ic_launcher_round.png")

# store icon for the repo / store listing
big = glass_glyph(512)
big.save("/scratch/work/icon-512.png")
print("icons written")
