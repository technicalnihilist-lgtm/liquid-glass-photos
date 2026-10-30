"""Build a preview harness for the app UI (sample media + stub native bridge).

The APK itself ships with NO sample media - this harness exists only so the UI
can be rendered in a desktop browser for verification and screenshots.
"""
import json, os, random, math, datetime
from PIL import Image, ImageDraw, ImageFilter

OUT = "/scratch/work/preview"
IMG = f"{OUT}/img"
os.makedirs(IMG, exist_ok=True)

random.seed(7)


def grad(w, h, stops):
    img = Image.new("RGB", (w, h))
    d = ImageDraw.Draw(img)
    for y in range(h):
        t = y / max(1, h - 1)
        pos = t * (len(stops) - 1)
        i = min(int(pos), len(stops) - 2)
        f = pos - i
        c0, c1 = stops[i], stops[i + 1]
        col = tuple(int(c0[k] + (c1[k] - c0[k]) * f) for k in range(3))
        d.line([(0, y), (w, y)], fill=col)
    return img


def ridge(img, base, amp, col, step=26):
    w, h = img.size
    d = ImageDraw.Draw(img, "RGBA")
    pts = [(0, h)]
    x = 0
    while x <= w + step:
        pts.append((x, base - random.random() * amp))
        x += step * (0.6 + random.random() * 0.9)
    pts.append((w, h))
    d.polygon(pts, fill=col)
    return img


def glow(img, cx, cy, rad, col):
    w, h = img.size
    layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    for r in range(rad, 0, -max(1, rad // 40)):
        a = int(col[3] * (1 - r / rad) ** 1.6)
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=col[:3] + (a,))
    return Image.alpha_composite(img.convert("RGBA"), layer).convert("RGB")


def stars(img, n):
    w, h = img.size
    d = ImageDraw.Draw(img, "RGBA")
    for _ in range(n):
        x, y = random.random() * w, random.random() * h * 0.7
        r = random.random() * 1.4 + 0.3
        a = int(120 + random.random() * 135)
        d.ellipse([x - r, y - r, x + r, y + r], fill=(255, 255, 255, a))
    return img


def make(kind, w, h):
    if kind == "sunset":
        im = grad(w, h, [(42, 20, 87), (184, 58, 122), (255, 138, 61), (255, 210, 122)])
        im = glow(im, w * 0.5, h * 0.62, int(h * 0.55), (255, 235, 170, 220))
        ridge(im, h * 0.74, h * 0.13, (90, 42, 110))
        ridge(im, h * 0.84, h * 0.1, (43, 18, 69))
        im = ridge(im, h * 0.94, h * 0.06, (20, 8, 42))
    elif kind == "mountains":
        im = grad(w, h, [(79, 156, 255), (207, 232, 255), (255, 243, 224)])
        im = glow(im, w * 0.8, h * 0.2, int(w * 0.35), (255, 255, 255, 190))
        ridge(im, h * 0.55, h * 0.28, (138, 160, 200), 60)
        ridge(im, h * 0.68, h * 0.25, (82, 104, 156), 52)
        ridge(im, h * 0.82, h * 0.2, (42, 59, 102), 44)
        im = ridge(im, h * 0.95, h * 0.1, (22, 33, 63), 36)
    elif kind == "ocean":
        im = grad(w, h, [(255, 154, 98), (255, 217, 168), (255, 240, 208)])
        im = glow(im, w * 0.45, h * 0.45, int(w * 0.4), (255, 255, 220, 200))
        d = ImageDraw.Draw(im, "RGBA")
        for i in range(7):
            y = h * (0.5 + i * 0.075)
            col = (int(120 + i * 10), int(200 - i * 8), int(210 - i * 6), 210)
            d.rectangle([0, y, w, y + h * 0.075], fill=col)
    elif kind == "night":
        im = grad(w, h, [(4, 6, 26), (19, 32, 107), (44, 63, 154)])
        im = stars(im, 260)
        im = glow(im, w * 0.75, h * 0.2, int(w * 0.22), (255, 250, 220, 150))
        d = ImageDraw.Draw(im)
        d.ellipse([w * 0.75 - h * 0.05, h * 0.2 - h * 0.05, w * 0.75 + h * 0.05, h * 0.2 + h * 0.05],
                  fill=(255, 251, 224))
        ridge(im, h * 0.84, h * 0.1, (8, 10, 30))
        im = ridge(im, h * 0.95, h * 0.05, (3, 4, 15))
    elif kind == "forest":
        im = grad(w, h, [(207, 238, 214), (244, 250, 220)])
        d = ImageDraw.Draw(im, "RGBA")
        for col, yb, sc in [((127, 184, 138), 0.55, 0.9), ((79, 154, 100), 0.7, 1.1),
                            ((47, 116, 72), 0.85, 1.3), ((23, 73, 44), 1.0, 1.6)]:
            x = -20
            while x < w + 40:
                hh = (70 + random.random() * 70) * sc
                y = h * yb
                d.polygon([(x, y - hh), (x - hh * 0.28, y), (x + hh * 0.28, y)], fill=col)
                d.rectangle([x - 2, y, x + 2, h], fill=col)
                x += 34 * sc * (0.7 + random.random() * 0.6)
            d.rectangle([0, min(h - 1, h * yb + 4), w, h], fill=col)
        im = im
    elif kind == "desert":
        im = grad(w, h, [(255, 157, 92), (255, 217, 160), (255, 241, 207)])
        im = glow(im, w * 0.5, h * 0.35, int(w * 0.45), (255, 255, 230, 190))
        d = ImageDraw.Draw(im, "RGBA")
        for i, col in enumerate([(233, 164, 92), (217, 137, 69), (191, 108, 50), (143, 74, 34)]):
            base = h * (0.55 + i * 0.12)
            pts = [(0, h)]
            for x in range(0, w + 8, 8):
                pts.append((x, base + math.sin(x * 0.006 + i) * (20 + i * 8)))
            pts.append((w, h))
            d.polygon(pts, fill=col)
    else:  # aurora
        im = grad(w, h, [(2, 5, 15), (7, 26, 43), (11, 42, 51)])
        im = stars(im, 180)
        layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        d = ImageDraw.Draw(layer)
        for i, col in enumerate([(60, 255, 160, 120), (150, 90, 255, 90), (80, 220, 255, 80)]):
            cx = w * (0.25 + i * 0.25)
            cy = h * (0.3 + i * 0.05)
            for r in range(int(h * 0.3), 0, -8):
                a = int(col[3] * (1 - r / (h * 0.3)))
                d.ellipse([cx - r * 2.2, cy - r, cx + r * 2.2, cy + r], fill=col[:3] + (a,))
        im = Image.alpha_composite(im.convert("RGBA"), layer.filter(ImageFilter.GaussianBlur(14))).convert("RGB")
        im = ridge(im, h * 0.88, h * 0.08, (2, 7, 13))
    # subtle vignette + grain for a photographic feel
    im = im.filter(ImageFilter.GaussianBlur(0.4))
    return im


def screenshot(kind, w, h):
    """Fake phone screenshot look."""
    im = Image.new("RGB", (w, h), (250, 250, 252))
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, w, int(h * 0.09)], fill=(255, 255, 255))
    d.text((w * 0.06, h * 0.04), "9:41", fill=(20, 20, 20))
    for i in range(4):
        y = h * (0.16 + i * 0.18)
        d.rounded_rectangle([w * 0.06, y, w * 0.94, y + h * 0.13], radius=14,
                            fill=(240, 240, 245))
    d.rounded_rectangle([w * 0.06, h * 0.86, w * 0.94, h * 0.92], radius=18, fill=(0, 122, 255))
    return im


TYPES = ["sunset", "mountains", "ocean", "night", "forest", "desert", "aurora"]
BUCKETS = ["Camera", "Camera", "Camera", "WhatsApp Images", "Download", "Instagram", "DCIM"]
now = datetime.datetime(2026, 10, 30, 11, 20)
items = []
idx = 1
for i in range(44):
    kind = TYPES[i % len(TYPES)]
    landscape = i % 3 != 0
    w, h = (1080, 810) if landscape else (810, 1080)
    if i in (5, 21, 33):
        im = screenshot(kind, w, h)
        bucket = "Screenshots"
        name = f"Screenshot_2026102{9 - i // 7}_{10 + i}.png"
    else:
        im = make(kind, w, h)
        bucket = BUCKETS[i % len(BUCKETS)]
        name = f"IMG_2026102{9 - i // 6}_{(1000 + i * 7) % 2400}.jpg"
    im.save(f"{IMG}/{idx}.jpg", quality=88)
    dt = now - datetime.timedelta(days=i // 5, hours=(i % 5) * 3, minutes=i * 3)
    items.append({
        "id": idx, "v": 1 if i in (11, 26) else 0, "n": name, "b": bucket,
        "m": "video/mp4" if i in (11, 26) else "image/jpeg",
        "d": int(dt.timestamp() * 1000), "s": 1_900_000 + i * 91_337,
        "w": w, "h": h,
    })
    idx += 1

html = open("/scratch/work/app/assets/index.html", encoding="utf-8").read()

stub = """<script>
(function(){
  const ITEMS = %s;
  const FAVS = [2, 7, 19, 31, 38];
  window.AndroidNative = {
    meta(){ return JSON.stringify({sdk:34,device:'Pixel 8',android:'14',access:true,insetTop:74,insetBottom:48,light:false}); },
    access(){ return true; },
    requestAccess(){},
    photos(){ return JSON.stringify({count:ITEMS.length,items:ITEMS}); },
    favs(){ return JSON.stringify(FAVS); },
    setFav(){}, share(){}, delete(){}, pick(){}, theme(){}, info(){},
    playVideo(id){ (window.__played = window.__played || []).push(id); }
  };
})();
</script>
""" % json.dumps(items)

driver = """<script>
const SHOT = new URLSearchParams(location.search).get('shot') || 'library';
function q(s){return document.querySelector(s)}
function click(s){const e=q(s); if(e) e.click();}
setTimeout(function(){
  if(SHOT==='albums') click('[data-tab="albums"]');
  else if(SHOT==='search') click('[data-tab="search"]');
  else if(SHOT==='viewer'){ const t=q('.tile'); if(t) t.click(); }
  else if(SHOT==='video'){
    const list=current().map(function(p){return p.id});
    const i=current().findIndex(function(p){return p.kind==='video'});
    if(i>=0) openViewer(list,i);
  }
  else if(SHOT==='select'){
    click('[data-act="startsel"]');
    setTimeout(function(){ document.querySelectorAll('.tile').forEach(function(t,i){ if(i<4) t.click(); }); },250);
  }
  else if(SHOT==='settings') click('[data-act="settings"]');
  else if(SHOT==='camera'){
    click('[data-tab="albums"]');
    setTimeout(function(){ click('[data-album="camera"]'); },500);
  }
},1200);
</script>
</body>"""

html = html.replace("<body>", "<body>\n" + stub, 1)
html = html.replace("</body>", driver, 1)
open(f"{OUT}/index.html", "w", encoding="utf-8").write(html)

json.dump(items, open(f"{OUT}/items.json", "w"), indent=1)
print("preview built:", len(items), "sample items")
