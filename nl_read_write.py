from __future__ import annotations

import json
import os
import re
import time
from pathlib import Path, PurePosixPath

try:
    import torch
    import torch.nn.functional as F
except Exception as exc:  # pragma: no cover - runtime dependency
    raise RuntimeError("PyTorch is required for NL Read/Write nodes.") from exc

try:
    import numpy as np
except Exception as exc:  # pragma: no cover - runtime dependency
    raise RuntimeError("NumPy is required for NL Read/Write nodes.") from exc

try:
    from PIL import Image
except Exception:  # pragma: no cover - optional, used for common formats
    Image = None

try:
    import imageio.v3 as iio
except Exception:  # pragma: no cover - optional, used for exr/video
    iio = None


_FRAME_RE = re.compile(r"(\d+)(?!.*\d)")
_INVALID_NAME_CHARS = set('<>:"|?*')


def _sanitize_filename(value: str) -> str:
    if not value:
        return ""
    safe = []
    for char in value:
        if char.isalnum() or char in ("_", "-", "."):
            safe.append(char)
        else:
            safe.append("_")
    return "".join(safe)


def _sanitize_pattern(value: str) -> str:
    if not value:
        return ""
    normalized = value.replace("\\", "/")
    name_only = PurePosixPath(normalized).name
    safe = []
    for char in name_only:
        if char.isalnum() or char in ("_", "-", ".", "#", "%", "*", "?", "[", "]"):
            safe.append(char)
        else:
            safe.append("_")
    return "".join(safe)


def _sanitize_subfolder(value: str) -> str:
    if not value:
        return ""
    normalized = value.replace("\\", "/")
    path = PurePosixPath(normalized)
    if path.is_absolute() or any(part in ("..", "") for part in path.parts):
        return ""
    safe_parts = []
    for part in path.parts:
        safe = "".join("_" if c in _INVALID_NAME_CHARS else c for c in part)
        safe_parts.append(safe)
    return "/".join(safe_parts)


def _coalesce_context(context: dict | None, key: str) -> str:
    if not isinstance(context, dict):
        return ""
    value = context.get(key)
    if isinstance(value, str):
        return value.strip()
    return ""


def _context_resolution(context: dict | None) -> tuple[int | None, int | None]:
    if not isinstance(context, dict):
        return None, None
    res = context.get("resolution")
    if isinstance(res, (list, tuple)) and len(res) == 2:
        try:
            return int(res[0]), int(res[1])
        except Exception:
            return None, None
    return None, None


def _context_frame_range(context: dict | None) -> tuple[int | None, int | None]:
    if not isinstance(context, dict):
        return None, None
    fr = context.get("frame_range")
    if isinstance(fr, (list, tuple)) and len(fr) == 2:
        try:
            return int(fr[0]), int(fr[1])
        except Exception:
            return None, None
    return None, None


def _context_fps(context: dict | None) -> float | None:
    if not isinstance(context, dict):
        return None
    fps = context.get("fps")
    try:
        return float(fps)
    except Exception:
        return None


def _resolve_base_path(
    context: dict | None,
    folder_root: str,
    subfolder: str,
    path_override: str,
) -> Path:
    if path_override and path_override.strip():
        return Path(path_override).expanduser()
    project_path = _coalesce_context(context, "project_path")
    base = Path(project_path) if project_path else Path(os.getcwd())
    root = folder_root if folder_root in {"input", "output"} else "output"
    subfolder = _sanitize_subfolder(subfolder)
    if subfolder:
        return base / root / subfolder
    return base / root


def _default_basename(context: dict | None, version: int) -> str:
    parts = [
        _coalesce_context(context, "project"),
        _coalesce_context(context, "episode"),
        _coalesce_context(context, "scene"),
        _coalesce_context(context, "shot"),
    ]
    parts = [p for p in parts if p]
    base = "_".join(parts) if parts else "output"
    return _sanitize_filename(f"{base}_v{version:02d}")


def _default_pattern(context: dict | None, mode: str, version: int, ext: str) -> str:
    base = _default_basename(context, version)
    if mode == "sequence":
        return f"{base}.####.{ext}"
    return f"{base}.{ext}"


def _pattern_to_glob(pattern: str) -> str:
    if "#" in pattern:
        return re.sub(r"#+", "*", pattern)
    if "%0" in pattern:
        return re.sub(r"%0\d+d", "*", pattern)
    return pattern


def _split_version(value: str) -> tuple[str, int | None]:
    match = re.match(r"^(.*)_v(\\d+)$", value)
    if not match:
        return value, None
    return match.group(1), int(match.group(2))


def _extract_frame_number(path: Path) -> int | None:
    match = _FRAME_RE.search(path.stem)
    if not match:
        return None
    try:
        return int(match.group(1))
    except Exception:
        return None


def _load_image_array(path: Path) -> np.ndarray:
    ext = path.suffix.lower()
    if ext in {".exr", ".hdr"} and iio is not None:
        return iio.imread(path)
    if Image is None:
        if iio is None:
            raise RuntimeError("Pillow or imageio is required to read images.")
        return iio.imread(path)
    with Image.open(path) as img:
        return np.array(img)


def _array_to_tensor(arr: np.ndarray) -> torch.Tensor:
    if arr.ndim == 2:
        arr = arr[:, :, None]
    if arr.dtype.kind in {"u", "i"}:
        max_val = np.iinfo(arr.dtype).max
        arr = arr.astype(np.float32) / float(max_val)
    else:
        arr = arr.astype(np.float32)
        if arr.max() > 1.0:
            arr = arr / 255.0
    return torch.from_numpy(arr)


def _resize_tensor(
    image: torch.Tensor,
    target_w: int,
    target_h: int,
    fit_mode: str,
    interpolation: str,
) -> torch.Tensor:
    if target_w <= 0 or target_h <= 0:
        return image
    h, w = image.shape[:2]
    if h == target_h and w == target_w:
        return image
    mode = {
        "nearest": "nearest",
        "bilinear": "bilinear",
        "bicubic": "bicubic",
        "area": "area",
    }.get(interpolation, "bilinear")

    def _interp(tensor: torch.Tensor, out_h: int, out_w: int) -> torch.Tensor:
        t = tensor.permute(2, 0, 1).unsqueeze(0)
        resized = F.interpolate(t, size=(out_h, out_w), mode=mode, align_corners=False if mode in {"bilinear", "bicubic"} else None)
        return resized.squeeze(0).permute(1, 2, 0)

    if fit_mode == "stretch":
        return _interp(image, target_h, target_w)

    scale = min(target_w / w, target_h / h) if fit_mode == "letterbox" else max(target_w / w, target_h / h)
    new_w = max(1, int(round(w * scale)))
    new_h = max(1, int(round(h * scale)))
    resized = _interp(image, new_h, new_w)
    if fit_mode == "crop":
        top = max(0, (new_h - target_h) // 2)
        left = max(0, (new_w - target_w) // 2)
        return resized[top : top + target_h, left : left + target_w, :]

    pad_h = max(0, target_h - new_h)
    pad_w = max(0, target_w - new_w)
    pad_top = pad_h // 2
    pad_bottom = pad_h - pad_top
    pad_left = pad_w // 2
    pad_right = pad_w - pad_left
    padded = F.pad(resized.permute(2, 0, 1), (pad_left, pad_right, pad_top, pad_bottom), value=0.0)
    return padded.permute(1, 2, 0)


def _ensure_channels(image: torch.Tensor, mode: str) -> tuple[torch.Tensor, torch.Tensor | None]:
    mask = None
    if mode == "keep":
        return image, None
    if mode == "RGB":
        if image.shape[2] >= 3:
            return image[:, :, :3], None
        return image.repeat(1, 1, 3), None
    if mode == "RGBA":
        if image.shape[2] == 4:
            return image, None
        alpha = torch.ones_like(image[:, :, :1])
        if image.shape[2] >= 3:
            return torch.cat([image[:, :, :3], alpha], dim=2), None
        rgb = image.repeat(1, 1, 3)
        return torch.cat([rgb, alpha], dim=2), None
    if mode == "mask":
        if image.shape[2] >= 4:
            mask = image[:, :, 3]
        else:
            mask = image[:, :, :3].mean(dim=2)
        mask = mask.clamp(0.0, 1.0)
        mask_rgb = mask.unsqueeze(2).repeat(1, 1, 3)
        return mask_rgb, mask
    return image, None


def _tensor_to_pil(image: torch.Tensor) -> Image.Image:
    if Image is None:
        raise RuntimeError("Pillow is required to write images.")
    img = image.detach().cpu().clamp(0.0, 1.0).numpy()
    if img.ndim == 2:
        img = img[:, :, None]
    img = (img * 255.0).round().astype(np.uint8)
    if img.shape[2] == 1:
        return Image.fromarray(img[:, :, 0], mode="L")
    if img.shape[2] == 3:
        return Image.fromarray(img, mode="RGB")
    if img.shape[2] == 4:
        return Image.fromarray(img, mode="RGBA")
    return Image.fromarray(img[:, :, :3], mode="RGB")


def _write_image(path: Path, image: torch.Tensor, format_name: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    ext = format_name.lower()
    if ext == "exr":
        if iio is None:
            raise RuntimeError("imageio is required to write EXR files.")
        iio.imwrite(path, image.detach().cpu().numpy())
        return
    pil = _tensor_to_pil(image)
    save_kwargs = {}
    if ext in {"jpg", "jpeg"}:
        save_kwargs["quality"] = 95
    pil.save(path, format=ext.upper(), **save_kwargs)


class NLRead:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "workflow_context": ("NL_WORKFLOW_CONTEXT",),
                "mode": (["single_image", "sequence", "video"],),
                "folder_root": (["input", "output"],),
                "subfolder": ("STRING", {"default": ""}),
                "name_or_pattern": ("STRING", {"default": ""}),
                "version": ("INT", {"default": 1, "min": 1, "max": 999}),
                "file_ext": ("STRING", {"default": "png"}),
                "path_override": ("STRING", {"default": ""}),
                "resize_preset": (["workflow", "HD 1920x1080", "4K 3840x2160", "custom", "none"],),
                "custom_width": ("INT", {"default": 1920, "min": 1, "max": 16384}),
                "custom_height": ("INT", {"default": 1080, "min": 1, "max": 16384}),
                "fit_mode": (["letterbox", "crop", "stretch"],),
                "interpolation": (["nearest", "bilinear", "bicubic", "area"],),
                "color_mode": (["keep", "RGB", "RGBA", "mask"],),
                "split_alpha": ("BOOLEAN", {"default": True}),
                "frame_start_override": ("INT", {"default": -1}),
                "frame_end_override": ("INT", {"default": -1}),
                "frame_step": ("INT", {"default": 1, "min": 1}),
                "fps_override": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 240.0}),
                "decode_stride": ("INT", {"default": 1, "min": 1, "max": 120}),
            }
        }

    RETURN_TYPES = ("IMAGE", "MASK", "STRING")
    RETURN_NAMES = ("images", "mask", "metadata")
    FUNCTION = "read"
    CATEGORY = "NOLABEL/IO"

    def read(
        self,
        workflow_context: dict,
        mode: str,
        folder_root: str,
        subfolder: str,
        name_or_pattern: str,
        version: int,
        file_ext: str,
        path_override: str,
        resize_preset: str,
        custom_width: int,
        custom_height: int,
        fit_mode: str,
        interpolation: str,
        color_mode: str,
        split_alpha: bool,
        frame_start_override: int,
        frame_end_override: int,
        frame_step: int,
        fps_override: float,
        decode_stride: int,
    ):
        warnings = []
        base = _resolve_base_path(workflow_context, folder_root, subfolder, path_override)
        name_or_pattern = name_or_pattern.strip()
        ext = file_ext.strip().lstrip(".") or "png"
        if not name_or_pattern:
            name_or_pattern = _default_pattern(workflow_context, "sequence" if mode == "sequence" else "single", version, ext)
        name_or_pattern = _sanitize_pattern(name_or_pattern)
        target = base / name_or_pattern

        target_w = target_h = None
        if resize_preset == "workflow":
            target_w, target_h = _context_resolution(workflow_context)
        elif resize_preset == "HD 1920x1080":
            target_w, target_h = 1920, 1080
        elif resize_preset == "4K 3840x2160":
            target_w, target_h = 3840, 2160
        elif resize_preset == "custom":
            target_w, target_h = custom_width, custom_height

        images = []
        masks = []
        resolved_files: list[str] = []

        if mode == "sequence":
            glob_pattern = _pattern_to_glob(name_or_pattern)
            files = sorted(base.glob(glob_pattern))
            if not files:
                warnings.append("No files matched the sequence pattern.")
            else:
                frame_start, frame_end = _context_frame_range(workflow_context)
                if frame_start_override >= 0:
                    frame_start = frame_start_override
                if frame_end_override >= 0:
                    frame_end = frame_end_override
                filtered = []
                for path in files:
                    frame_num = _extract_frame_number(path)
                    if frame_start is not None and frame_num is not None and frame_num < frame_start:
                        continue
                    if frame_end is not None and frame_num is not None and frame_num > frame_end:
                        continue
                    filtered.append(path)
                files = filtered[:: max(1, frame_step)]
                files = files[:: max(1, decode_stride)]
                for path in files:
                    resolved_files.append(str(path))
                    arr = _load_image_array(path)
                    tensor = _array_to_tensor(arr)
                    if target_w and target_h:
                        tensor = _resize_tensor(tensor, target_w, target_h, fit_mode, interpolation)
                    tensor, mask = _ensure_channels(tensor, color_mode)
                    frame_mask = None
                    if split_alpha and tensor.shape[2] >= 4:
                        frame_mask = tensor[:, :, 3].clone()
                    if mask is not None:
                        frame_mask = mask
                    masks.append(frame_mask)
                    images.append(tensor)
        elif mode == "video":
            if iio is None:
                warnings.append("imageio is required to read videos.")
            if not target.exists():
                warnings.append("Video file does not exist.")
            elif iio is not None:
                resolved_files.append(str(target))
                reader = iio.imiter(target)
                for idx, frame in enumerate(reader):
                    if idx % decode_stride != 0:
                        continue
                    tensor = _array_to_tensor(frame)
                    if target_w and target_h:
                        tensor = _resize_tensor(tensor, target_w, target_h, fit_mode, interpolation)
                    tensor, mask = _ensure_channels(tensor, color_mode)
                    frame_mask = None
                    if split_alpha and tensor.shape[2] >= 4:
                        frame_mask = tensor[:, :, 3].clone()
                    if mask is not None:
                        frame_mask = mask
                    masks.append(frame_mask)
                    images.append(tensor)
        else:
            if not target.exists():
                warnings.append("Image file does not exist.")
            else:
                resolved_files.append(str(target))
                arr = _load_image_array(target)
                tensor = _array_to_tensor(arr)
                if target_w and target_h:
                    tensor = _resize_tensor(tensor, target_w, target_h, fit_mode, interpolation)
                tensor, mask = _ensure_channels(tensor, color_mode)
                frame_mask = None
                if split_alpha and tensor.shape[2] >= 4:
                    frame_mask = tensor[:, :, 3].clone()
                if mask is not None:
                    frame_mask = mask
                masks.append(frame_mask)
                images.append(tensor)

        if not images:
            images = [torch.zeros((64, 64, 3), dtype=torch.float32)]
            masks = [torch.zeros((64, 64), dtype=torch.float32)]
            warnings.append("Fallback empty image emitted.")

        batch = torch.stack(images, dim=0)
        if not masks or all(mask is None for mask in masks):
            mask_out = torch.zeros((batch.shape[0], batch.shape[1], batch.shape[2]), dtype=torch.float32)
        else:
            mask_tensors = []
            for idx, mask in enumerate(masks):
                if mask is None:
                    mask_tensors.append(torch.zeros((batch.shape[1], batch.shape[2]), dtype=torch.float32))
                else:
                    mask_tensors.append(mask)
            mask_out = torch.stack(mask_tensors, dim=0)

        metadata = {
            "resolved_files": resolved_files,
            "mode": mode,
            "base_path": str(base),
            "pattern": name_or_pattern,
            "preprocess": {
                "resize_preset": resize_preset,
                "target_width": target_w,
                "target_height": target_h,
                "fit_mode": fit_mode,
                "interpolation": interpolation,
                "color_mode": color_mode,
            },
            "frame_range": _context_frame_range(workflow_context),
            "fps": fps_override if fps_override > 0 else _context_fps(workflow_context),
            "decode_stride": decode_stride,
            "warnings": warnings,
            "timestamp": time.time(),
        }
        metadata_json = json.dumps(metadata, indent=2, sort_keys=True)
        return (batch, mask_out, metadata_json)


class NLWrite:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "workflow_context": ("NL_WORKFLOW_CONTEXT",),
                "images": ("IMAGE",),
                "mode": (["single_image", "sequence"],),
                "folder_root": (["output", "input"],),
                "subfolder": ("STRING", {"default": ""}),
                "path_override": ("STRING", {"default": ""}),
                "basename": ("STRING", {"default": ""}),
                "version": ("INT", {"default": 1, "min": 1, "max": 999}),
                "auto_increment": ("BOOLEAN", {"default": True}),
                "collision_policy": (["auto-bump", "overwrite", "skip"],),
                "frame_padding": ("INT", {"default": 4, "min": 1, "max": 8}),
                "format": (["png", "exr", "jpg", "tiff", "webp"],),
                "metadata_sidecar": ("BOOLEAN", {"default": True}),
                "render_preview": ("BOOLEAN", {"default": False}),
                "preview_format": (["mp4", "mov"],),
            },
            "optional": {
                "mask": ("MASK",),
            },
        }

    RETURN_TYPES = ("STRING", "STRING", "STRING")
    RETURN_NAMES = ("file_paths", "preview_path", "metadata")
    FUNCTION = "write"
    CATEGORY = "NOLABEL/IO"

    def write(
        self,
        workflow_context: dict,
        images: torch.Tensor,
        mode: str,
        folder_root: str,
        subfolder: str,
        path_override: str,
        basename: str,
        version: int,
        auto_increment: bool,
        collision_policy: str,
        frame_padding: int,
        format: str,
        metadata_sidecar: bool,
        render_preview: bool,
        preview_format: str,
        mask: torch.Tensor | None = None,
    ):
        warnings = []
        base = _resolve_base_path(workflow_context, folder_root, subfolder, path_override)
        base.mkdir(parents=True, exist_ok=True)

        basename = basename.strip()
        if not basename:
            basename = _default_basename(workflow_context, version)
        basename = _sanitize_filename(basename)
        name_prefix, name_version = _split_version(basename)

        def _sequence_root(name: str) -> Path:
            return base / name

        def _output_exists(name: str) -> bool:
            if mode == "single_image":
                return (base / f"{name}.{format}").exists()
            seq_root = _sequence_root(name)
            return seq_root.exists() and any(seq_root.iterdir())

        if auto_increment and _output_exists(basename):
            collision_policy = "auto-bump"

        if collision_policy == "auto-bump":
            if name_version is not None:
                bump_version = name_version
                while _output_exists(basename):
                    bump_version += 1
                    basename = f"{name_prefix}_v{bump_version:02d}"
            else:
                bump_version = max(1, int(version))
                if _output_exists(basename):
                    basename = f"{basename}_v{bump_version:02d}"
                while _output_exists(basename):
                    bump_version += 1
                    basename = f"{name_prefix}_v{bump_version:02d}"
        elif collision_policy == "skip" and _output_exists(basename):
            metadata = {
                "status": "skipped",
                "reason": "collision",
                "base_path": str(base),
                "basename": basename,
                "warnings": warnings,
            }
            return (json.dumps([str(base / f"{basename}.{format}")]), "", json.dumps(metadata, indent=2))

        output_paths: list[str] = []
        preview_path = ""
        images = images.detach().cpu()
        batch = images
        if batch.ndim == 3:
            batch = batch.unsqueeze(0)

        if mask is not None:
            mask = mask.detach().cpu()
            if mask.ndim == 2:
                mask = mask.unsqueeze(0)

        if mode == "single_image":
            image = batch[0]
            if mask is not None:
                alpha = mask[0]
                if alpha.ndim == 2:
                    alpha = alpha.unsqueeze(2)
                if image.shape[2] == 3:
                    image = torch.cat([image, alpha], dim=2)
                elif image.shape[2] >= 4:
                    image[:, :, 3:4] = alpha
            out_path = base / f"{basename}.{format}"
            _write_image(out_path, image, format)
            output_paths.append(str(out_path))
        else:
            frame_start, _ = _context_frame_range(workflow_context)
            if frame_start is None:
                frame_start = 1
            seq_root = _sequence_root(basename)
            seq_root.mkdir(parents=True, exist_ok=True)
            for idx in range(batch.shape[0]):
                frame_num = frame_start + idx
                frame_name = f"{basename}.{frame_num:0{frame_padding}d}.{format}"
                out_path = seq_root / frame_name
                image = batch[idx]
                if mask is not None:
                    alpha = mask[idx if idx < mask.shape[0] else -1]
                    if alpha.ndim == 2:
                        alpha = alpha.unsqueeze(2)
                    if image.shape[2] == 3:
                        image = torch.cat([image, alpha], dim=2)
                    elif image.shape[2] >= 4:
                        image[:, :, 3:4] = alpha
                _write_image(out_path, image, format)
                output_paths.append(str(out_path))

            if render_preview:
                if iio is None:
                    warnings.append("imageio not available; preview not rendered.")
                else:
                    preview_dir = seq_root / "preview"
                    preview_dir.mkdir(parents=True, exist_ok=True)
                    preview_path = str(preview_dir / f"{basename}_preview.{preview_format}")
                    fps = _context_fps(workflow_context) or 24.0
                    iio.imwrite(preview_path, (batch.clamp(0.0, 1.0).numpy() * 255).astype(np.uint8), fps=fps)

        if metadata_sidecar:
            metadata_path = (
                base / f"{basename}.json" if mode == "single_image" else _sequence_root(basename) / "metadata.json"
            )
            metadata_payload = {
                "base_path": str(base),
                "basename": basename,
                "mode": mode,
                "format": format,
                "output_paths": output_paths,
                "preview_path": preview_path,
                "warnings": warnings,
                "timestamp": time.time(),
            }
            try:
                with metadata_path.open("w", encoding="utf-8") as handle:
                    json.dump(metadata_payload, handle, indent=2, sort_keys=True)
            except Exception as exc:  # pragma: no cover - IO guard
                warnings.append(f"Failed to write metadata sidecar: {exc}")

        metadata = {
            "base_path": str(base),
            "basename": basename,
            "mode": mode,
            "format": format,
            "output_paths": output_paths,
            "preview_path": preview_path,
            "warnings": warnings,
        }
        return (json.dumps(output_paths, indent=2), preview_path, json.dumps(metadata, indent=2))
