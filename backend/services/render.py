"""Cinematic tour video (BRD 10.2 / TOUR-006).

Renders a real, branded property video from the approved plan and tour: a title
card, an animated floor-plan reveal, a guided sweep that highlights each room in
turn with a caption (name · type · dimensions), and a closing card. Frames are
drawn with OpenCV and encoded to H.264 MP4 with FFmpeg at the requested aspect
ratio / resolution.

If FFmpeg or OpenCV is unavailable it reports that cleanly instead of failing."""
import shutil
import subprocess

from .. import config

try:
    import cv2
    import numpy as np
    _CV = True
except Exception:                       # pragma: no cover
    _CV = False

_RES = {
    ("16:9", "1080p"): (1920, 1080), ("16:9", "720p"): (1280, 720),
    ("9:16", "1080p"): (1080, 1920), ("9:16", "720p"): (720, 1280),
    ("1:1", "1080p"): (1080, 1080), ("1:1", "720p"): (720, 720),
}
FPS = 30
# palette (BGR)
INK = (58, 44, 30); ACCENT = (151, 100, 44); ACCENT2 = (208, 138, 63)
LINE = (188, 176, 160); MUT = (150, 140, 128)
_FONT = cv2.FONT_HERSHEY_DUPLEX if _CV else 0


def _fit(iw, ih, W, H, frac_w, frac_h):
    s = min(W * frac_w / max(1, iw), H * frac_h / max(1, ih))
    return s, (W - iw * s) / 2, (H - ih * s) / 2


def _text(img, txt, org, scale, color, thick=2, center=False):
    (tw, th), _ = cv2.getTextSize(txt, _FONT, scale, thick)
    x, y = org
    if center:
        x -= tw // 2
    cv2.putText(img, txt, (int(x), int(y)), _FONT, scale, color, thick, cv2.LINE_AA)
    return tw, th


def _ease(t):
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)


def _gradient_bg(W, H, top, bot):
    col = np.linspace(0, 1, H, dtype=np.float32)[:, None, None]
    base = np.array(top, np.float32) * (1 - col) + np.array(bot, np.float32) * col
    return np.repeat(base.astype(np.uint8), W, axis=1)


def _draw_plan(frame, vectors, s, ox, oy, active_idx=None, reveal=1.0):
    rooms = vectors.get("rooms", [])
    walls = vectors.get("walls", [])
    for i, r in enumerate(rooms):
        x0, y0 = int(r["x"] * s + ox), int(r["y"] * s + oy)
        x1, y1 = int((r["x"] + r["w"]) * s + ox), int((r["y"] + r["h"]) * s + oy)
        act = (i == active_idx)
        tint = (224, 236, 246) if act else (235, 237, 239)
        over = frame.copy()
        cv2.rectangle(over, (x0, y0), (x1, y1), tint, -1)
        cv2.addWeighted(over, 0.9 if act else 0.55, frame, 0.1 if act else 0.45, 0, frame)
        cv2.rectangle(frame, (x0, y0), (x1, y1), ACCENT if act else LINE, 3 if act else 1, cv2.LINE_AA)
        nm = r.get("name", "")
        if nm:
            _text(frame, nm, (x0 + 8, y0 + 22), 0.5, INK if act else MUT, 1)
    n = max(1, int(len(walls) * reveal))
    for w in walls[:n]:
        cv2.line(frame, (int(w["x1"] * s + ox), int(w["y1"] * s + oy)),
                 (int(w["x2"] * s + ox), int(w["y2"] * s + oy)), INK, 3, cv2.LINE_AA)


def _lower_third(frame, W, H, title, sub):
    bar_h = int(H * 0.16); y0 = H - bar_h
    over = frame.copy()
    cv2.rectangle(over, (0, y0), (W, H), (250, 248, 245), -1)
    cv2.rectangle(over, (0, y0), (int(W * 0.012), H), ACCENT, -1)
    cv2.addWeighted(over, 0.92, frame, 0.08, 0, frame)
    _text(frame, title, (int(W * 0.05), y0 + int(bar_h * 0.46)), H / 1400 * 1.5, INK, 2)
    if sub:
        _text(frame, sub, (int(W * 0.05), y0 + int(bar_h * 0.78)), H / 1400 * 0.9, ACCENT, 1)


def _brandmark(frame, cx, cy, r):
    cv2.circle(frame, (int(cx), int(cy)), int(r), ACCENT, -1, cv2.LINE_AA)
    cv2.circle(frame, (int(cx), int(cy)), int(r), ACCENT2, 3, cv2.LINE_AA)
    if r > 14:
        _text(frame, "VBT", (cx, cy + r * 0.22), r / 26, (255, 255, 255), 2, center=True)


def render(render_id: int, ratio: str, resolution: str, title: str = "",
           scenes=None, vectors=None, branding=None) -> dict:
    if not _CV:
        return {"status": "engine_unavailable", "output_path": None,
                "note": "Video engine (OpenCV) unavailable."}
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        return {"status": "engine_unavailable", "output_path": None,
                "note": "FFmpeg is not installed — install FFmpeg to render tour videos."}

    W, H = _RES.get((ratio, resolution), _RES[("16:9", "720p")])
    vectors = vectors or {}
    rooms = [r for r in vectors.get("rooms", []) if r.get("name")]
    iw, ih = vectors.get("image_size", [1000, 750])
    s, ox, oy = _fit(iw, ih, W, H, 0.82, 0.58)
    oy -= H * 0.03
    brand_title = (branding or {}).get("title") or title or "Virtual Building Tour"

    frames_dir = config.RENDER_DIR / f"frames_{render_id}"
    shutil.rmtree(frames_dir, ignore_errors=True)
    frames_dir.mkdir(parents=True, exist_ok=True)

    T_INTRO, T_REVEAL, T_ROOM, T_OUTRO = 2.2, 2.0, 1.7, 2.2
    plan_bg = _gradient_bg(W, H, (247, 244, 240), (228, 224, 218))
    idx = 0

    def save(frame):
        nonlocal idx
        cv2.imwrite(str(frames_dir / f"{idx:05d}.png"), frame)
        idx += 1

    for f in range(int(T_INTRO * FPS)):                       # 1) title card
        t = _ease(f / (T_INTRO * FPS))
        fr = _gradient_bg(W, H, (60, 46, 32), (36, 28, 20))
        _brandmark(fr, W / 2, H * 0.34, H * 0.07 * t)
        if t > 0.3:
            a = _ease((t - 0.3) / 0.7)
            tmp = fr.copy()
            _text(tmp, brand_title, (W / 2, H * 0.56), H / 1400 * 2.4, (245, 242, 238), 3, center=True)
            _text(tmp, "AI-Generated Virtual Building Tour", (W / 2, H * 0.63), H / 1400 * 1.0, (198, 178, 150), 1, center=True)
            cv2.addWeighted(tmp, a, fr, 1 - a, 0, fr)
        save(fr)

    for f in range(int(T_REVEAL * FPS)):                      # 2) plan reveal
        t = _ease(f / (T_REVEAL * FPS))
        fr = plan_bg.copy()
        _draw_plan(fr, vectors, s, ox, oy, None, reveal=t)
        _text(fr, "Floor Plan", (int(W * 0.05), int(H * 0.11)), H / 1400 * 1.4, INK, 2)
        _text(fr, f"{len(rooms)} rooms", (int(W * 0.05), int(H * 0.15)), H / 1400 * 0.85, MUT, 1)
        save(fr)

    for i, r in enumerate(rooms):                             # 3) guided room sweep
        for f in range(int(T_ROOM * FPS)):
            fr = plan_bg.copy()
            _draw_plan(fr, vectors, s, ox, oy, i, reveal=1.0)
            cx = int((r["x"] + r["w"] / 2) * s + ox)
            cy = int((r["y"] + r["h"] / 2) * s + oy)
            cv2.circle(fr, (cx, cy), int(10 + 5 * abs(np.sin(f / 6.0))), ACCENT2, 2, cv2.LINE_AA)
            dim = f" · {r['dim_label']}" if r.get("dim_label") else ""
            rtype = (r.get("type", "room") or "room").replace("_", " ").title()
            _lower_third(fr, W, H, r["name"], f"{rtype}{dim}")
            _text(fr, f"{i + 1}/{len(rooms)}", (int(W * 0.90), int(H * 0.11)), H / 1400 * 1.0, MUT, 2)
            save(fr)

    for f in range(int(T_OUTRO * FPS)):                       # 4) outro
        fr = _gradient_bg(W, H, (60, 46, 32), (36, 28, 20))
        _brandmark(fr, W / 2, H * 0.40, H * 0.06)
        _text(fr, brand_title, (W / 2, H * 0.56), H / 1400 * 1.8, (245, 242, 238), 3, center=True)
        _text(fr, "Explore the interactive 3D tour online", (W / 2, H * 0.62), H / 1400 * 0.95, (198, 178, 150), 1, center=True)
        save(fr)

    out = config.RENDER_DIR / f"render_{render_id}.mp4"
    cmd = [ffmpeg, "-y", "-framerate", str(FPS), "-i", str(frames_dir / "%05d.png"),
           "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(out)]
    try:
        subprocess.run(cmd, check=True, capture_output=True, timeout=240)
        return {"status": "completed", "output_path": str(out.relative_to(config.STORAGE_DIR)),
                "note": f"{ratio} {resolution} tour video · {len(rooms)} rooms"}
    except Exception as e:                       # pragma: no cover
        return {"status": "failed", "output_path": None, "note": f"Render failed: {e}"}
    finally:
        shutil.rmtree(frames_dir, ignore_errors=True)
