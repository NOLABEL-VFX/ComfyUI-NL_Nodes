from __future__ import annotations

import json
import os
import sys
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path, PurePosixPath

try:
    import yaml
except Exception:  # pragma: no cover - optional dependency in some installs
    yaml = None

try:
    from aiohttp import web
except Exception:  # pragma: no cover
    web = None

try:
    from server import PromptServer
except Exception:  # pragma: no cover
    PromptServer = None


_CHUNK_SIZE = 16 * 1024 * 1024
_USER_DATA_DIRNAME = "comfyui-nl-nodes"
_LOG_MAX_LINES = 200
_PROGRESS_LOG_INTERVAL = 2.0


def _user_data_dir() -> Path:
    if os.name == "nt":
        base = os.environ.get("LOCALAPPDATA") or os.environ.get("APPDATA")
        if not base:
            base = os.path.join(Path.home(), "AppData", "Local")
    else:
        base = os.environ.get("XDG_STATE_HOME")
        if not base:
            base = os.path.join(Path.home(), ".local", "state")
    path = Path(base) / _USER_DATA_DIRNAME
    try:
        path.mkdir(parents=True, exist_ok=True)
    except Exception:
        pass
    return path


_USAGE_PATH = _user_data_dir() / "model_localizer_usage.json"
_ACTION_LOG_PATH = _user_data_dir() / "model_localizer_actions.log"
_USAGE_DEFAULTS = {"auto_delete_enabled": False, "max_cache_bytes": 200 * 1024 ** 3}
_usage_lock = threading.Lock()
_routes_registering = False


class ModelLocalizer:
    def __init__(self):
        _ensure_routes_registered()

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {}}

    RETURN_TYPES = ()
    FUNCTION = "noop"
    CATEGORY = "NOLABEL/Utilities"

    def noop(self):
        return {}


def _human_size(num: int | None) -> str:
    if num is None:
        return "-"
    size = float(num)
    for unit in ("B", "KiB", "MiB", "GiB", "TiB"):
        if size < 1024 or unit == "TiB":
            if unit == "B":
                return f"{int(size)} {unit}"
            return f"{size:.2f} {unit}"
        size /= 1024
    return f"{size:.2f} TiB"


def _find_extra_model_paths() -> str | None:
    path = None
    try:
        import comfy.cli_args as cli_args

        if getattr(cli_args, "args", None):
            path = getattr(cli_args.args, "extra_model_paths_config", None)
    except Exception:
        path = None

    if path and os.path.isfile(path):
        return path

    fallback = os.path.join(os.getcwd(), "extra_model_paths.yaml")
    if os.path.isfile(fallback):
        return fallback

    return None


def _load_yaml(path: str) -> dict:
    if yaml is None:
        raise RuntimeError("PyYAML is not available; cannot parse extra_model_paths.yaml")

    with open(path, "r", encoding="utf-8") as handle:
        data = yaml.safe_load(handle) or {}

    if not isinstance(data, dict):
        raise ValueError("extra_model_paths.yaml does not contain a mapping")

    return data


def _first_path(value) -> str | None:
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        for item in value:
            if isinstance(item, str) and item:
                return item
    return None


def _parse_extra_model_paths() -> tuple[str, str, dict, dict]:
    path = _find_extra_model_paths()
    if not path:
        raise FileNotFoundError(
            "extra_model_paths.yaml not found. Set --extra-model-paths-config or place it next to ComfyUI."
        )

    data = _load_yaml(path)
    local_cfg = data.get("models1")
    network_cfg = data.get("models2")
    if not isinstance(local_cfg, dict) or not isinstance(network_cfg, dict):
        raise ValueError("extra_model_paths.yaml must define models1 and models2 mappings")

    local_base = _first_path(local_cfg.get("base_path"))
    network_base = _first_path(network_cfg.get("base_path"))
    if not local_base or not network_base:
        raise ValueError("models1.base_path and models2.base_path must be set")

    local_dirs = {}
    network_dirs = {}
    for key, value in local_cfg.items():
        if key == "base_path":
            continue
        path_value = _first_path(value)
        if path_value:
            local_dirs[key] = path_value
    for key, value in network_cfg.items():
        if key == "base_path":
            continue
        path_value = _first_path(value)
        if path_value:
            network_dirs[key] = path_value

    return local_base, network_base, local_dirs, network_dirs


def _normalize_relpath(relpath: str) -> str | None:
    if not isinstance(relpath, str):
        return None
    relpath = relpath.strip().replace("\\", "/")
    if not relpath:
        return None
    path = PurePosixPath(relpath)
    if path.is_absolute():
        return None
    if any(part in ("..", "") for part in path.parts):
        return None
    return str(path)

def _strip_bracket_suffix(value: str) -> str:
    if not value:
        return value
    if " [" in value and value.endswith("]"):
        return value.split(" [", 1)[0]
    return value

def _candidate_relpaths(raw: str, category: str) -> list[str]:
    raw = _strip_bracket_suffix(raw)
    rel = _normalize_relpath(raw)
    if not rel:
        return []
    exact_rel = rel
    prefix = f"{category}/"
    if rel.startswith(prefix):
        trimmed = rel[len(prefix) :]
        if trimmed:
            exact_rel = trimmed
    variants = [exact_rel]
    name_only = PurePosixPath(exact_rel).name
    if name_only and name_only != exact_rel:
        variants.append(name_only)
    return variants


_MODEL_EXTENSIONS = {".safetensors", ".ckpt", ".pt", ".pth", ".bin", ".gguf"}


def _is_allowed_model_path(path: str) -> bool:
    if not path:
        return False
    return Path(path).suffix.lower() in _MODEL_EXTENSIONS


def _is_within(path: Path, base: Path) -> bool:
    try:
        path_res = path.resolve(strict=False)
        base_res = base.resolve(strict=False)
    except Exception:
        return False
    if path_res == base_res:
        return True
    return str(path_res).startswith(str(base_res) + os.sep)


def _safe_join(base: str, subdir: str, relpath: str) -> Path:
    base_path = Path(base)
    subdir_path = Path(subdir)
    if subdir_path.is_absolute():
        full_base = subdir_path
        if not _is_within(full_base, base_path):
            raise ValueError("Subdir escapes base path")
    else:
        full_base = base_path / subdir_path
        if not _is_within(full_base, base_path):
            raise ValueError("Subdir escapes base path")
    full_path = full_base / relpath
    if not _is_within(full_path, full_base):
        raise ValueError("Path traversal detected")
    return full_path


def _category_base(base: str, subdir: str) -> Path:
    base_path = Path(base)
    subdir_path = Path(subdir)
    if subdir_path.is_absolute():
        full_base = subdir_path
        if not _is_within(full_base, base_path):
            raise ValueError("Subdir escapes base path")
    else:
        full_base = base_path / subdir_path
        if not _is_within(full_base, base_path):
            raise ValueError("Subdir escapes base path")
    return full_base


def _dir_size(path: str) -> int:
    total = 0
    for root, _, files in os.walk(path):
        for name in files:
            file_path = os.path.join(root, name)
            try:
                total += os.path.getsize(file_path)
            except Exception:
                continue
    return total


def _file_size(path: str) -> int | None:
    try:
        if not os.path.isfile(path):
            return None
        return os.path.getsize(path)
    except Exception:
        return None


def _path_exists(path: Path | None) -> bool:
    if path is None:
        return False
    try:
        return path.is_file()
    except OSError:
        return False


def _usage_key(category: str, relpath: str) -> str:
    return f"{category}/{relpath}"


def _read_usage() -> dict:
    if not _USAGE_PATH.exists():
        return {"items": {}, "settings": dict(_USAGE_DEFAULTS)}
    try:
        with open(_USAGE_PATH, "r", encoding="utf-8") as handle:
            data = json.load(handle) or {}
    except Exception:
        return {"items": {}, "settings": dict(_USAGE_DEFAULTS)}

    items = data.get("items", {})
    if not isinstance(items, dict):
        items = {}

    settings = data.get("settings", {})
    if not isinstance(settings, dict):
        settings = {}

    merged_settings = dict(_USAGE_DEFAULTS)
    for key in merged_settings:
        if key in settings:
            merged_settings[key] = settings[key]

    return {"items": items, "settings": merged_settings}


def _write_usage(data: dict) -> None:
    try:
        with open(_USAGE_PATH, "w", encoding="utf-8") as handle:
            json.dump(data, handle)
    except Exception:
        pass


def _append_action_log(entry: dict) -> None:
    try:
        line = json.dumps(entry, ensure_ascii=True)
        with open(_ACTION_LOG_PATH, "a", encoding="utf-8") as handle:
            handle.write(line + "\n")
    except Exception:
        pass


def _format_timestamp(value: object) -> str:
    try:
        return time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(float(value)))
    except Exception:
        return "unknown time"


def _format_action_entry(entry: dict) -> list[str]:
    timestamp = _format_timestamp(entry.get("timestamp"))
    action = entry.get("action") or "action"
    source = entry.get("source")
    source_text = f" ({source})" if source else ""

    if action == "localize":
        category = entry.get("category") or "unknown"
        relpath = entry.get("relpath") or "unknown"
        size = _human_size(entry.get("bytes"))
        overwrite = "yes" if entry.get("overwrite") else "no"
        return [
            f"[{timestamp}] Localize{source_text}: {category}/{relpath} ({size}, overwrite: {overwrite})"
        ]

    if action == "upload":
        category = entry.get("category") or "unknown"
        relpath = entry.get("relpath") or "unknown"
        size = _human_size(entry.get("bytes"))
        overwrite = "yes" if entry.get("overwrite") else "no"
        return [
            f"[{timestamp}] Upload{source_text}: {category}/{relpath} ({size}, overwrite: {overwrite})"
        ]

    if action == "delete_local":
        category = entry.get("category") or "unknown"
        relpath = entry.get("relpath") or "unknown"
        return [f"[{timestamp}] Delete local{source_text}: {category}/{relpath}"]

    if action == "prune":
        bytes_before = _human_size(entry.get("bytes_before"))
        bytes_after = _human_size(entry.get("bytes_after"))
        bytes_freed = _human_size(entry.get("bytes_freed"))
        removed = entry.get("removed") or []
        lines = [
            f"[{timestamp}] Prune{source_text}: freed {bytes_freed} (before {bytes_before}, after {bytes_after})",
            f"Removed items: {len(removed)}",
        ]
        for item in removed:
            category = item.get("category") or "unknown"
            relpath = item.get("relpath") or "unknown"
            size = _human_size(item.get("bytes"))
            lines.append(f"  - {category}/{relpath} ({size})")
        return lines

    return [f"[{timestamp}] {action}{source_text}: {json.dumps(entry, ensure_ascii=True)}"]


def _read_action_log() -> str:
    if not _ACTION_LOG_PATH.exists():
        return ""
    try:
        with open(_ACTION_LOG_PATH, "r", encoding="utf-8") as handle:
            lines = handle.readlines()
        if len(lines) > _LOG_MAX_LINES:
            lines = lines[-_LOG_MAX_LINES :]
        output_lines = []
        for line in lines:
            raw = line.strip()
            if not raw:
                continue
            try:
                entry = json.loads(raw)
            except Exception:
                output_lines.append(raw)
                continue
            if isinstance(entry, dict):
                output_lines.extend(_format_action_entry(entry))
            else:
                output_lines.append(raw)
        return "\n".join(output_lines)
    except Exception:
        return ""


def _log_action(action: str, details: dict) -> None:
    entry = {"timestamp": time.time(), "action": action}
    entry.update(details)
    _append_action_log(entry)


def _record_usage(items: list[dict], kind: str) -> None:
    if not items:
        return
    now = time.time()
    with _usage_lock:
        data = _read_usage()
        usage = data.setdefault("items", {})
        for item in items:
            category = item.get("category")
            relpath = item.get("relpath")
            if not category or not relpath:
                continue
            key = _usage_key(category, relpath)
            entry = usage.setdefault(key, {})
            if kind == "workflow":
                entry["workflow_hits"] = int(entry.get("workflow_hits", 0)) + 1
                entry["last_seen"] = now
            elif kind in ("localize", "upload"):
                entry["localize_hits"] = int(entry.get("localize_hits", 0)) + 1
                entry["last_localize"] = now
                entry["last_seen"] = now
        _write_usage(data)


def _usage_snapshot() -> tuple[dict, dict]:
    with _usage_lock:
        data = _read_usage()
    return data.get("items", {}), data.get("settings", dict(_USAGE_DEFAULTS))


def _remove_usage_entry(category: str, relpath: str) -> None:
    key = _usage_key(category, relpath)
    with _usage_lock:
        data = _read_usage()
        usage = data.get("items", {})
        if key in usage:
            usage.pop(key, None)
            _write_usage(data)


def _set_settings(auto_delete_enabled: bool | None, max_cache_bytes: int | None) -> dict:
    with _usage_lock:
        data = _read_usage()
        settings = data.setdefault("settings", dict(_USAGE_DEFAULTS))
        if auto_delete_enabled is not None:
            settings["auto_delete_enabled"] = bool(auto_delete_enabled)
        if max_cache_bytes is not None:
            settings["max_cache_bytes"] = max(0, int(max_cache_bytes))
        _write_usage(data)
        return settings


def _prune_cache(max_cache_bytes: int, source: str) -> dict:
    try:
        local_base, _, local_dirs, _ = _parse_extra_model_paths()
    except Exception as exc:
        return {"error": str(exc)}

    usage, _ = _usage_snapshot()
    items = []
    total_bytes = 0
    for category, local_subdir in local_dirs.items():
        try:
            local_root = _category_base(local_base, local_subdir)
        except Exception:
            continue
        if not local_root.exists():
            continue
        for root, _, files in os.walk(local_root):
            for name in files:
                if not _is_allowed_model_path(name):
                    continue
                local_path = Path(root) / name
                size = _file_size(str(local_path))
                if size is None:
                    continue
                try:
                    relpath = local_path.relative_to(local_root).as_posix()
                except Exception:
                    continue
                key = _usage_key(category, relpath)
                entry = usage.get(key, {})
                last_seen = entry.get("last_seen")
                last_localize = entry.get("last_localize")
                last_used = max(
                    last_seen if isinstance(last_seen, (int, float)) else 0,
                    last_localize if isinstance(last_localize, (int, float)) else 0,
                )
                items.append((last_used, category, relpath, local_path, size))
                total_bytes += size

    if max_cache_bytes <= 0 or total_bytes <= max_cache_bytes:
        return {"removed": [], "bytes_freed": 0, "bytes_before": total_bytes, "bytes_after": total_bytes}

    items.sort(key=lambda x: x[0])
    bytes_freed = 0
    removed = []
    for _, category, relpath, path, size in items:
        if total_bytes - bytes_freed <= max_cache_bytes:
            break
        try:
            path.unlink()
            bytes_freed += size
            removed.append({"category": category, "relpath": relpath, "bytes": size})
            _remove_usage_entry(category, relpath)
        except Exception:
            continue

    bytes_after = max(0, total_bytes - bytes_freed)
    if removed:
        _log_action(
            "prune",
            {
                "source": source,
                "max_cache_bytes": max_cache_bytes,
                "bytes_before": total_bytes,
                "bytes_after": bytes_after,
                "bytes_freed": bytes_freed,
                "removed": removed,
            },
        )
    return {
        "removed": removed,
        "bytes_freed": bytes_freed,
        "bytes_before": total_bytes,
        "bytes_after": bytes_after,
    }


class _JobManager:
    def __init__(self):
        self._lock = threading.Lock()
        self._jobs: dict[str, dict] = {}
        self._executor = ThreadPoolExecutor(max_workers=1)

    def create_job(self, items: list[dict], overwrite: bool, direction: str = "localize") -> str:
        job_id = str(uuid.uuid4())
        job = {
            "id": job_id,
            "created_at": time.time(),
            "state": "queued",
            "items": items,
            "overwrite": overwrite,
            "direction": direction,
            "bytes_done": 0,
            "bytes_total": 0,
            "current_item": None,
            "message": "Queued",
            "cancel": False,
        }
        with self._lock:
            self._jobs[job_id] = job
        self._executor.submit(self._run_job, job_id)
        return job_id

    def get_job(self, job_id: str) -> dict | None:
        with self._lock:
            job = self._jobs.get(job_id)
            return dict(job) if job else None

    def get_active_job_id(self) -> str | None:
        with self._lock:
            active = [
                job
                for job in self._jobs.values()
                if job.get("state") in ("queued", "running")
            ]
            if not active:
                return None
            active.sort(key=lambda item: item.get("created_at", 0), reverse=True)
            return active[0].get("id")

    def cancel_job(self, job_id: str) -> bool:
        with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                return False
            job["cancel"] = True
        return True

    def _update(self, job_id: str, **updates):
        with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                return
            job.update(updates)

    def _is_cancelled(self, job_id: str) -> bool:
        with self._lock:
            job = self._jobs.get(job_id)
            return bool(job and job.get("cancel"))

    def _run_job(self, job_id: str):
        print(f"[NL Model Localizer] Job {job_id} starting", flush=True)
        self._update(job_id, state="running", message="Starting")

        job = self.get_job(job_id)
        if not job:
            return

        try:
            local_base, network_base, local_dirs, network_dirs = _parse_extra_model_paths()
        except Exception as exc:
            self._update(job_id, state="error", message=str(exc))
            return

        items = job.get("items", [])
        overwrite = bool(job.get("overwrite"))
        direction = job.get("direction") or "localize"
        if direction not in ("localize", "upload"):
            self._update(job_id, state="error", message=f"Unknown job direction: {direction}")
            return

        verbing = "Copying" if direction == "localize" else "Uploading"

        to_copy = []
        total_bytes = 0
        for item in items:
            if self._is_cancelled(job_id):
                self._update(job_id, state="cancelled", message="Cancelled")
                return

            category = item.get("category")
            relpath = item.get("relpath")
            relpath = _normalize_relpath(relpath)
            if not category or not relpath:
                continue

            local_subdir = local_dirs.get(category)
            network_subdir = network_dirs.get(category)
            if not local_subdir or not network_subdir:
                continue

            try:
                local_path = _safe_join(local_base, local_subdir, relpath)
                network_path = _safe_join(network_base, network_subdir, relpath)
            except Exception:
                continue

            if direction == "localize":
                source_path = network_path
                dest_path = local_path
            else:
                source_path = local_path
                dest_path = network_path

            if not _path_exists(source_path):
                missing_label = "Network" if direction == "localize" else "Local"
                self._update(
                    job_id,
                    state="error",
                    message=f"{missing_label} file missing: {category}/{relpath}",
                )
                return

            source_size = _file_size(str(source_path))
            dest_exists = _path_exists(dest_path)
            dest_size = _file_size(str(dest_path)) if dest_exists else None
            if source_size is None:
                self._update(
                    job_id,
                    state="error",
                    message=f"Unable to read size for {category}/{relpath}",
                )
                return

            if dest_size is not None and dest_size == source_size and not overwrite:
                continue

            total_bytes += source_size
            to_copy.append((category, relpath, source_path, dest_path, source_size))

        if not to_copy:
            message = "Nothing to localize" if direction == "localize" else "Nothing to upload"
            self._update(job_id, state="done", bytes_total=0, message=message)
            print(f"[NL Model Localizer] Job {job_id} {message.lower()}", flush=True)
            return

        self._update(job_id, bytes_total=total_bytes, bytes_done=0)
        print(
            f"[NL Model Localizer] Job {job_id} queued {len(to_copy)} files ({_human_size(total_bytes)})",
            flush=True,
        )

        bytes_done = 0
        copied_items = []
        last_log_time = time.monotonic()
        last_percent = -1
        for category, relpath, source_path, dest_path, copy_size in to_copy:
            if self._is_cancelled(job_id):
                self._update(job_id, state="cancelled", message="Cancelled", current_item=None)
                print(f"[NL Model Localizer] Job {job_id} cancelled", flush=True)
                return

            self._update(
                job_id,
                current_item={"category": category, "relpath": relpath},
                message=f"{verbing} {category}/{relpath}",
            )
            print(
                f"[NL Model Localizer] Job {job_id} {verbing.lower()} {category}/{relpath} ({_human_size(copy_size)})",
                flush=True,
            )

            temp_path = Path(f"{dest_path}.partial.{job_id}")
            try:
                os.makedirs(dest_path.parent, exist_ok=True)
                with open(source_path, "rb") as src, open(temp_path, "wb") as dst:
                    while True:
                        if self._is_cancelled(job_id):
                            raise RuntimeError("Cancelled")

                        chunk = src.read(_CHUNK_SIZE)
                        if not chunk:
                            break
                        dst.write(chunk)
                        bytes_done += len(chunk)
                        self._update(job_id, bytes_done=bytes_done)
                        if total_bytes > 0:
                            percent = int((bytes_done / total_bytes) * 100)
                        else:
                            percent = 0
                        now = time.monotonic()
                        if percent != last_percent and (now - last_log_time) >= _PROGRESS_LOG_INTERVAL:
                            last_percent = percent
                            last_log_time = now
                            print(
                                f"[NL Model Localizer] Job {job_id} progress {percent}% "
                                f"({_human_size(bytes_done)} / {_human_size(total_bytes)})",
                                flush=True,
                            )
                    dst.flush()
                    os.fsync(dst.fileno())
                os.replace(temp_path, dest_path)
                _log_action(
                    "localize" if direction == "localize" else "upload",
                    {
                        "source": "manual",
                        "category": category,
                        "relpath": relpath,
                        "bytes": copy_size,
                        "overwrite": overwrite,
                    },
                )
                copied_items.append({"category": category, "relpath": relpath})
            except Exception as exc:
                try:
                    if temp_path.exists():
                        temp_path.unlink()
                except Exception:
                    pass
                if str(exc) == "Cancelled":
                    self._update(job_id, state="cancelled", message="Cancelled", current_item=None)
                    print(f"[NL Model Localizer] Job {job_id} cancelled", flush=True)
                    return
                self._update(job_id, state="error", message=str(exc), current_item=None)
                print(f"[NL Model Localizer] Job {job_id} error: {exc}", flush=True)
                return

        _record_usage(copied_items, direction)

        if direction == "localize":
            settings = _usage_snapshot()[1]
            if settings.get("auto_delete_enabled") and int(settings.get("max_cache_bytes", 0)) > 0:
                prune = _prune_cache(int(settings.get("max_cache_bytes", 0)), "auto")
                if prune.get("bytes_freed"):
                    freed = _human_size(int(prune.get("bytes_freed", 0)))
                    self._update(
                        job_id,
                        state="done",
                        message=f"Localization complete (pruned {freed})",
                        current_item=None,
                    )
                    print(
                        f"[NL Model Localizer] Job {job_id} complete (pruned {freed})",
                        flush=True,
                    )
                    return

            self._update(job_id, state="done", message="Localization complete", current_item=None)
            print(f"[NL Model Localizer] Job {job_id} complete", flush=True)
        else:
            self._update(job_id, state="done", message="Upload complete", current_item=None)
            print(f"[NL Model Localizer] Job {job_id} complete", flush=True)


_job_manager = _JobManager()
_routes_registered = False


async def _scan(request):
    try:
        payload = await request.json()
    except Exception:
        payload = {}

    candidates = payload.get("candidates", [])
    if not isinstance(candidates, list):
        return web.json_response({"error": "candidates must be a list"}, status=400)

    try:
        local_base, network_base, local_dirs, network_dirs = _parse_extra_model_paths()
    except Exception as exc:
        return web.json_response({"error": str(exc)}, status=400)

    categories = sorted(set(local_dirs) | set(network_dirs))
    items = []
    seen = set()

    for candidate in candidates:
        if not isinstance(candidate, str):
            continue

        for category in categories:
            local_subdir = local_dirs.get(category)
            network_subdir = network_dirs.get(category)
            if not local_subdir and not network_subdir:
                continue

            for relpath in _candidate_relpaths(candidate, category):
                if not _is_allowed_model_path(relpath):
                    continue
                local_path = None
                network_path = None
                try:
                    if local_subdir:
                        local_path = _safe_join(local_base, local_subdir, relpath)
                    if network_subdir:
                        network_path = _safe_join(network_base, network_subdir, relpath)
                except Exception:
                    continue

                local_exists = _path_exists(local_path)
                network_exists = _path_exists(network_path)
                if not local_exists and not network_exists:
                    continue

                key = (category, relpath)
                if key in seen:
                    continue
                seen.add(key)

                local_size = _file_size(str(local_path)) if local_exists else None
                network_size = _file_size(str(network_path)) if network_exists else None

                if local_exists and network_exists:
                    status = "different_size" if local_size != network_size else "ok"
                elif network_exists:
                    status = "missing_local"
                elif local_exists:
                    status = "missing_network"
                else:
                    status = "missing_both"

                items.append(
                    {
                        "category": category,
                        "relpath": relpath,
                        "local_path": str(local_path) if local_path else None,
                        "network_path": str(network_path) if network_path else None,
                        "local_exists": local_exists,
                        "network_exists": network_exists,
                        "local_size_bytes": local_size,
                        "network_size_bytes": network_size,
                        "status": status,
                    }
                )
                break

    _record_usage(items, "workflow")
    cache_size = _dir_size(local_base)

    return web.json_response(
        {
            "local_base": local_base,
            "network_base": network_base,
            "cache_size_bytes": cache_size,
            "cache_size_human": _human_size(cache_size),
            "items": sorted(items, key=lambda x: (x["category"], x["relpath"])),
        }
    )


async def _list_local(request):
    try:
        local_base, network_base, local_dirs, network_dirs = _parse_extra_model_paths()
    except Exception as exc:
        return web.json_response({"error": str(exc)}, status=400)

    usage, settings = _usage_snapshot()
    items = []
    for category, local_subdir in local_dirs.items():
        try:
            local_root = _category_base(local_base, local_subdir)
        except Exception:
            continue
        if not local_root.exists():
            continue

        for root, _, files in os.walk(local_root):
            for name in files:
                if not _is_allowed_model_path(name):
                    continue
                local_path = Path(root) / name
                try:
                    relpath = local_path.relative_to(local_root).as_posix()
                except Exception:
                    continue

                local_size = _file_size(str(local_path))

                network_subdir = network_dirs.get(category)
                network_path = None
                network_exists = False
                network_size = None
                if network_subdir:
                    try:
                        network_path = _safe_join(network_base, network_subdir, relpath)
                        network_exists = _path_exists(network_path)
                        network_size = _file_size(str(network_path)) if network_exists else None
                    except Exception:
                        network_exists = False

                if network_exists and local_size is not None and network_size is not None:
                    status = "different_size" if local_size != network_size else "ok"
                elif network_exists:
                    status = "ok"
                else:
                    status = "missing_network"

                items.append(
                    {
                        "category": category,
                        "relpath": relpath,
                        "local_path": str(local_path),
                        "network_path": str(network_path) if network_path else None,
                        "local_exists": True,
                        "network_exists": network_exists,
                        "local_size_bytes": local_size,
                        "network_size_bytes": network_size,
                        "status": status,
                        "usage": usage.get(_usage_key(category, relpath), {}),
                    }
                )

    cache_size = _dir_size(local_base)

    def _usage_score(item: dict) -> tuple:
        usage_data = item.get("usage") or {}
        workflow_hits = int(usage_data.get("workflow_hits", 0))
        localize_hits = int(usage_data.get("localize_hits", 0))
        last_seen = usage_data.get("last_seen")
        last_localize = usage_data.get("last_localize")
        last_used = max(
            last_seen if isinstance(last_seen, (int, float)) else 0,
            last_localize if isinstance(last_localize, (int, float)) else 0,
        )
        item["usage_score"] = workflow_hits + localize_hits
        item["last_used"] = last_used
        return (-item["usage_score"], -item["last_used"], item["category"], item["relpath"])

    return web.json_response(
        {
            "local_base": local_base,
            "network_base": network_base,
            "cache_size_bytes": cache_size,
            "cache_size_human": _human_size(cache_size),
            "items": sorted(items, key=_usage_score),
            "settings": settings,
        }
    )


async def _localize(request):
    try:
        payload = await request.json()
    except Exception:
        payload = {}

    items = payload.get("items", [])
    overwrite = bool(payload.get("overwrite", False))
    if not isinstance(items, list) or not items:
        return web.json_response({"error": "items must be a non-empty list"}, status=400)

    clean_items = []
    for item in items:
        if not isinstance(item, dict):
            continue
        category = item.get("category")
        relpath = _normalize_relpath(item.get("relpath")) if item.get("relpath") else None
        if not category or not relpath:
            continue
        clean_items.append({"category": category, "relpath": relpath})

    if not clean_items:
        return web.json_response({"error": "no valid items"}, status=400)

    job_id = _job_manager.create_job(clean_items, overwrite)
    return web.json_response({"job_id": job_id})


async def _upload(request):
    try:
        payload = await request.json()
    except Exception:
        payload = {}

    items = payload.get("items", [])
    overwrite = bool(payload.get("overwrite", False))
    if not isinstance(items, list) or not items:
        return web.json_response({"error": "items must be a non-empty list"}, status=400)

    clean_items = []
    for item in items:
        if not isinstance(item, dict):
            continue
        category = item.get("category")
        relpath = _normalize_relpath(item.get("relpath")) if item.get("relpath") else None
        if not category or not relpath:
            continue
        clean_items.append({"category": category, "relpath": relpath})

    if not clean_items:
        return web.json_response({"error": "no valid items"}, status=400)

    job_id = _job_manager.create_job(clean_items, overwrite, direction="upload")
    return web.json_response({"job_id": job_id})


async def _job_status(request):
    job_id = request.match_info.get("job_id")
    job = _job_manager.get_job(job_id) if job_id else None
    if not job:
        return web.json_response({"error": "job not found"}, status=404)

    bytes_total = job.get("bytes_total", 0) or 0
    bytes_done = job.get("bytes_done", 0) or 0
    percent = 0.0
    if bytes_total > 0:
        percent = min(100.0, (bytes_done / bytes_total) * 100.0)

    return web.json_response(
        {
            "state": job.get("state"),
            "current_item": job.get("current_item"),
            "bytes_done": bytes_done,
            "bytes_total": bytes_total,
            "percent": percent,
            "message": job.get("message", ""),
        }
    )


async def _job_active(request):
    job_id = _job_manager.get_active_job_id()
    return web.json_response({"job_id": job_id})


async def _job_cancel(request):
    job_id = request.match_info.get("job_id")
    ok = _job_manager.cancel_job(job_id) if job_id else False
    return web.json_response({"ok": ok})


async def _delete_local(request):
    try:
        payload = await request.json()
    except Exception:
        payload = {}

    category = payload.get("category")
    relpath = _normalize_relpath(payload.get("relpath")) if payload.get("relpath") else None
    if not category or not relpath:
        return web.json_response({"error": "category and relpath required"}, status=400)

    try:
        local_base, _, local_dirs, _ = _parse_extra_model_paths()
    except Exception as exc:
        return web.json_response({"error": str(exc)}, status=400)

    error, status = _delete_local_item(category, relpath, local_base, local_dirs)
    if error:
        return web.json_response({"error": error}, status=status)
    return web.json_response({"ok": True})


def _delete_local_item(
    category: str, relpath: str, local_base: str, local_dirs: dict
) -> tuple[str | None, int]:
    if not category or not relpath:
        return "category and relpath required", 400

    local_subdir = local_dirs.get(category)
    if not local_subdir:
        return "category not configured for local models", 400

    try:
        local_path = _safe_join(local_base, local_subdir, relpath)
    except Exception as exc:
        return str(exc), 400

    if not local_path.exists():
        return "local file not found", 404

    try:
        local_path.unlink()
    except Exception as exc:
        return str(exc), 500

    _log_action(
        "delete_local",
        {
            "source": "manual",
            "category": category,
            "relpath": relpath,
        },
    )
    _remove_usage_entry(category, relpath)
    return None, 200


async def _delete_local_batch(request):
    try:
        payload = await request.json()
    except Exception:
        payload = {}

    items = payload.get("items") or []
    if not isinstance(items, list) or not items:
        return web.json_response({"error": "items required"}, status=400)

    try:
        local_base, _, local_dirs, _ = _parse_extra_model_paths()
    except Exception as exc:
        return web.json_response({"error": str(exc)}, status=400)

    deleted = []
    errors = []
    for item in items:
        if not isinstance(item, dict):
            continue
        category = item.get("category")
        relpath = _normalize_relpath(item.get("relpath")) if item.get("relpath") else None
        error, status = _delete_local_item(category, relpath, local_base, local_dirs)
        if error:
            errors.append({"category": category, "relpath": relpath, "error": error, "status": status})
        else:
            deleted.append({"category": category, "relpath": relpath})

    return web.json_response({"deleted": deleted, "errors": errors})


async def _get_settings(request):
    _, settings = _usage_snapshot()
    return web.json_response(settings)


async def _set_settings_api(request):
    try:
        payload = await request.json()
    except Exception:
        payload = {}

    auto_delete_enabled = payload.get("auto_delete_enabled")
    max_cache_bytes = payload.get("max_cache_bytes")
    settings = _set_settings(auto_delete_enabled, max_cache_bytes)
    return web.json_response(settings)


async def _prune(request):
    try:
        payload = await request.json()
    except Exception:
        payload = {}

    max_cache_bytes = payload.get("max_cache_bytes")
    if max_cache_bytes is None:
        _, settings = _usage_snapshot()
        max_cache_bytes = settings.get("max_cache_bytes", 0)
    try:
        max_cache_bytes = int(max_cache_bytes)
    except Exception:
        max_cache_bytes = 0

    result = _prune_cache(max_cache_bytes, "manual")
    if result.get("error"):
        return web.json_response({"error": result["error"]}, status=400)
    return web.json_response(result)


async def _get_action_log(request):
    return web.json_response({"text": _read_action_log()})


def _register_routes():
    global _routes_registered
    if _routes_registered:
        return
    if PromptServer is None or web is None:
        return
    if PromptServer.instance is None:
        return

    routes = web.RouteTableDef()

    @routes.post("/model_localizer/scan")
    async def scan(request):
        return await _scan(request)

    @routes.post("/model_localizer/localize")
    async def localize(request):
        return await _localize(request)

    @routes.post("/model_localizer/upload")
    async def upload(request):
        return await _upload(request)

    @routes.get("/model_localizer/job/{job_id}")
    async def job_status(request):
        return await _job_status(request)

    @routes.get("/model_localizer/job")
    async def job_active(request):
        return await _job_active(request)

    @routes.post("/model_localizer/job/{job_id}/cancel")
    async def job_cancel(request):
        return await _job_cancel(request)

    @routes.post("/model_localizer/delete_local")
    async def delete_local(request):
        return await _delete_local(request)

    @routes.post("/model_localizer/delete_local_batch")
    async def delete_local_batch(request):
        return await _delete_local_batch(request)

    @routes.get("/model_localizer/list_local")
    async def list_local(request):
        return await _list_local(request)

    @routes.get("/model_localizer/settings")
    async def get_settings(request):
        return await _get_settings(request)

    @routes.post("/model_localizer/settings")
    async def set_settings(request):
        return await _set_settings_api(request)

    @routes.post("/model_localizer/prune")
    async def prune(request):
        return await _prune(request)

    @routes.get("/model_localizer/prune_log")
    async def prune_log(request):
        return await _get_action_log(request)

    @routes.get("/model_localizer/log")
    async def action_log(request):
        return await _get_action_log(request)

    app = PromptServer.instance.app
    app.add_routes(routes)
    api_routes = web.RouteTableDef()
    for route in routes:
        if isinstance(route, web.RouteDef):
            api_routes.route(route.method, "/api" + route.path)(route.handler, **route.kwargs)
    app.add_routes(api_routes)
    _routes_registered = True


def _ensure_routes_registered():
    if _routes_registered:
        return
    if PromptServer is None or web is None:
        return
    if PromptServer.instance is None:
        _schedule_route_registration()
        return
    _register_routes()


def _schedule_route_registration():
    global _routes_registering
    if _routes_registering:
        return
    _routes_registering = True

    def _wait_for_server():
        global _routes_registering
        while True:
            if PromptServer is None or web is None:
                break
            if PromptServer.instance is not None:
                _register_routes()
                break
            time.sleep(0.1)
        _routes_registering = False

    thread = threading.Thread(target=_wait_for_server, daemon=True)
    thread.start()


_ensure_routes_registered()
