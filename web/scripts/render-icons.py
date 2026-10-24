"""Render web/public/icon.svg to the PNG sizes the manifest asks for.

Why this exists
---------------
`icon.svg` is the drawing and the source of truth; the manifest lists it
first. But Android's launcher does not reliably take an SVG, which is exactly
the case that matters here — the app is installed to the home screen, because
that is what puts it in the share sheet. So the two PNGs beside it are not a
fallback for old browsers, they are what the owner's own phone actually shows,
and an icon.svg redrawn without them is a favicon that changed in the tab and
nowhere else. That happened once.

Why it redraws rather than rasterises
-------------------------------------
There is no SVG rasteriser on this machine and none in the dependency tree,
and adding one (sharp, resvg, a headless browser) to render a mark of eleven
shapes is a large dependency for a file that changes about once a year. The
geometry below is a transcription of icon.svg, in the same 100-unit space and
the same order. If you change one, change the other; the drawing is small
enough that this is cheaper than the toolchain that would keep them in step.

Every colour is a stop on the app's ramp (DESIGN.md §3), never a hue.

Run:  python web/scripts/render-icons.py
"""

from PIL import Image, ImageDraw

PAPER = "#0c0a08"   # the ground
MUTED = "#948b7d"   # the shell and the legs
RAISED = "#29221a"  # the screen
INK = "#ded5c6"     # the face

# Drawn this many times larger, then reduced — the reduction is the
# antialiasing, and it is why round caps drawn as plain circles come out
# clean rather than notched.
SUPER = 2048
S = SUPER / 100.0


def px(v: float) -> float:
    return v * S


def round_line(d: ImageDraw.ImageDraw, x1, y1, x2, y2, width, fill):
    """A line with round caps, which Pillow has no flag for."""
    d.line([(px(x1), px(y1)), (px(x2), px(y2))], fill=fill, width=int(px(width)))
    r = px(width) / 2
    for x, y in ((x1, y1), (x2, y2)):
        d.ellipse([px(x) - r, px(y) - r, px(x) + r, px(y) + r], fill=fill)


def dot(d: ImageDraw.ImageDraw, cx, cy, r, fill):
    d.ellipse([px(cx) - px(r), px(cy) - px(r), px(cx) + px(r), px(cy) + px(r)], fill=fill)


def draw() -> Image.Image:
    img = Image.new("RGB", (SUPER, SUPER), PAPER)
    d = ImageDraw.Draw(img)

    # The shell and the legs: stroke 5.5, round join and cap.
    round_line(d, 35, 75, 35, 85, 5.5, MUTED)          # left leg
    round_line(d, 65, 75, 65, 85, 5.5, MUTED)          # right leg
    d.rounded_rectangle(                                # the body
        [px(20), px(30), px(80), px(75)],
        radius=px(9),
        outline=MUTED,
        width=int(px(5.5)),
    )
    round_line(d, 50, 30, 50, 18, 5.5, MUTED)          # the aerial
    dot(d, 50, 14, 3.2, MUTED)                          # its tip

    # The screen, and the face on it.
    d.rounded_rectangle([px(28), px(38), px(72), px(67)], radius=px(5), fill=RAISED)
    dot(d, 39, 50, 3.4, INK)                            # left eye
    dot(d, 61, 50, 3.4, INK)                            # right eye
    round_line(d, 47, 58, 53, 58, 5, INK)               # the mouth

    return img


def main() -> None:
    master = draw()
    for size in (192, 512):
        out = f"web/public/icon-{size}.png"
        master.resize((size, size), Image.LANCZOS).save(out, optimize=True)
        print(f"wrote {out}")


if __name__ == "__main__":
    main()
