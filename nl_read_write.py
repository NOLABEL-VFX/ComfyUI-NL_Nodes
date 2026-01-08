from __future__ import annotations

import hashlib
import json
import math
import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

try:
    from aiohttp import web
except Exception:  # pragma: no cover
    web = None

try:
    from server import PromptServer
except Exception:  # pragma: no cover
    PromptServer = None

try:
    import folder_paths
except Exception:  # pragma: no cover
    folder_paths = None

try:
    from .nl_workflow import get_workflow_context
except Exception:  # pragma: no cover
    get_workflow_context = None

try:
    import imageio.v3 as iio
except Exception:  # pragma: no cover
    try:
        import imageio as iio
    except Exception:
        iio = None

try:
    import numpy as np
except Exception:  # pragma: no cover
    np = None

try:
    import torch
except Exception:  # pragma: no cover
    torch = None

try:
    from PIL import Image
except Exception:  # pragma: no cover
    Image = None


_IMAGE_EXTS = {
    ".png",
    ".jpg",
    ".jpeg",
    ".tif",
    ".tiff",
    ".bmp",
    ".webp",
    ".exr",
}

_VIDEO_EXTS = {
    ".mp4",
    ".mov",
    ".m4v",
    ".mkv",
    ".webm",
    ".avi",
    ".mpg",
    ".mpeg",
}

_BROWSER_VIDEO_EXTS = {
    ".mp4",
    ".webm",
    ".m4v",
}

_FORCE_SIZE_OPTIONS = ["Disabled", "512x?", "1024x?", "?x512"]

_ROUTES_REGISTERED = False


class NLRead:
    def __init__(self):
        _register_routes()

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "source": ("STRING", {"default": ""}),
                "max_frames": ("INT", {"default": 120, "min": 1, "max": 10000}),
                "skip_first": ("INT", {"default": 0, "min": 0, "max": 100000}),
                "every_nth": ("INT", {"default": 1, "min": 1, "max": 1000}),
            },
            "optional": {
                "workflow_context": ("NL_WORKFLOW_CONTEXT",),
            },
        }

    RETURN_TYPES = ("IMAGE", "MASK", "INT", "STRING")
    RETURN_NAMES = ("image", "mask", "frame_count_loaded", "resolved_path")
    FUNCTION = "read"
    CATEGORY = "NOLABEL/IO"

    @classmethod
    def IS_CHANGED(cls, source="", **_kwargs):
        context = _get_workflow_context(_kwargs.get("workflow_context"))
        resolved = _resolve_source(source, "auto", context)
        signature = _build_change_signature(resolved)
        return signature

    def read(
        self,
        source: str,
        max_frames: int,
        skip_first: int,
        every_nth: int,
        workflow_context: dict | None = None,
    ):
        if torch is None or np is None or Image is None:
            raise RuntimeError("NL Read requires torch, numpy, and Pillow")

        if not source:
            return _empty_output()

        context = _get_workflow_context(workflow_context)
        resolved = _resolve_source(source, "auto", context)
        resolved_path = resolved.path
        resolved_mode = resolved.mode

        if not resolved_path:
            return _empty_output()

        skip_first = max(0, int(skip_first))
        every_nth = max(1, int(every_nth))
        max_frames = max(1, int(max_frames))
        force_size = "Disabled"

        if resolved_mode == "image":
            _ensure_safe_path(Path(resolved_path), context)
            image, mask = _load_image_tensor(Path(resolved_path), force_size)
            return image, mask, 1, resolved_path

        if resolved_mode == "sequence":
            frames = _select_sequence_frames(resolved, skip_first, every_nth, max_frames)
            if not frames:
                return _empty_output(resolved_path)
            _ensure_safe_path(frames[0], context)
            images, masks = _load_images_tensor(frames, force_size)
            return images, masks, images.shape[0], resolved.path

        if resolved_mode == "video":
            _ensure_safe_path(Path(resolved_path), context)
            images, masks = _load_video_tensor(
                Path(resolved_path),
                skip_first=skip_first,
                every_nth=every_nth,
                max_frames=max_frames,
                force_size=force_size,
            )
            return images, masks, images.shape[0], resolved_path

        return _empty_output(resolved_path)


class NLWrite:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {}}

    RETURN_TYPES = ()
    RETURN_NAMES = ()
    FUNCTION = "noop"
    CATEGORY = "NOLABEL/IO"
    OUTPUT_NODE = True

    def noop(self):
        return {}


class _ResolvedSource:
    def __init__(self, path: str | None, mode: str, is_pattern: bool = False):
        self.path = path
        self.mode = mode
        self.is_pattern = is_pattern


def _empty_output(resolved_path: str = ""):
    if torch is None or np is None:
        return (), (), 0, resolved_path
    image = torch.zeros((1, 1, 1, 3), dtype=torch.float32)
    mask = torch.zeros((1, 1, 1), dtype=torch.float32)
    return image, mask, 0, resolved_path


def _resolve_source(source: str, mode: str, context: dict | None = None) -> _ResolvedSource:
    source = _normalize_source(source)
    if context:
        source = _expand_source_with_context(source, context)
    if not source:
        return _ResolvedSource(None, mode)

    path = Path(source)
    if mode != "auto":
        if mode == "sequence":
            return _ResolvedSource(source, mode, _is_sequence_pattern(source) or path.is_dir())
        return _ResolvedSource(source, mode)

    if path.is_dir():
        return _ResolvedSource(source, "sequence", True)

    if _is_sequence_pattern(source):
        return _ResolvedSource(source, "sequence", True)

    ext = path.suffix.lower()
    if ext in _VIDEO_EXTS:
        return _ResolvedSource(source, "video")
    if ext in _IMAGE_EXTS:
        return _ResolvedSource(source, "image")

    return _ResolvedSource(source, "image")


def _normalize_source(source: str) -> str:
    if not source:
        return ""
    source = os.path.expandvars(os.path.expanduser(source.strip()))
    return source


def _expand_source_with_context(source: str, context: dict | None) -> str:
    if not source or context is None:
        return source
    path = Path(source)
    if path.is_absolute():
        return source
    project_root = _project_path_from_context(context)
    if project_root:
        return str((project_root / path).resolve())
    return source


def _is_sequence_pattern(source: str) -> bool:
    name = Path(source).name
    return bool(re.search(r"%0\d+d|%d|#+", name))


def _pattern_components(name: str) -> tuple[str, re.Pattern | None]:
    token_re = re.compile(r"%0\d+d|%d|#+")
    tokens = list(token_re.finditer(name))
    if not tokens:
        return name, None
    regex_parts = []
    last = 0
    for match in tokens:
        literal = name[last : match.start()]
        regex_parts.append(re.escape(literal))
        token = match.group(0)
        if token.startswith("%0"):
            width = int(token[2:-1])
            regex_parts.append(f"(\\d{{{width}}})")
        elif token == "%d":
            regex_parts.append("(\\d+)")
        else:
            regex_parts.append(f"(\\d{{{len(token)}}})")
        last = match.end()
    regex_parts.append(re.escape(name[last:]))
    regex = re.compile(r"^" + "".join(regex_parts) + r"$")
    glob_name = token_re.sub("*", name)
    return glob_name, regex


def _iter_sequence_files(source: str):
    path = Path(source)
    if path.is_dir():
        for candidate in sorted(path.iterdir(), key=lambda p: p.name):
            if candidate.is_file() and candidate.suffix.lower() in _IMAGE_EXTS:
                yield candidate
        return

    glob_name, regex = _pattern_components(path.name)
    parent = path.parent
    if not parent.exists():
        return

    matched = []
    for candidate in parent.glob(glob_name):
        if not candidate.is_file():
            continue
        if regex is None:
            matched.append((None, candidate))
            continue
        match = regex.match(candidate.name)
        if not match:
            continue
        frame_token = match.group(1) if match.groups() else None
        frame_index = int(frame_token) if frame_token else None
        matched.append((frame_index, candidate))

    if not matched:
        return

    if any(frame is not None for frame, _ in matched):
        matched.sort(key=lambda item: (item[0] is None, item[0] or 0, item[1].name))
    else:
        matched.sort(key=lambda item: item[1].name)

    for _, candidate in matched:
        yield candidate


def _sequence_first_and_count(source: str) -> tuple[Path | None, int]:
    first_frame = None
    count = 0
    for path in _iter_sequence_files(source):
        if first_frame is None:
            first_frame = path
        count += 1
    return first_frame, count


def _select_sequence_frames(resolved: _ResolvedSource, skip_first: int, every_nth: int, max_frames: int):
    frames = []
    count = 0
    index = 0
    for path in _iter_sequence_files(resolved.path or ""):
        if index < skip_first:
            index += 1
            continue
        if (index - skip_first) % every_nth != 0:
            index += 1
            continue
        frames.append(path)
        count += 1
        if count >= max_frames:
            break
        index += 1
    return frames


def _selected_frame_count(
    total_frames: int | None, skip_first: int, every_nth: int, max_frames: int
) -> int | None:
    if total_frames is None:
        return None
    remaining = max(0, total_frames - max(0, skip_first))
    if remaining <= 0:
        return 0
    step = max(1, every_nth)
    selected = (remaining + step - 1) // step
    limit = max(0, max_frames)
    if limit:
        selected = min(selected, limit)
    return selected


def _first_selected_frame(source: str, skip_first: int, every_nth: int) -> Path | None:
    index = 0
    for path in _iter_sequence_files(source):
        if index < skip_first:
            index += 1
            continue
        if (index - skip_first) % max(1, every_nth) != 0:
            index += 1
            continue
        return path
    return None


def _load_image_tensor(path: Path, force_size: str):
    image = _open_image(path)
    if image is None:
        return _empty_output(str(path))[:2]
    target = _resolve_target_size(force_size, image.size)
    if target:
        image = image.resize(target, Image.LANCZOS)
    rgb, alpha = _image_to_arrays(image)
    return _arrays_to_tensor([rgb], [alpha])


def _load_images_tensor(paths: list[Path], force_size: str):
    images = []
    masks = []
    target = None
    for idx, path in enumerate(paths):
        image = _open_image(path)
        if image is None:
            continue
        if idx == 0:
            target = _resolve_target_size(force_size, image.size)
            if target:
                image = image.resize(target, Image.LANCZOS)
            else:
                target = image.size
        else:
            if target and image.size != target:
                image = image.resize(target, Image.LANCZOS)
        rgb, alpha = _image_to_arrays(image)
        images.append(rgb)
        masks.append(alpha)
    return _arrays_to_tensor(images, masks)


def _open_image(path: Path):
    if Image is None:
        return None
    try:
        image = Image.open(path)
        image.load()
        return image
    except Exception:
        return None


def _image_to_arrays(image: Image.Image):
    if image.mode in ("RGBA", "LA") or "transparency" in image.info:
        image = image.convert("RGBA")
        data = np.asarray(image).astype(np.float32) / 255.0
        rgb = data[..., :3]
        alpha = data[..., 3]
    else:
        image = image.convert("RGB")
        data = np.asarray(image).astype(np.float32) / 255.0
        rgb = data
        alpha = None
    return rgb, alpha


def _arrays_to_tensor(images: list[np.ndarray], masks: list[np.ndarray | None]):
    if not images:
        return _empty_output()[:2]
    images_np = np.stack(images, axis=0)
    image_tensor = torch.from_numpy(images_np)

    if any(mask is not None for mask in masks):
        mask_arrays = []
        for idx, mask in enumerate(masks):
            if mask is None:
                mask_arrays.append(np.zeros(images[idx].shape[:2], dtype=np.float32))
            else:
                mask_arrays.append(mask.astype(np.float32))
        mask_np = np.stack(mask_arrays, axis=0)
    else:
        mask_np = np.zeros((len(images), images[0].shape[0], images[0].shape[1]), dtype=np.float32)

    mask_tensor = torch.from_numpy(mask_np)
    return image_tensor, mask_tensor


def _resolve_target_size(force_size: str, size: tuple[int, int]) -> tuple[int, int] | None:
    if force_size == "Disabled":
        return None
    width, height = size
    if force_size == "512x?":
        new_width = 512
        new_height = max(1, round(height * new_width / width))
        return (new_width, new_height)
    if force_size == "1024x?":
        new_width = 1024
        new_height = max(1, round(height * new_width / width))
        return (new_width, new_height)
    if force_size == "?x512":
        new_height = 512
        new_width = max(1, round(width * new_height / height))
        return (new_width, new_height)
    return None


def _load_video_tensor(
    path: Path,
    skip_first: int,
    every_nth: int,
    max_frames: int,
    force_size: str,
):
    if iio is None:
        raise RuntimeError("imageio is required to read video files")

    images = []
    masks = []
    target = None
    count = 0
    for idx, frame in _iter_video_frames(path):
        if idx < skip_first:
            continue
        if (idx - skip_first) % every_nth != 0:
            continue
        pil_frame = Image.fromarray(frame)
        if target is None:
            target = _resolve_target_size(force_size, pil_frame.size)
            if target:
                pil_frame = pil_frame.resize(target, Image.LANCZOS)
            else:
                target = pil_frame.size
        else:
            if target and pil_frame.size != target:
                pil_frame = pil_frame.resize(target, Image.LANCZOS)
        rgb, alpha = _image_to_arrays(pil_frame)
        images.append(rgb)
        masks.append(alpha)
        count += 1
        if count >= max_frames:
            break

    return _arrays_to_tensor(images, masks)


def _iter_video_frames(path: Path):
    if hasattr(iio, "imiter"):
        for index, frame in enumerate(iio.imiter(str(path))):
            yield index, frame
        return

    reader = iio.get_reader(str(path))
    try:
        for index, frame in enumerate(reader):
            yield index, frame
    finally:
        reader.close()


def _build_change_signature(resolved: _ResolvedSource) -> str:
    if not resolved.path:
        return "empty"

    path = Path(resolved.path)
    signature_parts = [resolved.path, resolved.mode]

    if resolved.mode == "sequence":
        sample_paths = []
        if path.is_dir() or resolved.is_pattern:
            files = list(_iter_sequence_files(resolved.path))
            if files:
                sample_paths.append(files[0])
                if len(files) > 1:
                    sample_paths.append(files[-1])
            signature_parts.append(str(path))
        for sample in sample_paths:
            try:
                signature_parts.append(str(sample.stat().st_mtime))
            except Exception:
                continue
        try:
            if path.exists():
                signature_parts.append(str(path.stat().st_mtime))
        except Exception:
            pass
    else:
        try:
            signature_parts.append(str(path.stat().st_mtime))
        except Exception:
            signature_parts.append("missing")

    payload = "|".join(signature_parts)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _get_workflow_context(workflow_context: dict | None) -> dict | None:
    if workflow_context:
        return workflow_context
    if get_workflow_context is None:
        return None
    return get_workflow_context()


def _project_path_from_context(context: dict | None) -> Path | None:
    if not context:
        return None
    project_path = context.get("project_path") if isinstance(context, dict) else None
    if not project_path:
        return None
    return Path(_normalize_source(str(project_path))).expanduser()


def _project_input_from_context(context: dict | None) -> Path | None:
    project_path = _project_path_from_context(context)
    if not project_path:
        return None
    return project_path / "input"


def _allowed_roots(context: dict | None = None) -> list[Path]:
    roots = []
    if folder_paths is not None:
        try:
            roots.append(Path(folder_paths.get_input_directory()))
            roots.append(Path(folder_paths.get_output_directory()))
            roots.append(Path(folder_paths.get_temp_directory()))
        except Exception:
            pass
    project_path = _project_path_from_context(context)
    if project_path:
        roots.append(project_path)
        project_input = project_path / "input"
        roots.append(project_input)
    roots.append(Path(__file__).resolve().parent)
    return roots


def _is_safe_path(path: Path, context: dict | None = None) -> bool:
    allow_any = os.environ.get("NL_READ_ALLOW_ANY", "").strip().lower() in {"1", "true", "yes"}
    if allow_any:
        return True
    resolved = path.resolve()
    for root in _allowed_roots(context):
        try:
            root_resolved = root.resolve()
        except Exception:
            continue
        if root_resolved in resolved.parents or resolved == root_resolved:
            return True
    return False


def _ensure_safe_path(path: Path, context: dict | None) -> None:
    if not _is_safe_path(path, context):
        raise ValueError("NL Read: path is outside allowed roots.")


def _dedupe_path(path: Path) -> Path:
    if not path.exists():
        return path
    stem = path.stem
    suffix = path.suffix
    parent = path.parent
    index = 1
    while True:
        candidate = parent / f"{stem}_{index}{suffix}"
        if not candidate.exists():
            return candidate
        index += 1


def _video_stats(path: Path) -> dict:
    if not path.exists():
        return {}
    if iio is None:
        return _ffprobe_video_stats(path)
    meta = None
    try:
        if hasattr(iio, "immeta"):
            meta = iio.immeta(str(path))
        else:
            reader = iio.get_reader(str(path))
            try:
                meta = reader.get_meta_data()
            finally:
                reader.close()
    except Exception:
        return {}
    if not isinstance(meta, dict):
        return {}
    fps_value = meta.get("fps")
    if fps_value is None:
        fps_value = meta.get("frames_per_second")
    duration_value = meta.get("duration")
    frame_count = meta.get("nframes")
    if frame_count is None:
        frame_count = meta.get("n_frames")
    fps = None
    try:
        fps = float(fps_value)
        if not math.isfinite(fps) or fps <= 0:
            fps = None
    except (TypeError, ValueError):
        fps = None
    duration = None
    try:
        duration = float(duration_value)
        if not math.isfinite(duration) or duration <= 0:
            duration = None
    except (TypeError, ValueError):
        duration = None
    if frame_count is not None:
        try:
            frame_count = int(frame_count)
        except (TypeError, ValueError):
            frame_count = None
    if frame_count is None and fps is not None and duration is not None:
        frame_count = max(1, int(round(fps * duration)))
    stats = {}
    if fps is not None:
        stats["fps"] = fps
    if frame_count is not None:
        stats["frame_count"] = frame_count
    if stats:
        return stats
    return _ffprobe_video_stats(path)


def _ffprobe_video_stats(path: Path) -> dict:
    if not _ffmpeg_available():
        return {}
    cmd = [
        "ffprobe",
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=avg_frame_rate,r_frame_rate,nb_frames,duration",
        "-of",
        "json",
        str(path),
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, check=False)
    except Exception:
        return {}
    if result.returncode != 0:
        return {}
    try:
        payload = json.loads(result.stdout or "{}")
    except Exception:
        return {}
    streams = payload.get("streams") or []
    if not streams:
        return {}
    stream = streams[0] if isinstance(streams[0], dict) else {}
    fps = _parse_ffprobe_rate(stream.get("avg_frame_rate")) or _parse_ffprobe_rate(
        stream.get("r_frame_rate")
    )
    frame_count = None
    raw_frames = stream.get("nb_frames")
    if raw_frames is not None:
        try:
            frame_count = int(raw_frames)
        except (TypeError, ValueError):
            frame_count = None
    duration = None
    raw_duration = stream.get("duration")
    if raw_duration is not None:
        try:
            duration = float(raw_duration)
        except (TypeError, ValueError):
            duration = None
    if frame_count is None and fps is not None and duration is not None:
        frame_count = max(1, int(round(fps * duration)))
    stats = {}
    if fps is not None:
        stats["fps"] = fps
    if frame_count is not None:
        stats["frame_count"] = frame_count
    return stats


def _parse_ffprobe_rate(value: str | None) -> float | None:
    if not value:
        return None
    if isinstance(value, (int, float)):
        try:
            parsed = float(value)
            return parsed if math.isfinite(parsed) and parsed > 0 else None
        except (TypeError, ValueError):
            return None
    if isinstance(value, str) and "/" in value:
        parts = value.split("/", 1)
        try:
            num = float(parts[0])
            den = float(parts[1])
        except (TypeError, ValueError):
            return None
        if den == 0:
            return None
        rate = num / den
        return rate if math.isfinite(rate) and rate > 0 else None
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if math.isfinite(parsed) and parsed > 0 else None


def _resolve_preview_info(
    source: str,
    mode: str,
    context: dict | None,
    skip_first: int = 0,
    every_nth: int = 1,
    max_frames: int = 0,
):
    resolved = _resolve_source(source, mode, context)
    project_input = _project_input_from_context(context)
    has_context = project_input is not None
    if not resolved.path:
        return {
            "url": "",
            "kind": "",
            "mode": resolved.mode,
            "stats": {},
            "resolved_path": "",
            "has_context": has_context,
            "project_input": str(project_input) if project_input else "",
        }

    path = Path(resolved.path)
    if resolved.mode == "sequence":
        first_frame, frame_count = _sequence_first_and_count(resolved.path)
        if not first_frame:
            return {
                "url": "",
                "kind": "",
                "mode": resolved.mode,
                "stats": {},
                "resolved_path": resolved.path,
                "has_context": has_context,
                "project_input": str(project_input) if project_input else "",
                "blocked_reason": "No frames found in sequence.",
            }
        if not _is_safe_path(first_frame, context):
            return {
                "url": "",
                "kind": "",
                "mode": resolved.mode,
                "stats": {},
                "resolved_path": resolved.path,
                "has_context": has_context,
                "project_input": str(project_input) if project_input else "",
                "blocked_reason": _blocked_message(has_context),
            }
        selected_count = _selected_frame_count(frame_count, skip_first, every_nth, max_frames)
        stats = {"frame_count": frame_count, "selected_frames": selected_count}
        preview_params = (
            f"&skip_first={max(0, int(skip_first))}"
            f"&every_nth={max(1, int(every_nth))}"
            f"&max_frames={max(0, int(max_frames))}"
        )
        if _ffmpeg_available():
            return {
                "url": f"/nl/viewmedia?source={_quote(resolved.path)}&mode=sequence&anim=1{preview_params}",
                "kind": "video",
                "mode": resolved.mode,
                "stats": stats,
                "resolved_path": resolved.path,
                "has_context": has_context,
                "project_input": str(project_input) if project_input else "",
            }
        first_selected = _first_selected_frame(resolved.path, skip_first, every_nth) or first_frame
        if first_selected != first_frame and not _is_safe_path(first_selected, context):
            return {
                "url": "",
                "kind": "",
                "mode": resolved.mode,
                "stats": stats,
                "resolved_path": resolved.path,
                "has_context": has_context,
                "project_input": str(project_input) if project_input else "",
                "blocked_reason": _blocked_message(has_context),
            }
        return {
            "url": f"/nl/viewmedia?source={_quote(str(first_selected))}&mode=image",
            "kind": "image",
            "mode": resolved.mode,
            "stats": stats,
            "resolved_path": resolved.path,
            "has_context": has_context,
            "project_input": str(project_input) if project_input else "",
        }

    if not _is_safe_path(path, context):
        return {
            "url": "",
            "kind": "",
            "mode": resolved.mode,
            "stats": {},
            "resolved_path": resolved.path,
            "has_context": has_context,
            "project_input": str(project_input) if project_input else "",
            "blocked_reason": _blocked_message(has_context),
        }

    if resolved.mode == "video":
        stats = _video_stats(path)
        selected_count = _selected_frame_count(stats.get("frame_count"), skip_first, every_nth, max_frames)
        if selected_count is not None:
            stats["selected_frames"] = selected_count
        preview_params = (
            f"&skip_first={max(0, int(skip_first))}"
            f"&every_nth={max(1, int(every_nth))}"
            f"&max_frames={max(0, int(max_frames))}"
        )
        force_transcode = skip_first > 0 or every_nth > 1 or max_frames > 0
        if (path.suffix.lower() not in _BROWSER_VIDEO_EXTS or force_transcode) and _ffmpeg_available():
            return {
                "url": f"/nl/viewmedia?source={_quote(resolved.path)}&mode=video&transcode=1{preview_params}",
                "kind": "video",
                "mode": resolved.mode,
                "stats": stats,
                "resolved_path": resolved.path,
                "has_context": has_context,
                "project_input": str(project_input) if project_input else "",
            }

    view_url = _view_url_for_path(path)
    if view_url:
        return {
            "url": view_url,
            "kind": resolved.mode,
            "mode": resolved.mode,
            "stats": stats if resolved.mode == "video" else {},
            "resolved_path": resolved.path,
            "has_context": has_context,
            "project_input": str(project_input) if project_input else "",
        }

    return {
        "url": f"/nl/viewmedia?source={_quote(resolved.path)}&mode={resolved.mode}",
        "kind": resolved.mode,
        "mode": resolved.mode,
        "stats": stats if resolved.mode == "video" else {},
        "resolved_path": resolved.path,
        "has_context": has_context,
        "project_input": str(project_input) if project_input else "",
    }


def _blocked_message(has_context: bool) -> str:
    if has_context:
        return "Preview blocked. Use Upload Images to copy into project_path/input."
    return "Preview blocked. Use Upload Images to copy into ComfyUI input, or Apply Cache in NL Workflow."


def _view_url_for_path(path: Path) -> str | None:
    if folder_paths is None:
        return None

    mappings = {
        "input": folder_paths.get_input_directory,
        "output": folder_paths.get_output_directory,
        "temp": folder_paths.get_temp_directory,
    }

    for type_name, getter in mappings.items():
        try:
            root = Path(getter())
        except Exception:
            continue
        try:
            relative = path.resolve().relative_to(root.resolve())
        except Exception:
            continue
        filename = relative.name
        subfolder = str(relative.parent) if relative.parent.as_posix() != "." else ""
        if subfolder == ".":
            subfolder = ""
        return f"/view?filename={_quote(filename)}&subfolder={_quote(subfolder)}&type={type_name}"

    return None


def _quote(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9_.~-]", lambda m: "%{:02X}".format(ord(m.group(0))), value)


def _safe_int(value: str | None, default: int) -> int:
    if value is None:
        return default
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _ffmpeg_available() -> bool:
    return shutil.which("ffmpeg") is not None


def _preview_fps(context: dict | None, fallback: float = 25.0) -> float:
    if not context or not isinstance(context, dict):
        return fallback
    try:
        fps = float(context.get("fps", fallback))
    except (TypeError, ValueError):
        return fallback
    return fps if fps > 0 else fallback


def _build_ffconcat(sequence_paths: list[Path], fps: float) -> str:
    duration = 1.0 / fps if fps > 0 else 1.0 / 25.0
    lines = ["ffconcat version 1.0"]
    for path in sequence_paths:
        lines.append(f"file '{path.as_posix()}'")
        lines.append(f"duration {duration:.6f}")
    lines.append(f"file '{sequence_paths[-1].as_posix()}'")
    return "\n".join(lines) + "\n"


def _iter_sequence_sample(
    source: str,
    limit: int = 500,
    skip_first: int = 0,
    every_nth: int = 1,
    max_frames: int = 0,
) -> list[Path]:
    frames = []
    index = 0
    limit = max(1, int(limit))
    max_frames = max(0, int(max_frames))
    effective_limit = min(limit, max_frames) if max_frames else limit
    for path in _iter_sequence_files(source):
        if index < skip_first:
            index += 1
            continue
        if (index - skip_first) % max(1, every_nth) != 0:
            index += 1
            continue
        frames.append(path)
        if len(frames) >= effective_limit:
            break
        index += 1
    return frames


def _collect_media_entries(root: Path, collapse: bool, filter_kind: str) -> list[dict]:
    items: list[dict] = []
    if not root.exists():
        return items

    sequences = {}
    sequence_files = set()
    if collapse:
        for dirpath, _dirnames, filenames in os.walk(root):
            for filename in filenames:
                ext = Path(filename).suffix.lower()
                if ext not in _IMAGE_EXTS:
                    continue
                match = re.match(r"^(.*?)(\d+)(\.[^.]+)$", filename)
                if not match:
                    continue
                prefix, digits, suffix = match.groups()
                width = len(digits)
                key = (dirpath, prefix, suffix, width)
                sequences.setdefault(key, []).append(filename)

        for (dirpath, prefix, suffix, width), names in sequences.items():
            if len(names) < 2:
                continue
            pattern_name = f"{prefix}%0{width}d{suffix}"
            rel_path = Path(dirpath).relative_to(root) / pattern_name
            abs_path = Path(dirpath) / pattern_name
            if filter_kind in {"all", "sequences"}:
                items.append(
                    {"display": rel_path.as_posix(), "path": str(abs_path), "kind": "sequence"}
                )
            for name in names:
                sequence_files.add(Path(dirpath) / name)

    for dirpath, _dirnames, filenames in os.walk(root):
        for filename in filenames:
            path = Path(dirpath) / filename
            ext = path.suffix.lower()
            if ext in _VIDEO_EXTS:
                if filter_kind in {"all", "videos"}:
                    rel_path = path.relative_to(root)
                    items.append({"display": rel_path.as_posix(), "path": str(path), "kind": "video"})
                continue

            if ext not in _IMAGE_EXTS:
                continue

            if collapse and path in sequence_files:
                continue

            if filter_kind in {"all", "images"}:
                rel_path = path.relative_to(root)
                items.append({"display": rel_path.as_posix(), "path": str(path), "kind": "image"})

    items.sort(key=lambda item: item["display"].lower())
    return items


def _register_routes():
    global _ROUTES_REGISTERED
    if _ROUTES_REGISTERED:
        return
    if PromptServer is None or web is None:
        return
    if PromptServer.instance is None:
        return

    routes = web.RouteTableDef()

    @routes.get("/nl_read/resolve")
    async def nl_read_resolve(request):
        source = request.rel_url.query.get("source", "")
        mode = request.rel_url.query.get("mode", "auto")
        skip_first = _safe_int(request.rel_url.query.get("skip_first"), 0)
        every_nth = _safe_int(request.rel_url.query.get("every_nth"), 1)
        max_frames = _safe_int(request.rel_url.query.get("max_frames"), 0)
        context = _get_workflow_context(None)
        payload = _resolve_preview_info(source, mode, context, skip_first, every_nth, max_frames)
        return web.json_response(payload)

    @routes.get("/nl_read/list")
    async def nl_read_list(request):
        root_key = request.rel_url.query.get("root", "input")
        collapse = request.rel_url.query.get("collapse", "1") in {"1", "true", "yes"}
        filter_kind = request.rel_url.query.get("filter", "all")

        if folder_paths is None:
            return web.json_response({"items": []})

        context = _get_workflow_context(None)
        project_root = _project_path_from_context(context)
        use_project_root = project_root and root_key in {"input", "output", "temp"}
        if use_project_root:
            root = project_root / root_key
        else:
            roots = {
                "input": Path(folder_paths.get_input_directory()),
                "output": Path(folder_paths.get_output_directory()),
                "temp": Path(folder_paths.get_temp_directory()),
            }
            root = roots.get(root_key)
        if root is None:
            return web.json_response({"items": [], "has_context": bool(_project_input_from_context(context))})

        items = _collect_media_entries(root, collapse, filter_kind)
        if use_project_root:
            for item in items:
                rel = Path(item["display"])
                item["display"] = str(Path(root_key) / rel)
                item["path"] = str(Path(root_key) / rel)
        return web.json_response(
            {
                "items": items,
                "root": str(root),
                "has_context": bool(_project_input_from_context(context)),
            }
        )

    @routes.get("/nl/viewmedia")
    async def nl_view_media(request):
        source = request.rel_url.query.get("source", "")
        mode = request.rel_url.query.get("mode", "auto")
        anim = request.rel_url.query.get("anim", "0") in {"1", "true", "yes"}
        transcode = request.rel_url.query.get("transcode", "0") in {"1", "true", "yes"}
        skip_first = _safe_int(request.rel_url.query.get("skip_first"), 0)
        every_nth = _safe_int(request.rel_url.query.get("every_nth"), 1)
        max_frames = _safe_int(request.rel_url.query.get("max_frames"), 0)
        context = _get_workflow_context(None)
        resolved = _resolve_source(source, mode, context)
        if not resolved.path:
            raise web.HTTPNotFound()

        path = Path(resolved.path)
        if resolved.mode == "sequence":
            first_frame = next(_iter_sequence_files(resolved.path), None)
            if not first_frame:
                raise web.HTTPNotFound()
            if not _is_safe_path(first_frame, context):
                raise web.HTTPForbidden()
            if anim and _ffmpeg_available():
                frames = _iter_sequence_sample(
                    resolved.path,
                    limit=500,
                    skip_first=skip_first,
                    every_nth=every_nth,
                    max_frames=max_frames,
                )
                if not frames:
                    raise web.HTTPNotFound()
                concat_text = _build_ffconcat(frames, fps=_preview_fps(context))
                temp_root = None
                if folder_paths is not None:
                    try:
                        temp_root = Path(folder_paths.get_temp_directory())
                    except Exception:
                        temp_root = None
                temp_dir = temp_root or Path(tempfile.gettempdir())
                temp_dir.mkdir(parents=True, exist_ok=True)
                with tempfile.NamedTemporaryFile(
                    mode="w", suffix=".ffconcat", dir=temp_dir, delete=False
                ) as handle:
                    handle.write(concat_text)
                    concat_path = Path(handle.name)

                cmd = [
                    "ffmpeg",
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-f",
                    "concat",
                    "-safe",
                    "0",
                    "-i",
                    str(concat_path),
                    "-c:v",
                    "libx264",
                    "-preset",
                    "veryfast",
                    "-crf",
                    "26",
                    "-pix_fmt",
                    "yuv420p",
                    "-movflags",
                    "frag_keyframe+empty_moov",
                    "-f",
                    "mp4",
                    "pipe:1",
                ]

                process = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
                response = web.StreamResponse(status=200, headers={"Content-Type": "video/mp4"})
                await response.prepare(request)
                try:
                    while True:
                        chunk = process.stdout.read(64 * 1024)
                        if not chunk:
                            break
                        await response.write(chunk)
                finally:
                    if process.stdout:
                        process.stdout.close()
                    try:
                        process.wait(timeout=2)
                    except Exception:
                        process.kill()
                    try:
                        concat_path.unlink(missing_ok=True)
                    except Exception:
                        pass
                await response.write_eof()
                return response
            return web.FileResponse(path=first_frame)

        if resolved.mode == "video" and transcode and _ffmpeg_available():
            if not _is_safe_path(path, context):
                raise web.HTTPForbidden()
            if not path.exists():
                raise web.HTTPNotFound()
            vf_parts = []
            if skip_first > 0 or every_nth > 1:
                skip_expr = f"gte(n\\,{max(0, int(skip_first))})"
                step = max(1, int(every_nth))
                mod_expr = f"not(mod(n-{max(0, int(skip_first))}\\,{step}))"
                vf_parts.append(f"select='{skip_expr}*{mod_expr}'")
                vf_parts.append("setpts=N/FRAME_RATE/TB")
            cmd = [
                "ffmpeg",
                "-hide_banner",
                "-loglevel",
                "error",
                "-i",
                str(path),
                "-an",
                *(["-vf", ",".join(vf_parts)] if vf_parts else []),
                *(["-frames:v", str(max_frames)] if max_frames > 0 else []),
                "-c:v",
                "libx264",
                "-preset",
                "veryfast",
                "-crf",
                "26",
                "-pix_fmt",
                "yuv420p",
                "-movflags",
                "frag_keyframe+empty_moov",
                "-f",
                "mp4",
                "pipe:1",
            ]

            process = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
            response = web.StreamResponse(status=200, headers={"Content-Type": "video/mp4"})
            await response.prepare(request)
            try:
                while True:
                    chunk = process.stdout.read(64 * 1024)
                    if not chunk:
                        break
                    await response.write(chunk)
            finally:
                if process.stdout:
                    process.stdout.close()
                try:
                    process.wait(timeout=2)
                except Exception:
                    process.kill()
            await response.write_eof()
            return response

        if not _is_safe_path(path, context):
            raise web.HTTPForbidden()
        if not path.exists():
            raise web.HTTPNotFound()
        return web.FileResponse(path=path)

    @routes.post("/nl_read/upload")
    async def nl_read_upload(request):
        context = _get_workflow_context(None)
        target = request.rel_url.query.get("target", "project_input")
        if target == "project_input":
            target_dir = _project_input_from_context(context)
            if target_dir is None:
                raise web.HTTPBadRequest(text="Missing workflow context for project input.")
        elif target == "default_input":
            if folder_paths is None:
                raise web.HTTPBadRequest(text="ComfyUI folder_paths unavailable.")
            target_dir = Path(folder_paths.get_input_directory())
        else:
            raise web.HTTPBadRequest(text="Invalid target.")

        if not _is_safe_path(target_dir, context):
            raise web.HTTPForbidden()

        try:
            target_dir.mkdir(parents=True, exist_ok=True)
        except Exception as exc:
            raise web.HTTPBadRequest(text=f"Unable to create target dir: {exc}") from exc

        reader = await request.multipart()
        saved = []
        async for part in reader:
            if part.name != "file":
                continue
            filename = Path(part.filename or "upload.bin").name
            dest = target_dir / filename
            dest = _dedupe_path(dest)
            with dest.open("wb") as handle:
                while True:
                    chunk = await part.read_chunk()
                    if not chunk:
                        break
                    handle.write(chunk)
            saved.append(str(dest))

        return web.json_response({"saved": saved, "target_dir": str(target_dir)})

    app = PromptServer.instance.app
    app.add_routes(routes)
    api_routes = web.RouteTableDef()
    for route in routes:
        if isinstance(route, web.RouteDef):
            api_routes.route(route.method, "/api" + route.path)(route.handler, **route.kwargs)
    app.add_routes(api_routes)
    _ROUTES_REGISTERED = True


_register_routes()
