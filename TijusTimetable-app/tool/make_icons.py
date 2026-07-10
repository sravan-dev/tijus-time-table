"""Turn learning.png into Android launcher icon sources.

The logo ships as RGB on a solid black square, so used directly it would show
black corners behind the round badge. This finds the badge, cuts it out with an
anti-aliased circular mask, and writes two PNGs:

  assets/icon/icon.png             1024x1024, badge on white        (legacy icon)
  assets/icon/icon_foreground.png  1024x1024, badge near full-bleed on
                                   transparent               (adaptive foreground)

Run:  python tool/make_icons.py
"""
from PIL import Image, ImageDraw

SRC = 'learning.png'
OUT_ICON = 'assets/icon/icon.png'
OUT_FG = 'assets/icon/icon_foreground.png'
SIZE = 1024

# An adaptive icon is 108dp but only the centre 72dp (66.7%) is guaranteed
# visible. flutter_launcher_icons already wraps the foreground in an
# <inset android:inset="16%">, which by itself lands the artwork at 68% — so the
# foreground PNG must be near full-bleed. Scaling it down here too would compound
# the two insets and leave the badge floating in a fat margin (0.67 x 0.68 = 45%).
FG_FILL = 0.98
# The legacy icon is not masked, so the badge can nearly fill the square.
LEGACY = 0.96

DARK = 40  # sum(rgb) below this is the black backdrop, not artwork


def badge_bbox(im):
    """Bounding box of everything that isn't the black backdrop."""
    rgb = im.convert('RGB')
    w, h = rgb.size
    px = rgb.load()
    minx, miny, maxx, maxy = w, h, -1, -1
    for y in range(h):
        for x in range(w):
            r, g, b = px[x, y]
            if r + g + b > DARK:
                if x < minx: minx = x
                if x > maxx: maxx = x
                if y < miny: miny = y
                if y > maxy: maxy = y
    return minx, miny, maxx + 1, maxy + 1


def circular_cutout(im, box):
    """Crop `box` and apply an anti-aliased circular alpha mask."""
    badge = im.crop(box).convert('RGBA')
    side = max(badge.size)
    # square it up, centring the badge
    sq = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    sq.paste(badge, ((side - badge.width) // 2, (side - badge.height) // 2))

    # supersample the mask 4x so the circle edge is smooth
    ss = 4
    mask = Image.new('L', (side * ss, side * ss), 0)
    # Inset the circle a touch. The source's white rim is anti-aliased against
    # the black backdrop, so a mask at the exact edge keeps those blended pixels
    # and leaves a grey halo around the badge.
    inset = int(side * ss * 0.006)
    ImageDraw.Draw(mask).ellipse(
        (inset, inset, side * ss - 1 - inset, side * ss - 1 - inset), fill=255)
    mask = mask.resize((side, side), Image.LANCZOS)
    sq.putalpha(mask)
    return sq


def place(badge, size, scale, background):
    """Centre `badge` on a `size` canvas, scaled to `scale` of the canvas."""
    d = int(size * scale)
    b = badge.resize((d, d), Image.LANCZOS)
    canvas = Image.new('RGBA', (size, size), background)
    off = (size - d) // 2
    canvas.alpha_composite(b, (off, off))
    return canvas


def main():
    im = Image.open(SRC)
    box = badge_bbox(im)
    print(f'source {im.size} {im.mode}; badge bbox {box} '
          f'({box[2]-box[0]}x{box[3]-box[1]})')

    badge = circular_cutout(im, box)

    icon = place(badge, SIZE, LEGACY, (255, 255, 255, 255))
    icon.convert('RGB').save(OUT_ICON)
    print(f'wrote {OUT_ICON} (badge {LEGACY:.0%} on white)')

    fg = place(badge, SIZE, FG_FILL, (0, 0, 0, 0))
    fg.save(OUT_FG)
    print(f'wrote {OUT_FG} (badge {FG_FILL:.0%}, transparent; '
          f'the plugin insets it 16% -> {FG_FILL * 0.68:.0%} of the icon layer)')


if __name__ == '__main__':
    main()
