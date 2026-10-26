"""Build Pilot PNG/ICO assets matching resources/pilot-icon.svg (requires Pillow)."""
from math import cos, sin, pi
from pathlib import Path
from xml.etree import ElementTree
from PIL import Image, ImageDraw

resources = Path(__file__).resolve().parents[1] / 'harness' / 'desktop' / 'resources'
svg = ElementTree.parse(resources / 'pilot-icon.svg').getroot()
paths = [node.attrib['d'] for node in svg.iter() if node.tag.endswith('}path')]
if paths != ['M10 22V10h7a4 4 0 0 1 0 8h-3', 'm18 22 4-4']:
    raise SystemExit('Pilot SVG geometry changed; update the raster conversion first')
size = 1024
scale = size * 4 / 32
image = Image.new('RGBA', (size * 4, size * 4))
draw = ImageDraw.Draw(image)
draw.rounded_rectangle((scale, scale, 31 * scale, 31 * scale), radius=9 * scale, fill='#202020')
width = round(2.3 * scale)
radius = width / 2

def stroke(points):
    pixels = [(round(x * scale), round(y * scale)) for x, y in points]
    draw.line(pixels, fill='white', width=width, joint='curve')
    for x, y in pixels:
        draw.ellipse((x-radius, y-radius, x+radius, y+radius), fill='white')

arc = [(17 + 4 * cos(-pi / 2 + pi * i / 128), 14 + 4 * sin(-pi / 2 + pi * i / 128)) for i in range(129)]
stroke([(10, 22), (10, 10), (17, 10), *arc, (14, 18)])
stroke([(18, 22), (22, 18)])
image = image.resize((size, size), Image.Resampling.LANCZOS)
image.save(resources / 'pilot-icon.png', optimize=True)
image.save(resources / 'pilot-icon.ico', sizes=[(n, n) for n in (16, 20, 24, 32, 48, 64, 128, 256)])
print('Built Pilot 1024px PNG and ICO (16/20/24/32/48/64/128/256px)')
