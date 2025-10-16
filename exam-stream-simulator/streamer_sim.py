# exam-stream-simulator/streamer_sim.py
import os, time, cv2, requests, sys, threading

BACKEND = os.getenv("BACKEND", "https://aquafina-stream.onrender.com")
UPLOAD  = f"{BACKEND}/upload"
SRC     = os.getenv("SRC", "study.mp4")   # "0" for webcam, or file path

# Two presets you can toggle at runtime
PRESETS = {
    # Balanced motion, smaller frames
    "smooth": {"FPS": 6.0, "JPEG_QUALITY": 68, "MAX_WIDTH": 720},

    # Best detail, fewer frames
    "sharp":  {"FPS": 2.0, "JPEG_QUALITY": 82, "MAX_WIDTH": 1280},
}

MODE = os.getenv("MODE", "smooth") if os.getenv("MODE", "smooth") in PRESETS else "smooth"

# current settings (mutable)
cfg = PRESETS[MODE].copy()

def open_source(src):
    if str(src).isdigit():
        cap = cv2.VideoCapture(int(src))
    else:
        cap = cv2.VideoCapture(src)
    if not cap.isOpened():
        raise RuntimeError(f"Cannot open source: {src}")
    return cap

def maybe_resize(frame, max_width):
    h, w = frame.shape[:2]
    if w <= max_width:
        return frame
    scale = max_width / w
    new_w, new_h = int(w * scale), int(h * scale)
    return cv2.resize(frame, (new_w, new_h), interpolation=cv2.INTER_AREA)

def kb_listener():
    """
    Simple cross-platform-ish hotkeys:
      [1] -> smooth preset
      [2] -> sharp preset
      [+]/[-] -> FPS up/down
      ]/[ -> JPEG quality up/down
      0/9 -> width up/down (±160 px)
      q -> quit
    """
    global cfg, running
    try:
        if os.name == "nt":
            import msvcrt
            while running:
                if msvcrt.kbhit():
                    ch = msvcrt.getwch()
                    if ch == "1":
                        cfg.update(PRESETS["smooth"])
                        print("\n→ preset: SMOOTH", cfg)
                    elif ch == "2":
                        cfg.update(PRESETS["sharp"])
                        print("\n→ preset: SHARP", cfg)
                    elif ch == "+":
                        cfg["FPS"] = min(cfg["FPS"] + 1, 30)
                        print("\n→ FPS:", cfg["FPS"])
                    elif ch == "-":
                        cfg["FPS"] = max(cfg["FPS"] - 1, 1)
                        print("\n→ FPS:", cfg["FPS"])
                    elif ch == "]":
                        cfg["JPEG_QUALITY"] = min(cfg["JPEG_QUALITY"] + 2, 95)
                        print("\n→ JPEG_QUALITY:", cfg["JPEG_QUALITY"])
                    elif ch == "[":
                        cfg["JPEG_QUALITY"] = max(cfg["JPEG_QUALITY"] - 2, 40)
                        print("\n→ JPEG_QUALITY:", cfg["JPEG_QUALITY"])
                    elif ch == "0":
                        cfg["MAX_WIDTH"] = min(cfg["MAX_WIDTH"] + 160, 1920)
                        print("\n→ MAX_WIDTH:", cfg["MAX_WIDTH"])
                    elif ch == "9":
                        cfg["MAX_WIDTH"] = max(cfg["MAX_WIDTH"] - 160, 320)
                        print("\n→ MAX_WIDTH:", cfg["MAX_WIDTH"])
                    elif ch.lower() == "q":
                        running = False
                        break
                time.sleep(0.05)
        else:
            # Minimal POSIX fallback: read line-buffered input
            for line in sys.stdin:
                line = line.strip()
                if line == "1":
                    cfg.update(PRESETS["smooth"]); print("\n→ preset: SMOOTH", cfg)
                elif line == "2":
                    cfg.update(PRESETS["sharp"]); print("\n→ preset: SHARP", cfg)
                elif line == "+":
                    cfg["FPS"] = min(cfg["FPS"] + 1, 30); print("\n→ FPS:", cfg["FPS"])
                elif line == "-":
                    cfg["FPS"] = max(cfg["FPS"] - 1, 1); print("\n→ FPS:", cfg["FPS"])
                elif line == "]":
                    cfg["JPEG_QUALITY"] = min(cfg["JPEG_QUALITY"] + 2, 95); print("\n→ JPEG_QUALITY:", cfg["JPEG_QUALITY"])
                elif line == "[":
                    cfg["JPEG_QUALITY"] = max(cfg["JPEG_QUALITY"] - 2, 40); print("\n→ JPEG_QUALITY:", cfg["JPEG_QUALITY"])
                elif line == "0":
                    cfg["MAX_WIDTH"] = min(cfg["MAX_WIDTH"] + 160, 1920); print("\n→ MAX_WIDTH:", cfg["MAX_WIDTH"])
                elif line == "9":
                    cfg["MAX_WIDTH"] = max(cfg["MAX_WIDTH"] - 160, 320); print("\n→ MAX_WIDTH:", cfg["MAX_WIDTH"])
                elif line.lower() == "q":
                    running = False
                    break
    except Exception as e:
        print("Hotkey thread error:", e)

def main():
    global running
    cap = open_source(SRC)
    STREAM_KEY = os.getenv("STREAM_KEY", "123COLBI")
    session = requests.Session()
    frames = 0
    bytes_sent = 0
    running = True

    # start hotkey thread
    t = threading.Thread(target=kb_listener, daemon=True)
    t.start()

    print(f"Streaming -> {UPLOAD} | src={SRC}")
    print("Hotkeys: [1]=smooth  [2]=sharp  +/- FPS  ]/[ quality  0/9 width  q=quit")
    try:
        next_t = time.perf_counter()
        while running:
            ok, frame = cap.read()
            if not ok:
                # loop mp4
                if not str(SRC).isdigit():
                    cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                    continue
                print("No frame from camera"); break

            frame = maybe_resize(frame, cfg["MAX_WIDTH"])
            ok, buf = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), int(cfg["JPEG_QUALITY"])])
            if not ok:
                continue
            data = buf.tobytes()

            try:
                r = session.post(
                    UPLOAD,
                    data=data,
                    headers={
                        "Content-Type": "application/octet-stream",
                        "Content-Length": str(len(data)),
                        "x-stream-key": STREAM_KEY,  # <--- add stream key header here
                    },
                    timeout=5
                )
                r.raise_for_status()
            except Exception as e:
                print("POST error:", e)
                time.sleep(0.25)
                next_t = time.perf_counter()
                continue

            frames += 1
            bytes_sent += len(data)
            if frames % 30 == 0:
                kb = int(bytes_sent/1024)
                print(f"{frames} frames (~{kb} KB) | cfg={cfg}")

            # FPS pacing
            period = 1.0 / max(float(cfg["FPS"]), 0.1)
            next_t += period
            sleep = next_t - time.perf_counter()
            if sleep > 0:
                time.sleep(sleep)
            else:
                next_t = time.perf_counter()
    finally:
        running = False
        cap.release()

if __name__ == "__main__":
    # pip install opencv-python requests
    main()
