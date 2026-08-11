#!/usr/bin/env python3
"""
Generates the app icon, Android adaptive foreground, splash and notification
icon from one vector-ish description, so the mark can be tweaked in one place
and re-rendered rather than hand-edited in a binary.

    python3 mobile/assets/generate-assets.py

The mark is a filled speech bubble with three rising dots punched out of it:
the product is coaches who message you, and the rising dots read as progress
without tying the icon to any one discipline (the roster spans drummers,
songwriters and yoga instructors as well as trainers). The bubble is filled
with an amber -> violet -> cyan sweep, which is the same spread the roster
uses to tint coach categories.

Requires Pillow. Everything is drawn at 4x and downsampled for antialiasing.
"""

from PIL import Image, ImageDraw, ImageFilter

SS = 4  # supersample factor

BG = (11, 11, 15)  # theme.color.bg
BG_TOP = (24, 17, 44)  # a touch of violet at the top of the tile
GLOW = (124, 92, 255)  # theme.color.accent

# amber -> violet -> cyan, matching tintForCategory()'s creative/music/movement
STOPS = [(0.0, (255, 176, 61)), (0.5, (166, 107, 255)), (1.0, (74, 198, 255))]


def lerp(a, b, t):
    return tuple(round(x + (y - x) * t) for x, y in zip(a, b))


def sweep(size):
    """Diagonal (top-left -> bottom-right) three-stop gradient."""
    img = Image.new("RGB", (size, size))
    px = img.load()
    # Build one row of the ramp, then project it diagonally.
    ramp = []
    for i in range(2 * size - 1):
        t = i / (2 * size - 2)
        for j in range(len(STOPS) - 1):
            t0, c0 = STOPS[j]
            t1, c1 = STOPS[j + 1]
            if t0 <= t <= t1:
                ramp.append(lerp(c0, c1, (t - t0) / (t1 - t0)))
                break
        else:
            ramp.append(STOPS[-1][1])
    for y in range(size):
        for x in range(size):
            px[x, y] = ramp[x + y]
    return img


def bubble_mask(size):
    """Alpha mask of the mark, drawn to fill `size` x `size`."""
    m = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(m)
    u = size / 100.0  # work in percent-of-box units

    body = (6 * u, 10 * u, 94 * u, 76 * u)
    d.rounded_rectangle(body, radius=24 * u, fill=255)
    # Tail: a wedge off the bottom-left, its base tucked under the body's
    # straight bottom edge so the union has no seam.
    d.polygon(
        [(32 * u, 62 * u), (62 * u, 62 * u), (32 * u, 92 * u)],
        fill=255,
    )

    # Three rising dots punched back out.
    for i, (cx, cy) in enumerate([(29, 53), (50, 43), (71, 33)]):
        r = (7.5 + i * 0.9) * u
        d.ellipse((cx * u - r, cy * u - r, cx * u + r, cy * u + r), fill=0)
    return m


def mark(size):
    """The mark as an RGBA image of the given size."""
    s = size * SS
    layer = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    layer.paste(sweep(s), (0, 0), bubble_mask(s))
    return layer.resize((size, size), Image.LANCZOS)


def backdrop(w, h):
    """Dark tile with a violet wash at the top and a glow behind the mark."""
    img = Image.new("RGB", (w, h))
    d = ImageDraw.Draw(img)
    for y in range(h):
        d.line([(0, y), (w, y)], fill=lerp(BG_TOP, BG, min(1.0, (y / h) * 1.35)))
    glow = Image.new("L", (w, h), 0)
    g = ImageDraw.Draw(glow)
    r = int(min(w, h) * 0.42)
    g.ellipse((w // 2 - r, h // 2 - r, w // 2 + r, h // 2 + r), fill=110)
    glow = glow.filter(ImageFilter.GaussianBlur(min(w, h) * 0.13))
    img.paste(Image.new("RGB", (w, h), GLOW), (0, 0), glow)
    return img


def compose(w, h, mark_size, out, alpha=False):
    base = Image.new("RGBA", (w, h), (0, 0, 0, 0)) if alpha else backdrop(w, h).convert("RGBA")
    m = mark(mark_size)
    base.alpha_composite(m, ((w - mark_size) // 2, (h - mark_size) // 2))
    # The App Store rejects icons with an alpha channel.
    base.convert("RGBA" if alpha else "RGB").save(out)
    print("wrote", out)


def notification_icon(out, size=192):
    """Android wants a flat white silhouette; the system tints it."""
    m = bubble_mask(size * SS).resize((size, size), Image.LANCZOS)
    img = Image.new("RGBA", (size, size), (255, 255, 255, 0))
    img.putalpha(m)
    img.save(out)
    print("wrote", out)


if __name__ == "__main__":
    import os

    here = os.path.dirname(os.path.abspath(__file__))
    p = lambda n: os.path.join(here, n)

    compose(1024, 1024, 620, p("icon.png"))
    # Android masks the outer ~25%, so the foreground sits smaller.
    compose(1024, 1024, 500, p("adaptive-icon.png"), alpha=True)
    compose(2048, 2048, 720, p("splash.png"))
    notification_icon(p("notification-icon.png"))
