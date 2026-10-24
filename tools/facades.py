"""The facades' colours, measured on photos of the hospital, for the page's facade pictures (viewer.js FACADE).

  python3 -I tools/facades.py <forsyning.jpg> <tower.jpg>

forsyning.jpg: "Fotoskisse fasade Forsyningsblokka" (2018), the photo in it (3933 x 2517). tower.jpg: "2 Fasadefoto"
(2020), the scan (1760 x 1241, as scanned, upside down). Both are case documents (Drammen kommune, innsyn), and are
read as pictures only. Each value is the median of a patch in sun, clear of joints, windows and tree shadows.

The photos are too small and too compressed to give the concrete's grain itself (a patch is JPEG blocks), so the
page draws the grain and takes only these colours and the layout (panels, joints, windows) from the photos."""
import sys, json
import numpy as np
from PIL import Image

forsyning, tower = sys.argv[1:3]
F = Image.open(forsyning).convert("RGB"); Tw = Image.open(tower).convert("RGB").rotate(180)

def median(im, box): return "#%02x%02x%02x" % tuple(int(v) for v in np.median(np.asarray(im.crop(box)).reshape(-1, 3), 0))
print(json.dumps({
    "low_concrete": median(F, (1950, 380, 2080, 660)),     # a panel of the upper band, in low winter sun
    "low_frame": median(F, (2255, 720, 2268, 940)),        # a window post between the blinds
    "low_blind": median(F, (1500, 720, 1700, 940)),
    "tower_concrete": median(Tw, (815, 300, 865, 700)),    # a pier between two window slots
    "tower_glass": median(Tw, (910, 230, 935, 270)),
    "tower_reveal": median(Tw, (905, 290, 975, 330)),      # the shadowed concrete over a window, in the slot
}, indent=1))
