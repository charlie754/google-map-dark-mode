"""MP4 -> GIF at 30fps. No ffmpeg on this machine; cv2 decodes, PIL writes.

    python tools/mp4-to-gif.py <src.mp4> <dst.gif> <width-px>

Frames are decimated to 30fps by keeping every Nth source frame, so the output
is a true 30fps sample rather than a re-timed one.

The two choices that decide the file size, measured on the 16s 1080p60 demo
recording that produced docs/media/demo.gif:

    per-frame ADAPTIVE palette      100 MB
    global palette + dithering       46 MB
    global palette, no dithering     21 MB   <- what this script does

Both matter for the same reason: a GIF frame can only be stored as a delta if
its pixels are byte-identical to the previous frame's. Per-frame palettes
renumber the indices and dithering perturbs visually identical regions, either
of which forces every frame to be stored whole. An explicit transparent-pixel
delta pass was also tried and gained nothing here -- the map pans continuously,
so almost every pixel genuinely changes.
"""
import sys
import cv2
from PIL import Image

src, dst, width = sys.argv[1], sys.argv[2], int(sys.argv[3])

cap = cv2.VideoCapture(src)
src_fps = cap.get(cv2.CAP_PROP_FPS)
step = max(1, round(src_fps / 30.0))

rgb = []
i = 0
while True:
    ok, bgr = cap.read()
    if not ok:
        break
    if i % step == 0:
        h, w = bgr.shape[:2]
        height = round(h * width / w)
        height -= height % 2
        small = cv2.resize(bgr, (width, height), interpolation=cv2.INTER_AREA)
        rgb.append(Image.fromarray(cv2.cvtColor(small, cv2.COLOR_BGR2RGB)))
    i += 1
cap.release()

# One palette shared by every frame. Per-frame ADAPTIVE palettes look marginally
# better but force a full local colour table and a full pixel block per frame --
# 100 MB for this clip. A single global palette lets the encoder emit
# inter-frame deltas instead.
#
# Derive it from frames sampled across the whole clip, never from one frame.
# Deriving it from the middle frame lost the reds outright: that frame is a
# full-screen dark blue map, so a 256-colour adaptive palette computed from it
# spends every slot on blues and greys, and the Ko-fi button -- the one strongly
# red thing in the recording, and on screen for only part of it -- quantised to a
# washed-out pink. Stacking PALETTE_SAMPLES frames into one image before
# quantising makes every colour the clip ever shows compete for slots.
PALETTE_SAMPLES = 48
picks = [rgb[round(k * (len(rgb) - 1) / (PALETTE_SAMPLES - 1))] for k in range(PALETTE_SAMPLES)]
w0, h0 = picks[0].size
stack = Image.new("RGB", (w0, h0 * len(picks)))
for n, im in enumerate(picks):
    stack.paste(im, (0, n * h0))
base = stack.convert("P", palette=Image.ADAPTIVE, colors=256)
frames = [im.quantize(palette=base, dither=Image.NONE) for im in rgb]

# 33ms/frame == 30fps. GIF stores delay in 10ms units, so 3 is the closest
# representable value; 30fps is not exactly expressible in the format.
frames[0].save(
    dst,
    save_all=True,
    append_images=frames[1:],
    duration=33,
    loop=0,
    optimize=True,
    disposal=1,
)
print(f"{len(frames)} frames @ {width}px, step {step} from {src_fps}fps")
