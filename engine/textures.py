"""Generate the paper and film-grain textures the scene engine uses.

Run once (build.py calls it automatically when the files are missing):
    python3 engine/textures.py
"""
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

OUT = Path(__file__).resolve().parent.parent / "assets" / "textures"


def smooth_noise(h, w, scale, rng):
    small = rng.random((max(2, h // scale), max(2, w // scale))).astype(np.float32)
    img = Image.fromarray((small * 255).astype(np.uint8)).resize((w, h), Image.BICUBIC)
    return np.asarray(img, dtype=np.float32) / 255.0


def paper(w=2400, h=2400, seed=7):
    rng = np.random.default_rng(seed)
    base = np.array([241, 236, 226], np.float32)  # warm newsprint
    n = (
        0.50 * smooth_noise(h, w, 400, rng)
        + 0.30 * smooth_noise(h, w, 90, rng)
        + 0.20 * smooth_noise(h, w, 12, rng)
    )
    n = (n - n.mean()) * 22.0
    fine = (rng.random((h, w)).astype(np.float32) - 0.5) * 7.0
    # paper fibres: thin streaks
    fib = np.zeros((h, w), np.float32)
    for _ in range(2600):
        x, y = rng.integers(0, w), rng.integers(0, h)
        L = rng.integers(10, 50)
        ang = rng.uniform(0, np.pi)
        xs = (x + np.cos(ang) * np.arange(L)).astype(int) % w
        ys = (y + np.sin(ang) * np.arange(L)).astype(int) % h
        fib[ys, xs] -= rng.uniform(4, 10)
    fib = np.asarray(Image.fromarray(np.clip(fib + 128, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.6)), np.float32) - 128
    img = base[None, None, :] + (n + fine + fib)[..., None] * np.array([1.0, 0.98, 0.93])
    return Image.fromarray(np.clip(img, 0, 255).astype(np.uint8))


def grain(size=640, seed=3):
    rng = np.random.default_rng(seed)
    g = rng.normal(128, 38, (size, size)).astype(np.float32)
    g = np.asarray(Image.fromarray(np.clip(g, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.5)))
    return Image.fromarray(g)


def card(w=1400, h=1000, seed=11):
    """Off-white card stock used for document / quote cards."""
    rng = np.random.default_rng(seed)
    base = np.array([250, 248, 242], np.float32)
    n = (0.6 * smooth_noise(h, w, 120, rng) + 0.4 * smooth_noise(h, w, 10, rng) - 0.5) * 10
    img = base[None, None, :] + n[..., None]
    return Image.fromarray(np.clip(img, 0, 255).astype(np.uint8))


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    paper().save(OUT / "paper.jpg", quality=90)
    grain().save(OUT / "grain.png")
    card().save(OUT / "card.jpg", quality=90)
    print("textures ->", OUT)


if __name__ == "__main__":
    main()
