#!/usr/bin/env python3
"""生成 MOCK 模式的"AI 场景卡片"视频：深色渐变 + 镜头号 + 剧情描述 + 时间码动画。

用法:
  python3 scripts/mock_card.py --out out.mp4 --label "Shot c1s1" \
      --sub "阿光穿过集市，发现神秘钥匙" --accent 255,180,84 --duration 5

依赖: PIL（本机已装 11.x）。ffmpeg 负责编码。
"""
import argparse
import math
import os
import random
import shutil
import subprocess
import sys
import tempfile

from PIL import Image, ImageDraw, ImageFont

W, H = 960, 540
FPS = 12

FONT_CANDIDATES = [
    "/System/Library/Fonts/Hiragino Sans GB.ttc",
    "/System/Library/Fonts/STHeiti Medium.ttc",
    "/System/Library/Fonts/PingFang.ttc",
]


def load_font(size: int) -> ImageFont.FreeTypeFont:
    for path in FONT_CANDIDATES:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except Exception:
                continue
    return ImageFont.load_default()


def make_gradient(top: tuple, bottom: tuple) -> Image.Image:
    """预计算纵向渐变底图（一次性，避免逐像素循环）"""
    img = Image.new("RGB", (W, H))
    px = img.load()
    for y in range(H):
        t = y / (H - 1)
        color = tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3))
        for x in range(0, W, 8):  # 按 8px 块填充，够平滑且快
            for dx in range(8):
                if x + dx < W:
                    px[x + dx, y] = color
    return img


def wrap(text: str, n: int) -> list:
    lines = []
    while text:
        lines.append(text[:n])
        text = text[n:]
    return lines


def draw_frame(base: Image.Image, accent: tuple, label: str, sub_lines: list,
               frame_i: int, total: int, fonts: dict) -> Image.Image:
    img = base.copy()
    d = ImageDraw.Draw(img, "RGBA")

    # 顶部品牌条
    d.rectangle([0, 0, W, 54], fill=(8, 10, 14, 255))
    d.rectangle([0, 54, W, 56], fill=accent + (255,))
    d.text((28, 14), "◤ H3·LIVE  MOCK SCENE", font=fonts["small"], fill=(255, 180, 84, 255))
    d.text((W - 200, 16), "AIGC 实时生成", font=fonts["tiny"], fill=(138, 147, 158, 255))

    # 镜头号大标题
    d.text((48, 150), label, font=fonts["big"], fill=(233, 230, 223, 255))

    # 分隔线
    d.line([(48, 240), (W - 48, 240)], fill=accent + (160,), width=2)

    # 剧情描述（换行）
    yy = 268
    for line in sub_lines:
        d.text((48, yy), line, font=fonts["mid"], fill=(200, 205, 210, 255))
        yy += fonts["mid"].size + 10

    # 右下角时间码 + REC
    t = frame_i / FPS
    tc = f"{int(t // 60):02d}:{int(t % 60):02d}"
    d.text((W - 150, H - 64), tc, font=fonts["mid"], fill=(233, 230, 223, 255))
    d.ellipse([W - 268, H - 56, W - 252, H - 40], fill=(255, 93, 93, 255))
    d.text((W - 240, H - 62), "REC", font=fonts["small"], fill=(255, 93, 93, 255))

    # 扫描光带（每帧移动）
    band_y = int((frame_i * 14) % (H + 80)) - 40
    for k in range(3):
        d.rectangle([0, band_y + k * 3, W, band_y + k * 3 + 1], fill=accent + (26,))

    return img


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--label", required=True)
    ap.add_argument("--sub", default="")
    ap.add_argument("--accent", default="255,180,84")
    ap.add_argument("--duration", type=int, default=5)
    args = ap.parse_args()

    accent = tuple(int(x) for x in args.accent.split(","))
    total = int(args.duration * FPS)

    fonts = {
        "big": load_font(64),
        "mid": load_font(30),
        "small": load_font(18),
        "tiny": load_font(13),
    }
    sub_lines = wrap(args.sub or "MOCK 测试镜头", 26)[:4]
    if not sub_lines:
        sub_lines = ["MOCK 测试镜头"]

    rng = random.Random(hash(args.label) & 0xFFFFFFFF)
    top = (rng.randint(8, 22), rng.randint(8, 20), rng.randint(16, 30))
    base = make_gradient(top, (4, 5, 8))

    tmp = tempfile.mkdtemp(prefix="mockcard_")
    try:
        for i in range(total):
            frame = draw_frame(base, accent, args.label, sub_lines, i, total, fonts)
            frame.save(os.path.join(tmp, f"{i:03d}.png"))
        out = os.path.abspath(args.out)
        freq = 300 + (hash(args.label) % 20) * 10
        subprocess.run(
            [
                "ffmpeg", "-y", "-v", "error",
                "-framerate", str(FPS), "-i", os.path.join(tmp, "%03d.png"),
                "-f", "lavfi", "-i", f"sine=frequency={freq}:duration={args.duration}",
                "-c:v", "libx264", "-pix_fmt", "yuv420p",
                "-c:a", "aac", "-shortest", out,
            ],
            check=True,
        )
        print(f"mock card ok: {out}")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
