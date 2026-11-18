from __future__ import annotations

import io
from pathlib import Path

import pillow_heif
from PIL import Image, ImageOps

pillow_heif.register_heif_opener()
Image.MAX_IMAGE_PIXELS = 80_000_000

WIDTHS = (600, 1200)
QUALITY = {"avif": 55, "webp": 80, "jpg": 84}
RATIO = (4, 5)


class ImageError(ValueError):
    pass


def crop_box(width: int, height: int, focus: float) -> tuple[int, int, int, int]:
    rw, rh = RATIO
    if width * rh > height * rw:
        new_w = height * rw // rh
        left = (width - new_w) // 2
        return left, 0, left + new_w, height
    new_h = width * rh // rw
    top = int(min(max(focus * height - new_h / 2, 0), height - new_h))
    return 0, top, width, top + new_h


def write_qr(source: bytes, path: Path) -> None:
    image = open_image(source, min_side=150)
    image.thumbnail((1000, 1000), Image.Resampling.LANCZOS)
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, optimize=True)


def open_image(source: bytes | Path, min_side: int = 300) -> Image.Image:
    try:
        with Image.open(io.BytesIO(source) if isinstance(source, bytes) else source) as raw:
            if raw.format not in ("HEIF", "JPEG", "PNG", "WEBP", "AVIF", "MPO"):
                raise ImageError("Use a JPEG, PNG, WebP or iPhone HEIC photo")
            image = ImageOps.exif_transpose(raw).convert("RGB")
    except ImageError:
        raise
    except (Image.DecompressionBombError, OSError, ValueError, SyntaxError):
        raise ImageError("That file isn't a photo we can read") from None
    if min(image.size) < min_side:
        raise ImageError(f"That photo is too small. Use one at least {min_side} pixels wide.")
    return image


def write_variants(image: Image.Image, out_dir: Path, stem: str, *, crop: bool, focus: float = 0.5, widths: tuple[int, ...] = WIDTHS) -> tuple[int, int]:
    out_dir.mkdir(parents=True, exist_ok=True)
    if crop:
        image = image.crop(crop_box(image.width, image.height, focus))
    largest = (0, 0)
    for width in widths:
        w = min(width, image.width)
        h = round(image.height * w / image.width)
        resized = image.resize((w, h), Image.Resampling.LANCZOS)
        resized.save(out_dir / f"{stem}-{width}.avif", quality=QUALITY["avif"])
        resized.save(out_dir / f"{stem}-{width}.webp", quality=QUALITY["webp"], method=6)
        resized.save(out_dir / f"{stem}-{width}.jpg", quality=QUALITY["jpg"], optimize=True, progressive=True)
        largest = (w, h)
    return largest
