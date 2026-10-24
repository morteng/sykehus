"""Kartverket's laser grids as numpy: an uncompressed float32 GeoTIFF (strips or tiles), as hoydedata.no exports the
DOM and DTM. The file is data: only the tags needed for the size and the layout are read."""
import sys, struct
import numpy as np

def tiff(path):
    b = open(path, "rb").read(); e = "<" if b[:2] == b"II" else ">"
    ifd = struct.unpack(e + "I", b[4:8])[0]; n = struct.unpack(e + "H", b[ifd:ifd + 2])[0]; tags = {}
    for i in range(n):
        o = ifd + 2 + i * 12; tag, typ, cnt = struct.unpack(e + "HHI", b[o:o + 8]); sz = {3: 2, 4: 4}.get(typ, 1)
        at = struct.unpack(e + "I", b[o + 8:o + 12])[0] if cnt * sz > 4 else o + 8
        if typ in (3, 4): tags[tag] = [struct.unpack(e + ("H" if typ == 3 else "I"), b[at + k * sz:at + k * sz + sz])[0] for k in range(cnt)]
    w, h = tags[256][0], tags[257][0]
    if tags.get(259, [1])[0] != 1: sys.exit("compressed TIFF")
    if 273 in tags: return np.frombuffer(b"".join(b[o:o + c] for o, c in zip(tags[273], tags[279]))[:w * h * 4], dtype=e + "f4").reshape(h, w)
    tw, th = tags[322][0], tags[323][0]; across = (w + tw - 1) // tw; out = np.zeros((h, w), np.float32)
    for i, o in enumerate(tags[324]):
        tx, ty = (i % across) * tw, (i // across) * th; t = np.frombuffer(b[o:o + tw * th * 4], dtype=e + "f4").reshape(th, tw)
        out[ty:ty + th, tx:tx + tw] = t[:min(th, h - ty), :min(tw, w - tx)]
    return out

def inside(px, py, ring):
    """even-odd test of the points (arrays) against a ring"""
    r = np.array(ring); o = np.zeros(px.shape, bool); j = len(r) - 1
    for i in range(len(r)):
        (a, b), (e, f) = r[i], r[j]
        if b != f: o ^= ((b > py) != (f > py)) & (px < (e - a) * (py - b) / (f - b) + a)
        j = i
    return o
