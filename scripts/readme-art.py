"""Draws the README's SVG art in the same label style as the app.

Text is converted to outlines using the app's own fonts, so the images look
identical everywhere. GitHub does not load custom fonts inside an <img> SVG.

    bun install   # the fonts come from node_modules
    uv run --with fonttools --with brotli --with uharfbuzz scripts/readme-art.py

Writes docs/assets/*.svg. The colours and fonts mirror src/web/styles.css.
"""

import io
from pathlib import Path

import uharfbuzz as hb
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "docs" / "assets"
FONTS = ROOT / "node_modules" / "@fontsource-variable"

# The theme (src/web/styles.css @theme).
LINER, STOCK, INK = "#e3e3db", "#fbfbf7", "#0d0d0d"
INK_SOFT, BLANK = "#55554f", "#b4b4ab"
SIGNAL, SIGNAL_INK = "#ff4f00", "#b83800"


class Face:
    """A variable font instance that can turn text into SVG path data."""

    def __init__(self, woff2: Path, variations: dict):
        font = TTFont(woff2)
        font.flavor = None
        data = io.BytesIO()
        font.save(data)
        self.upem = font["head"].unitsPerEm
        self.font = hb.Font(hb.Face(data.getvalue()))
        self.font.set_variations(variations)

    def _shape(self, text: str):
        buf = hb.Buffer()
        buf.add_str(text)
        buf.guess_segment_properties()
        hb.shape(self.font, buf, {"kern": True, "liga": False})
        return buf.glyph_infos, buf.glyph_positions

    def width(self, text: str, size: float, tracking: float = 0.0) -> float:
        _, positions = self._shape(text)
        scale = size / self.upem
        return sum(p.x_advance * scale + tracking * size for p in positions) - tracking * size

    def path(self, text: str, size: float, x: float, y: float, tracking: float = 0.0, anchor: str = "start") -> str:
        """Outlines for `text`, baseline at y. anchor is start, middle or end."""
        width = self.width(text, size, tracking)
        x -= {"start": 0, "middle": width / 2, "end": width}[anchor]
        infos, positions = self._shape(text)
        scale = size / self.upem
        pen_x = x
        parts = []
        fmt = lambda v: f"{v:.1f}".rstrip("0").rstrip(".")
        for info, pos in zip(infos, positions):
            svg = SVGPathPen(None, ntos=fmt)
            self.font.draw_glyph_with_pen(info.codepoint, TransformPen(svg, (scale, 0, 0, -scale, pen_x + pos.x_offset * scale, y)))
            parts.append(svg.getCommands())
            pen_x += pos.x_advance * scale + tracking * size
        return "".join(parts)


CODE = Face(FONTS / "archivo" / "files" / "archivo-latin-standard-normal.woff2", {"wght": 900, "wdth": 62})
BOLD = Face(FONTS / "archivo" / "files" / "archivo-latin-standard-normal.woff2", {"wght": 700, "wdth": 100})
TEXT = Face(FONTS / "archivo" / "files" / "archivo-latin-standard-normal.woff2", {"wght": 400, "wdth": 100})
MONO = Face(FONTS / "azeret-mono" / "files" / "azeret-mono-latin-wght-normal.woff2", {"wght": 500})


class Svg:
    def __init__(self, width: int, height: int, title: str, description: str):
        self.width, self.height = width, height
        self.title, self.description = title, description
        self.body: list[str] = []
        self.defs: list[str] = []
        self.clips = 0

    def raw(self, markup: str):
        self.body.append(markup)

    def rect(self, x, y, w, h, fill, rx=0):
        self.raw(f'<rect x="{x:g}" y="{y:g}" width="{w:g}" height="{h:g}" rx="{rx:g}" fill="{fill}"/>')

    def text(self, face: Face, text: str, size, x, y, fill, tracking=0.0, anchor="start"):
        self.raw(f'<path fill="{fill}" d="{face.path(text, size, x, y, tracking, anchor)}"/>')

    def legend(self, text: str, x, y, fill=INK, size=13, anchor="start"):
        """The small caption printed in a box's corner."""
        self.text(BOLD, text.upper(), size, x, y, fill, tracking=0.06, anchor=anchor)

    def label(self, x, y, w, h, grid, ink=INK, stock=STOCK, rx=10):
        """A label: boxes on an ink ground, so the 2px gaps read as printed rules.

        grid is a list of rows; each row is (height, [(width, fill), ...]) with
        widths in order. Returns the box rectangles as (x, y, w, h) per row.
        """
        self.clips += 1
        clip = f"clip{self.clips}"
        self.defs.append(f'<clipPath id="{clip}"><rect x="{x + 2:g}" y="{y + 2:g}" width="{w - 4:g}" height="{h - 4:g}" rx="{rx - 2:g}"/></clipPath>')
        self.rect(x, y, w, h, ink, rx)
        boxes = []
        self.raw(f'<g clip-path="url(#{clip})">')
        cy = y + 2
        for row_h, cells in grid:
            cx = x + 2
            row = []
            for cell_w, fill in cells:
                self.rect(cx, cy, cell_w, row_h, fill or stock)
                row.append((cx, cy, cell_w, row_h))
                cx += cell_w + 2
            boxes.append(row)
            cy += row_h + 2
        self.raw("</g>")
        return boxes

    def arrow(self, x1, y, x2, color=INK, width=6, head=16):
        """A square-capped arrow, like the icons in the app."""
        self.raw(
            f'<path d="M{x1:g} {y:g}H{x2:g}M{x2 - head:g} {y - head:g}L{x2:g} {y:g}L{x2 - head:g} {y + head:g}" '
            f'fill="none" stroke="{color}" stroke-width="{width:g}" stroke-linecap="square" stroke-linejoin="miter"/>'
        )

    def write(self, name: str):
        OUT.mkdir(parents=True, exist_ok=True)
        svg = (
            f'<svg xmlns="http://www.w3.org/2000/svg" width="{self.width}" height="{self.height}" viewBox="0 0 {self.width} {self.height}" role="img" aria-labelledby="t d">'
            f'<title id="t">{self.title}</title><desc id="d">{self.description}</desc>'
            f'<defs>{"".join(self.defs)}</defs>'
            f'<rect width="{self.width}" height="{self.height}" rx="18" fill="{LINER}"/>'
            + "".join(self.body)
            + "</svg>\n"
        )
        (OUT / name).write_text(svg, encoding="utf-8")
        print(f"{name}: {len(svg) / 1024:.1f} KB")


def fit(face: Face, text: str, size: float, max_width: float, tracking=0.0) -> float:
    """The largest size, no bigger than `size`, at which the text fits."""
    while size > 8 and face.width(text, size, tracking) > max_width:
        size -= 0.5
    return size


# --- banner ---------------------------------------------------------------


def banner():
    s = Svg(1200, 372, "tools", "A label reading TOOLS, the command to type, and an orange OPEN block.")
    m, w = 28, 1144

    top = s.label(m, m, w, 148, [(144, [(w - 4 - 2 - 392, None), (392, None)])])[0]
    x, y, bw, bh = top[0]
    s.text(CODE, "TOOLS", 132, x + 22, y + 124, INK, tracking=-0.01)
    s.legend("Your toolbox", x + bw - 26, y + 40, anchor="end")
    s.text(TEXT, "Make GIFs. Cut out backgrounds.", 21, x + bw - 26, y + 92, INK, anchor="end")
    s.text(TEXT, "Convert images. All on your machine.", 21, x + bw - 26, y + 122, INK_SOFT, anchor="end")
    x, y, bw, bh = top[1]
    s.legend("Running on this machine", x + 24, y + 40)
    s.text(MONO, "127.0.0.1:4777", 32, x + 24, y + 96, INK)
    s.text(TEXT, "Stops by itself when idle", 17, x + 24, y + 126, INK_SOFT)

    low = s.label(m, 196, w, 148, [(144, [(500, None), (416, INK), (w - 4 - 4 - 500 - 416, SIGNAL)])])[0]
    x, y, bw, bh = low[0]
    s.legend("Type this in any terminal", x + 24, y + 40)
    s.text(MONO, "> tools", 58, x + 24, y + 98, INK)
    s.text(TEXT, "Opens the toolbox in your browser", 19, x + 24, y + 128, INK_SOFT)
    x, y, bw, bh = low[1]
    s.text(CODE, "NOTHING LEAVES", 54, x + 28, y + 62, STOCK, tracking=-0.01)
    s.text(CODE, "YOUR COMPUTER", 54, x + 28, y + 118, STOCK, tracking=-0.01)
    x, y, bw, bh = low[2]
    s.text(CODE, "OPEN", 58, x + 24, y + 94, INK)
    s.arrow(x + bw - 52, y + 70, x + bw - 24, INK, width=5, head=11)
    s.write("banner.svg")


# --- the sheet of tools -----------------------------------------------------

LIVE = [
    ("MP4", "GIF", "Video to GIF", "Trim a clip, pick a size, get a GIF.", "mp4 mov webm mkv m4v avi"),
    ("IMG", "PNG", "Remove background", "Cut the subject out as a transparent PNG.", "png jpg jpeg webp avif tif tiff"),
    ("ANY", "ANY", "Image converter", "Photos and SVGs to PNG, JPEG, WebP or AVIF.", "png jpg webp avif tif svg"),
]
PLANNED = [
    ("PDF", "PNG", "PDF to images", "Every page as a PNG or JPEG."),
    ("JPG", "PDF", "Images to PDF", "Stack pictures into one document."),
    ("ANY", "ZIP", "File compressor", "Make big files smaller."),
]


def sheet():
    s = Svg(1200, 592, "The tools", "Three live tools drawn as labels, Video to GIF, Remove background and Image converter, above three planned ones.")
    m, gap = 28, 20
    lw = (1200 - 2 * m - 2 * gap) // 3
    half = (lw - 4 - 2) // 2

    for i, (src, dst, name, tagline, accepts) in enumerate(LIVE):
        x = m + i * (lw + gap)
        rows = s.label(x, m, lw, 352, [(150, [(half, None), (half, INK)]), (100, [(lw - 4, None)]), (94, [(half, None), (half, SIGNAL)])])
        code_size = min(fit(CODE, src, 104, half - 34, -0.01), fit(CODE, dst, 104, half - 34, -0.01))
        bx, by, _, _ = rows[0][0]
        s.legend("From", bx + 18, by + 30)
        s.text(CODE, src, code_size, bx + 18, by + 128, INK, tracking=-0.01)
        bx, by, _, _ = rows[0][1]
        s.legend("To", bx + 18, by + 30, STOCK)
        s.text(CODE, dst, code_size, bx + 18, by + 128, STOCK, tracking=-0.01)
        bx, by, bw, _ = rows[1][0]
        s.text(CODE, name.upper(), fit(CODE, name.upper(), 40, bw - 36, -0.01), bx + 18, by + 46, INK, tracking=-0.01)
        s.text(TEXT, tagline, fit(TEXT, tagline, 16, bw - 36), bx + 18, by + 76, INK)
        bx, by, bw, _ = rows[2][0]
        s.legend("Accepts", bx + 18, by + 30)
        s.text(MONO, accepts, fit(MONO, accepts, 11.5, bw - 46), bx + 18, by + 58, INK)
        bx, by, bw, bh = rows[2][1]
        s.text(CODE, "OPEN", 44, bx + 16, by + 62, INK)
        s.arrow(bx + bw - 54, by + bh / 2, bx + bw - 22, INK, width=5, head=10)

    y = m + 352 + 24
    for i, (src, dst, name, tagline) in enumerate(PLANNED):
        x = m + i * (lw + gap)
        rows = s.label(x, y, lw, 148, [(64, [(lw - 4, None)]), (78, [(lw - 4, None)])], ink=BLANK)
        bx, by, bw, bh = rows[0][0]
        s.text(CODE, src, 42, bx + 18, by + 48, INK_SOFT, tracking=-0.01)
        arrow_x = bx + 18 + CODE.width(src, 42, -0.01) + 14
        s.arrow(arrow_x, by + 33, arrow_x + 22, INK_SOFT, width=4, head=8)
        s.text(CODE, dst, 42, arrow_x + 22 + 14, by + 48, INK_SOFT, tracking=-0.01)
        # The stamp on tools that are not built yet, up in the codes row.
        sx, sy = bx + bw - 138, by + 14
        bx, by, bw, bh = rows[1][0]
        s.text(BOLD, name, 19, bx + 18, by + 30, INK)
        s.text(TEXT, tagline, 15, bx + 18, by + 56, INK_SOFT)
        s.raw(f'<g transform="rotate(-4 {sx + 60:g} {sy + 18:g})">')
        s.raw(f'<rect x="{sx:g}" y="{sy:g}" width="120" height="36" rx="3" fill="none" stroke="{SIGNAL_INK}" stroke-width="2.5"/>')
        s.text(BOLD, "PLANNED", 16, sx + 60, sy + 24.5, SIGNAL_INK, tracking=0.08, anchor="middle")
        s.raw("</g>")
    s.write("tools.svg")


# --- how it works -----------------------------------------------------------


def flow():
    s = Svg(1200, 330, "How it works", "You type tools, a local server starts, your browser opens, and you save the result with a native Save dialog.")
    m, gap, w, h, y = 28, 44, 252, 232, 28
    steps = [
        ("You type", "TOOLS", "In any terminal. It starts the server and opens your browser.", INK, None),
        ("Local server", "127.0.0.1", "Starts once, and stops itself five minutes after the last tab closes.", INK, None),
        ("Your browser", "DROP", "Drop a file, adjust it, and see the real result before you keep it.", INK, None),
        ("Save as", "SAVE", "A real Save dialog. You choose where the file goes.", INK, SIGNAL),
    ]
    for i, (legend, code, note, _, fill) in enumerate(steps):
        x = m + i * (w + gap)
        rows = s.label(x, y, w, h, [(120, [(w - 4, fill)]), (106, [(w - 4, None)])])
        bx, by, bw, bh = rows[0][0]
        s.legend(legend, bx + 20, by + 34)
        size = fit(CODE, code, 76, bw - 40, -0.01)
        s.text(CODE, code, size, bx + 20, by + 104, INK, tracking=-0.01)
        bx, by, bw, bh = rows[1][0]
        words, line, lines = note.split(), "", []
        for word in words:
            trial = f"{line} {word}".strip()
            if TEXT.width(trial, 16.5) > bw - 40 and line:
                lines.append(line)
                line = word
            else:
                line = trial
        lines.append(line)
        for n, text in enumerate(lines):
            s.text(TEXT, text, 16.5, bx + 20, by + 34 + n * 23, INK)
        if i < len(steps) - 1:
            s.arrow(x + w + 8, y + h / 2, x + w + gap - 8, SIGNAL, width=6, head=12)
    s.text(MONO, "No uploads. No accounts. Your files stay on this machine.", 17, 600, 308, INK_SOFT, anchor="middle")
    s.write("how-it-works.svg")


if __name__ == "__main__":
    banner()
    sheet()
    flow()
