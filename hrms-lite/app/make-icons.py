"""Draws the app icons with no image library: raw PNG, written by hand.
A navy tile with a white clock face - the punch app, at a glance."""
import zlib, struct, math, os

NAVY  = (15, 23, 42)
BLUE  = (37, 99, 235)
WHITE = (255, 255, 255)

def png(path, size, padding=0.0, bg=NAVY):
    cx = cy = size / 2.0
    # the clock sits inside whatever room the padding leaves (maskable icons
    # get 20% so Android can crop them to any shape without clipping it)
    r  = (size / 2.0) * (1 - padding) * 0.62
    ring, hand = max(2.0, size * 0.045), max(2.0, size * 0.038)
    rows = []
    for y in range(size):
        row = bytearray([0])                      # filter byte: none
        for x in range(size):
            px, py = x + 0.5, y + 0.5
            d = math.hypot(px - cx, py - cy)
            c = bg
            if abs(d - r) <= ring / 2:            # the dial
                c = WHITE
            elif d < r:
                c = BLUE if d < r * 0.93 else bg
                # hour hand to 10, minute hand to 2 - a clock reading "10:10"
                for ang, ln in ((-math.pi * 0.72, 0.46), (-math.pi * 0.16, 0.66)):
                    hx, hy = cx + math.cos(ang) * r * ln, cy + math.sin(ang) * r * ln
                    vx, vy = hx - cx, hy - cy
                    t = max(0.0, min(1.0, ((px - cx) * vx + (py - cy) * vy) / (vx * vx + vy * vy)))
                    if math.hypot(px - cx - vx * t, py - cy - vy * t) <= hand / 2:
                        c = WHITE
                if d <= hand * 0.9:
                    c = WHITE
            row += bytes(c)
        rows.append(bytes(row))
    raw = b''.join(rows)

    def chunk(tag, data):
        return (struct.pack('>I', len(data)) + tag + data +
                struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff))

    with open(path, 'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n')
        f.write(chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0)))
        f.write(chunk(b'IDAT', zlib.compress(raw, 9)))
        f.write(chunk(b'IEND', b''))
    return os.path.getsize(path)

os.makedirs('icons', exist_ok=True)
for name, size, pad in [('icon-192.png', 192, 0.0), ('icon-512.png', 512, 0.0),
                        ('icon-maskable-512.png', 512, 0.20), ('icon-1024.png', 1024, 0.0)]:
    print(f'  {name:26} {png("icons/" + name, size, pad):>7} bytes')
