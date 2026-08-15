"""Generate resources/icon.png (256px) and resources/tray.png (32px) — a hexagon mark in the brand palette.
Pure stdlib (zlib/struct) so it runs anywhere; re-run after tweaking colours."""
import math, struct, zlib, os

def png(width, height, pixels):
    raw = b''.join(b'\x00' + bytes(pixels[y]) for y in range(height))
    def chunk(tag, data):
        c = struct.pack('>I', len(data)) + tag + data
        return c + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b'')

def hexagon(cx, cy, r):
    return [(cx + r * math.cos(math.radians(60 * i - 90)), cy + r * math.sin(math.radians(60 * i - 90))) for i in range(6)]

def inside(poly, x, y):
    n = len(poly); j = n - 1; c = False
    for i in range(n):
        xi, yi = poly[i]; xj, yj = poly[j]
        if ((yi > y) != (yj > y)) and (x < (xj - xi) * (y - yi) / (yj - yi + 1e-12) + xi):
            c = not c
        j = i
    return c

def dist_seg(px, py, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    t = max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))

def render(size, bg=True):
    ss = 3  # supersample
    W = size * ss
    cx = cy = W / 2
    r = W * 0.36
    poly = hexagon(cx, cy, r)
    edge = W * 0.045
    spoke = W * 0.035
    spokes = [((cx, cy - r * 0.62), (cx, cy + r * 0.62)), ((cx - r * 0.55, cy - r * 0.32), (cx + r * 0.55, cy + r * 0.32)), ((cx - r * 0.55, cy + r * 0.32), (cx + r * 0.55, cy - r * 0.32))]
    BG = (0x15, 0x15, 0x16, 255)
    FILL = (0x28, 0x3c, 0x97, 255)
    STROKE = (0x40, 0x76, 0xff, 255)
    SPOKE = (0x7b, 0xa0, 0xff, 255)
    big = []
    for y in range(W):
        row = []
        for x in range(W):
            px = (x + 0.5, y + 0.5)
            col = BG if bg else (0, 0, 0, 0)
            # rounded square background
            if bg:
                rr = W * 0.22
                inx = min(x, W - 1 - x); iny = min(y, W - 1 - y)
                if inx < rr and iny < rr and math.hypot(rr - inx, rr - iny) > rr:
                    col = (0, 0, 0, 0)
            if inside(poly, *px):
                col = FILL
            # stroke
            for i in range(6):
                a = poly[i]; b = poly[(i + 1) % 6]
                if dist_seg(px[0], px[1], a[0], a[1], b[0], b[1]) < edge / 2:
                    col = STROKE
            for (a, b) in spokes:
                if dist_seg(px[0], px[1], a[0], a[1], b[0], b[1]) < spoke / 2:
                    col = SPOKE
            row.append(col)
        big.append(row)
    # downsample
    out = []
    for y in range(size):
        row = []
        for x in range(size):
            acc = [0, 0, 0, 0]
            for dy in range(ss):
                for dx in range(ss):
                    p = big[y * ss + dy][x * ss + dx]
                    for k in range(4): acc[k] += p[k]
            n = ss * ss
            a = acc[3] / n
            if a == 0:
                row.extend((0, 0, 0, 0)); continue
            row.extend((int(acc[0] / n), int(acc[1] / n), int(acc[2] / n), int(a)))
        out.append(row)
    return png(size, size, out)

root = os.path.join(os.path.dirname(__file__), '..', 'resources')
os.makedirs(root, exist_ok=True)
open(os.path.join(root, 'icon.png'), 'wb').write(render(256))
open(os.path.join(root, 'tray.png'), 'wb').write(render(32, bg=False))
open(os.path.join(root, 'tray@2x.png'), 'wb').write(render(64, bg=False))
print('icons written to', os.path.abspath(root))
