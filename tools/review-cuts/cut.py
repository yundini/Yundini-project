"""영상에서 고른 장면을 블로그용 가로 사진(4:3 또는 5:4)으로 자른다.

사용: python3 cut.py 장면목록.json 결과폴더 [--ratio 4:3|5:4]

장면목록.json 예:
[
  {"name": "01_패키지_정면", "video": "/경로/IMG_0001.mov", "t": 12.4, "pos": 0.5},
  ...
]
- t: 초 단위 시각. 앞뒤 0.25초 안에서 가장 선명한 프레임을 고른다.
- pos: 잘라 낼 틀의 위치 (0=위/왼쪽 끝, 0.5=가운데, 1=아래/오른쪽 끝).
  세로 영상은 위아래로, 가로 영상은 좌우로 움직인다.

색감: 사용자가 비교해 보고 고른 'A' 방식이다. ffmpeg 기본 변환 그대로 쓰고
HDR 톤매핑은 하지 않는다. 보정·AI 편집도 하지 않는다.
"""
import json, os, subprocess, sys, tempfile
import numpy as np
from PIL import Image

def sharpness(im):
    g = np.asarray(im.convert("L").resize((im.width // 2, im.height // 2)), dtype=np.float32)
    lap = g[1:-1, 1:-1] * 4 - g[:-2, 1:-1] - g[2:, 1:-1] - g[1:-1, :-2] - g[1:-1, 2:]
    return float(lap.var())

def grab(video, t, path):
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{max(0, t):.3f}", "-i", video,
                    "-frames:v", "1", path], check=True)
    return Image.open(path).convert("RGB")

def crop(im, rw, rh, pos):
    W, H = im.size
    if W * rh >= H * rw:            # 가로로 넓은 프레임: 좌우를 자른다
        cw, ch = H * rw // rh, H
        x = int(round((W - cw) * pos)); return im.crop((x, 0, x + cw, ch))
    cw, ch = W, W * rh // rw        # 세로 프레임: 위아래를 자른다
    y = int(round((H - ch) * pos)); return im.crop((0, y, cw, y + ch))

def main():
    args = sys.argv[1:]
    ratio = "4:3"
    if "--ratio" in args:
        i = args.index("--ratio"); ratio = args[i + 1]; del args[i:i + 2]
    shots_file, out = args
    rw, rh = map(int, ratio.split(":"))
    os.makedirs(out, exist_ok=True)
    tmp = os.path.join(tempfile.mkdtemp(), "f.png")
    for s in json.load(open(shots_file, encoding="utf-8")):
        best = None
        for d in (-0.25, -0.15, -0.07, 0, 0.07, 0.15, 0.25):
            c = crop(grab(s["video"], s["t"] + d, tmp), rw, rh, s.get("pos", 0.5))
            sc = sharpness(c)
            if best is None or sc > best[0]: best = (sc, c, s["t"] + d)
        dst = os.path.join(out, s["name"] + ".jpg")
        best[1].save(dst, quality=95)
        print(f"{s['name']}  {best[2]:.2f}초  {best[1].width}x{best[1].height}  선명도 {best[0]:.0f}")

if __name__ == "__main__":
    main()
