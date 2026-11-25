# Generates the OpenBar app icon (no dependencies): a rounded gradient tile with a dock bar.
import struct, zlib, sys

def rounded(x, y, x0, y0, x1, y1, r):
    cx = min(max(x, x0 + r), x1 - r)
    cy = min(max(y, y0 + r), y1 - r)
    d = ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5
    return max(0.0, min(1.0, r - d + 0.5))

def blend(dst, src, a):
    return tuple(int(d * (1 - a) + s * a) for d, s in zip(dst, src))

def render(N):
    s = N / 256.0
    rows = []
    for y in range(N):
        row = bytearray([0])
        for x in range(N):
            a = rounded(x + .5, y + .5, 8 * s, 8 * s, 248 * s, 248 * s, 56 * s)
            t = (x + y) / (2.0 * N)
            c = (int(99 + (168 - 99) * t), int(102 + (85 - 102) * t), int(241 + (247 - 241) * t))
            b = rounded(x + .5, y + .5, 40 * s, 150 * s, 216 * s, 200 * s, 25 * s)
            c = blend(c, (255, 255, 255), b * 0.92)
            for cxp, col in ((78, (99, 102, 241)), (128, (236, 72, 153)), (178, (34, 197, 94))):
                d = rounded(x + .5, y + .5, (cxp - 13) * s, 162 * s, (cxp + 13) * s, 188 * s, 8 * s)
                c = blend(c, col, d)
            top = rounded(x + .5, y + .5, 64 * s, 64 * s, 192 * s, 116 * s, 16 * s)
            c = blend(c, (255, 255, 255), top * 0.28)
            row += bytes((c[0], c[1], c[2], int(255 * a)))
        rows.append(bytes(row))
    raw = b''.join(rows)
    def chunk(t, d):
        return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', N, N, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b'')

open(sys.argv[1], 'wb').write(render(int(sys.argv[2]) if len(sys.argv) > 2 else 256))
