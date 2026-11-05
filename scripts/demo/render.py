"""Render the exported project sprites into a small, looping feature demo.

node --import tsx scripts/demo/export.ts /private/tmp/pi-buddy-demo.json ru
node --import tsx scripts/demo/export.ts /private/tmp/pi-buddy-demo.en.json en
python3 scripts/demo/render.py /private/tmp/pi-buddy-demo.json media/demo.gif
Requires Pillow. The presentation is a staged demo, not a terminal recording.
"""
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

DATA = json.loads(Path(sys.argv[1]).read_text())
OUT = Path(sys.argv[2])
EN = DATA.get('locale') == 'en'
W, H = 1100, 680
C = {
    'bg': '#0c1118', 'panel': '#131b25', 'dock': '#1c2735',
    'border': '#2b3a4c', 'white': '#e8eef6', 'muted': '#99aabd',
    'cyan': '#77d9d0', 'green': '#98dfa6', 'red': '#f7999e',
    'amber': '#f5cd7c',
}
FONT_DIR = Path('/System/Library/Fonts/Supplemental')

def font(size, bold=False, mono=False):
    name = 'Andale Mono.ttf' if mono else ('Arial Bold.ttf' if bold else 'Arial.ttf')
    return ImageFont.truetype(str(FONT_DIR / name), size)

F = { 'title': font(31, True), 'sub': font(20), 'small': font(15),
      'label': font(16, True), 'mono': font(19, mono=True),
      'bubble': font(22), 'pet': font(20, True), 'brand': font(22, True) }

def text(d, xy, value, style='sub', color='white'):
    d.text(xy, value, font=F[style], fill=C.get(color, color))

def sprite(im, grid, x, y, scale):
    d = ImageDraw.Draw(im)
    for row_i, row in enumerate(grid):
        for col_i, ch in enumerate(row):
            color = DATA['palette'].get(ch)
            if color:
                d.rectangle((x + col_i * scale, y + row_i * scale,
                             x + (col_i + 1) * scale - 1, y + (row_i + 1) * scale - 1), fill=tuple(color))

def wrapped(d, value, max_width, style='bubble'):
    result, line = [], ''
    for word in value.split():
        candidate = (line + ' ' + word).strip()
        if d.textlength(candidate, font=F[style]) > max_width and line:
            result.append(line)
            line = word
        else:
            line = candidate
    return result + ([line] if line else [])

def bubble(im, value, x, y, width):
    d = ImageDraw.Draw(im)
    lines = wrapped(d, value, width - 32)
    height = max(66, 24 + len(lines) * 27)
    d.rounded_rectangle((x, y, x + width, y + height), radius=12, fill='#253746', outline='#385363')
    d.polygon([(x + 48, y + height - 1), (x + 61, y + height + 12), (x + 73, y + height - 1)], fill='#253746')
    for i, line in enumerate(lines):
        text(d, (x + 16, y + 12 + 27 * i), line, 'bubble', 'white')

def render(f, frame_no, total):
    im = Image.new('RGB', (W, H), C['bg'])
    d = ImageDraw.Draw(im)
    text(d, (36, 25), 'pi-buddy', 'brand', 'cyan')
    text(d, (W - 287, 29), '@euhenio/pi-buddy', 'mono', 'muted')
    text(d, (36, 70), f['title'], 'title')
    text(d, (37, 111), f['subtitle'], 'sub', 'muted')
    labels = ['Agent work', 'Subagents', 'Reactions', 'Speech', 'Playtime', 'Pets'] if EN else ['Работа агента', 'Субагенты', 'Реакции', 'Реплики', 'Игры', 'Питомцы']
    x = 36
    for i, label in enumerate(labels):
        width = int(d.textlength(label, font=F['label'])) + 28
        active = i == f['tab']
        d.rounded_rectangle((x, 150, x + width, 181), radius=8,
                            fill='#25433f' if active else C['panel'])
        text(d, (x + 14, 157), label, 'label', 'cyan' if active else 'muted')
        x += width + 9

    d.rounded_rectangle((28, 201, W - 28, 621), radius=14, fill=C['panel'], outline=C['border'])
    d.line((29, 239, W - 29, 239), fill=C['border'])
    for x, color in [(48, '#ef8186'), (69, '#e8c56e'), (90, '#87ca98')]:
        d.ellipse((x, 215, x + 10, 225), fill=color)
    text(d, (122, 212), 'pi  /  demo-project', 'small', 'muted')
    text(d, (897, 212), 'staged demo' if EN else 'демо сценариев', 'small', 'muted')

    if f['sceneIndex'] == 6:
        text(d, (54, 258), '/buddy choose', 'mono', 'cyan')
        for i, pet in enumerate(f['gallery']):
            col, row = i % 3, i // 3
            x, y = 49 + col * 337, 298 + row * 101
            d.rounded_rectangle((x, y, x + 324, y + 91), radius=10, fill=C['dock'])
            sprite(im, pet['grid'], x + 9, y + 12, 4)
            text(d, (x + 117, y + 32), pet['label'].replace('Щенок немецкой овчарки', 'Овчарка'), 'pet')
    else:
        d.rounded_rectangle((754, 255, 1052, 606), radius=10, fill=C['dock'])
        text(d, (54, 264), '›', 'mono', 'cyan')
        for i, line in enumerate(wrapped(d, f['command'], 640, 'mono')):
            text(d, (80, 265 + 26 * i), line, 'mono')
        for i, (color, line) in enumerate(f['lines']):
            text(d, (55, 346 + i * 35), line, 'mono', color)
        d.line((54, 553, 725, 553), fill=C['border'])
        text(d, (55, 568), '›', 'mono', 'cyan')
        if frame_no % 2 == 0:
            d.rectangle((80, 569, 89, 590), fill=C['muted'])
        bubble(im, f['bubble'], 771, 273, 263)
        if f['pups']:
            for i, pup in enumerate(f['pups']):
                x = 775 + 86 * i
                sprite(im, pup['grid'], x + 10, 364, 5)
                label = pup['name'] + (' +' if pup['status'] == 'done' else ' ...')
                text(d, (x, 400), label, 'small', 'green' if pup['status'] == 'done' else 'muted')
        sprite(im, f['grid'], 795 if f['pups'] else 783, 425 if f['pups'] else 410, 9 if f['pups'] else 10)
        name = ('Slipper · shepherd' if f['pet'] == 'veo_px' else 'Quack · duck') if EN else ('Тапок · ВЕО' if f['pet'] == 'veo_px' else 'Кряк · уточка')
        text(d, (781, 583), name, 'pet')
        text(d, (55, 311), f['caption'], 'label', 'amber')

    text(d, (36, 643), 'pi install npm:@euhenio/pi-buddy', 'mono', 'cyan')
    text(d, (787, 645), 'Your pet beside the input' if EN else 'Питомец рядом с полем ввода', 'small', 'muted')
    d.rectangle((0, H - 3, W, H), fill=C['border'])
    d.rectangle((0, H - 3, int(W * (frame_no + 1) / total), H), fill=C['cyan'])
    return im

frames = [render(f, i, len(DATA['frames'])) for i, f in enumerate(DATA['frames'])]
# Use one shared palette to keep the terminal and pixel colors stable across the loop.
sample = Image.new('RGB', (275 * 10, 170 * ((len(frames) + 9) // 10)))
for i, frame in enumerate(frames):
    sample.paste(frame.resize((275, 170)), ((i % 10) * 275, (i // 10) * 170))
adaptive = sample.quantize(colors=128, method=Image.Quantize.MEDIANCUT).getpalette()[:384]
reserved = [tuple(Image.new('RGB', (1, 1), color).getpixel((0, 0))) for color in C.values()]
reserved += [tuple(color) for color in DATA['palette'].values()]
colors = list(dict.fromkeys(reserved))
raw = [v for color in colors for v in color] + adaptive
raw = (raw + [0] * 768)[:768]
palette = Image.new('P', (1, 1))
palette.putpalette(raw)
indexed = [frame.quantize(palette=palette, dither=Image.Dither.NONE) for frame in frames]
OUT.parent.mkdir(parents=True, exist_ok=True)
indexed[0].save(OUT, save_all=True, append_images=indexed[1:], duration=500, loop=0, optimize=True, disposal=1)

chosen = [0, 12, 24, 31, 38, 46, 56]
sheet = Image.new('RGB', (1100, 340 * 4), '#0c1118')
for i, n in enumerate(chosen):
    sheet.paste(frames[n].resize((550, 340)), ((i % 2) * 550, (i // 2) * 340))
sheet.save('/private/tmp/pi-buddy-demo-contact.png')
frames[12].save('/private/tmp/pi-buddy-demo-frame.png')
with Image.open(OUT) as gif:
    print(f'{OUT.resolve()}: {gif.size[0]}×{gif.size[1]}, {gif.n_frames} frames, {OUT.stat().st_size / 1024:.0f} KB')
