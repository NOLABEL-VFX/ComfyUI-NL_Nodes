from __future__ import annotations

import re
import unicodedata
from pathlib import PurePosixPath


_ILLEGAL_CHARS = set('<>:"|?*')
_CONTROL_RE = re.compile(r"[\x00-\x1f\x7f]")


def _format_version(version_int: int, version_format: str, pad: int) -> str:
    vf = (version_format or "").strip()
    if vf:
        try:
            return vf.format(int(version_int))  # e.g. "v{:03d}"
        except Exception:
            pass
        try:
            return vf % int(version_int)        # e.g. "v%03d"
        except Exception:
            pass
    return f"v{int(version_int):0{int(pad)}d}"


def _sanitize_component(s: str) -> str:
    s = unicodedata.normalize("NFKC", str(s))
    s = _CONTROL_RE.sub("", s).strip()

    if s in (".", ".."):
        return "_"

    # Always replace whitespace with underscore when sanitizing
    s = re.sub(r"\s+", "_", s)

    s = "".join(ch for ch in s if ch not in _ILLEGAL_CHARS)
    s = re.sub(r"_+", "_", s)
    s = s.strip("._ ")

    return s or "_"


def _sanitize_path(path: str) -> str:
    path = str(path).replace("\\", "/")
    parts = [p for p in path.split("/") if p not in ("", None)]
    clean = [_sanitize_component(p) for p in parts]
    return str(PurePosixPath(*clean)) if clean else "_"


def _posix_join(*parts: str) -> str:
    clean = [p for p in parts if p not in ("", None)]
    return str(PurePosixPath(*clean)) if clean else ""


class ShotPathBuilder:
    """
    Outputs:
      standard_path = {shot}/{version_str}/{file_name}
      png_path      = {shot}/{version_str}/{png_folder}/{file_name}
      file_name     = {base}{delim}{version_str}[{delim}{tag}]
    """

    @classmethod
    def INPUT_TYPES(cls):
        default_shot = "PFX_101_010_0010_SUBJECT_1001-1081"
        return {
            "required": {
                "shot_folder": ("STRING", {
                    "default": default_shot,
                    "tooltip": "Shot folder (e.g. PFX_101_..._1001-1081). Can include subfolders."
                }),
                "base_name": ("STRING", {
                    "default": default_shot,
                    "tooltip": "Base filename without version/tag. If empty, uses last path component of shot_folder."
                }),
                "version_format": ("STRING", {
                    "default": "v{:03d}",
                    "tooltip": "Python format or printf format. Examples: v{:03d} or v%03d."
                }),
                "name_delim": ("STRING", {
                    "default": "_",
                    "tooltip": "Delimiter used in file_name between base/version/tag."
                }),
                "png_folder": ("STRING", {
                    "default": "PNG",
                    "tooltip": "Subfolder name under {shot}/{version_str} for PNG outputs."
                }),
                "sanitize": ("BOOLEAN", {
                    "default": True,
                    "tooltip": "Sanitize path components (spaces→_, illegal chars removed)."
                }),
                "tag": ("STRING", {
                    "default": "",
                    "tooltip": "Optional suffix appended to file_name (after delimiter)."
                }),
                "version_int": ("INT", {
                    "default": 1,
                    "min": 0,
                    "max": 9999,
                    "tooltip": "Version number used to build version_str and folders."
                }),
            },
        }




    RETURN_TYPES = (
        "STRING", "STRING",  # standard_path, png_path
        "STRING",            # file_name
        "STRING",            # version_str
        "STRING", "STRING",  # folder_standard, folder_png
    )

    RETURN_NAMES = (
        "standard_path", "png_path",
        "file_name",
        "version_str",
        "folder_standard", "folder_png",
    )

    FUNCTION = "build"
    CATEGORY = "NOLABEL/Paths"

    def build(
        self,
        shot_folder: str,
        base_name: str,
        version_int: int,
        version_format: str,
        name_delim: str,
        png_folder: str,
        sanitize: bool,
        tag: str,
    ):
        shot = shot_folder
        base = (base_name or "").strip()
        if not base:
            shot_norm = shot.replace("\\", "/")
            base = shot_norm.split("/")[-1].strip() or "SHOT"

        delim = (name_delim or "_").strip() or "_"
        tag = (tag or "").strip()

        version_str = _format_version(int(version_int), version_format, pad=3)

        if sanitize:
            shot = _sanitize_path(shot)
            base = _sanitize_component(base)
            version_str = _sanitize_component(version_str)
            png_folder = _sanitize_component(png_folder)
            if tag:
                tag = _sanitize_component(tag)

        file_name = f"{base}{delim}{version_str}" + (f"{delim}{tag}" if tag else "")

        folder_standard_raw = _posix_join(shot, version_str)
        folder_png_raw = _posix_join(shot, version_str, png_folder)

        standard_path = _posix_join(folder_standard_raw, file_name)
        png_path = _posix_join(folder_png_raw, file_name)

        # trailing slash, as requested
        folder_standard = folder_standard_raw + "/"
        folder_png = folder_png_raw + "/"

        return (
            standard_path, png_path,
            file_name,
            version_str,
            folder_standard, folder_png,
        )

