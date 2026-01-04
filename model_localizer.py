from __future__ import annotations

import os
import threading
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


class ModelLocalizer:
    def __init__(self):
        _register_routes()

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
    variants = {rel}
    prefix = f"{category}/"
    if rel.startswith(prefix):
        trimmed = rel[len(prefix) :]
        if trimmed:
            variants.add(trimmed)
    return list(variants)


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
        return os.path.getsize(path)
    except Exception:
        return None


class _JobManager:
    def __init__(self):
        self._lock = threading.Lock()
        self._jobs: dict[str, dict] = {}
        self._executor = ThreadPoolExecutor(max_workers=1)

    def create_job(self, items: list[dict], overwrite: bool) -> str:
        job_id = str(uuid.uuid4())
        job = {
            "id": job_id,
            "state": "queued",
            "items": items,
            "overwrite": overwrite,
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

            if not network_path.exists():
                self._update(
                    job_id,
                    state="error",
                    message=f"Network file missing: {category}/{relpath}",
                )
                return

            network_size = _file_size(str(network_path))
            local_size = _file_size(str(local_path)) if local_path.exists() else None
            if local_size is not None and network_size is not None and local_size == network_size and not overwrite:
                continue

            if network_size is None:
                self._update(
                    job_id,
                    state="error",
                    message=f"Unable to read size for {category}/{relpath}",
                )
                return

            total_bytes += network_size
            to_copy.append((category, relpath, local_path, network_path, network_size))

        if not to_copy:
            self._update(job_id, state="done", bytes_total=0, message="Nothing to localize")
            return

        self._update(job_id, bytes_total=total_bytes, bytes_done=0)

        bytes_done = 0
        for category, relpath, local_path, network_path, network_size in to_copy:
            if self._is_cancelled(job_id):
                self._update(job_id, state="cancelled", message="Cancelled", current_item=None)
                return

            self._update(
                job_id,
                current_item={"category": category, "relpath": relpath},
                message=f"Copying {category}/{relpath}",
            )

            temp_path = Path(f"{local_path}.partial.{job_id}")
            try:
                os.makedirs(local_path.parent, exist_ok=True)
                with open(network_path, "rb") as src, open(temp_path, "wb") as dst:
                    while True:
                        if self._is_cancelled(job_id):
                            raise RuntimeError("Cancelled")

                        chunk = src.read(_CHUNK_SIZE)
                        if not chunk:
                            break
                        dst.write(chunk)
                        bytes_done += len(chunk)
                        self._update(job_id, bytes_done=bytes_done)
                    dst.flush()
                    os.fsync(dst.fileno())
                os.replace(temp_path, local_path)
            except Exception as exc:
                try:
                    if temp_path.exists():
                        temp_path.unlink()
                except Exception:
                    pass
                if str(exc) == "Cancelled":
                    self._update(job_id, state="cancelled", message="Cancelled", current_item=None)
                    return
                self._update(job_id, state="error", message=str(exc), current_item=None)
                return

        self._update(job_id, state="done", message="Localization complete", current_item=None)


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
                local_path = None
                network_path = None
                try:
                    if local_subdir:
                        local_path = _safe_join(local_base, local_subdir, relpath)
                    if network_subdir:
                        network_path = _safe_join(network_base, network_subdir, relpath)
                except Exception:
                    continue

                local_exists = bool(local_path and local_path.exists())
                network_exists = bool(network_path and network_path.exists())
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
                        network_exists = network_path.exists()
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
                    }
                )

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

    local_subdir = local_dirs.get(category)
    if not local_subdir:
        return web.json_response({"error": "category not configured for local models"}, status=400)

    try:
        local_path = _safe_join(local_base, local_subdir, relpath)
    except Exception as exc:
        return web.json_response({"error": str(exc)}, status=400)

    if not local_path.exists():
        return web.json_response({"error": "local file not found"}, status=404)

    try:
        local_path.unlink()
    except Exception as exc:
        return web.json_response({"error": str(exc)}, status=500)

    return web.json_response({"ok": True})


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

    @routes.get("/model_localizer/job/{job_id}")
    async def job_status(request):
        return await _job_status(request)

    @routes.post("/model_localizer/job/{job_id}/cancel")
    async def job_cancel(request):
        return await _job_cancel(request)

    @routes.post("/model_localizer/delete_local")
    async def delete_local(request):
        return await _delete_local(request)

    @routes.get("/model_localizer/list_local")
    async def list_local(request):
        return await _list_local(request)

    app = PromptServer.instance.app
    app.add_routes(routes)
    api_routes = web.RouteTableDef()
    for route in routes:
        if isinstance(route, web.RouteDef):
            api_routes.route(route.method, "/api" + route.path)(route.handler, **route.kwargs)
    app.add_routes(api_routes)
    _routes_registered = True


_register_routes()
