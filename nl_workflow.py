from __future__ import annotations

import json
import os
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
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


_ROUTES_REGISTERED = False
_DEFAULTS_FILENAME = "nl_workflow.json"
_DEFAULTS_SUBDIR = "defaults"
_HISTORY_FILENAME = "nl_workflow_history.json"
_HISTORY_LIMIT = 12
_WORKFLOW_CONTEXT_CACHE: dict[str, dict] = {}
_LAST_WORKFLOW_ID: str | None = None


@dataclass(frozen=True)
class _EnvDefaults:
    project: str | None = None
    episode: str | None = None
    scene: str | None = None
    shot: str | None = None


class NLWorkflow:
    def __init__(self):
        _register_routes()

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "project": ("STRING", {"default": ""}),
                "episode": ("STRING", {"default": ""}),
                "scene": ("STRING", {"default": ""}),
                "shot": ("STRING", {"default": ""}),
                "width": ("INT", {"default": 1920, "min": 1, "max": 16384}),
                "height": ("INT", {"default": 1080, "min": 1, "max": 16384}),
                "fps": ("FLOAT", {"default": 24.0, "min": 0.1, "max": 240.0}),
                "project_path": ("STRING", {"default": ""}),
            },
            "optional": {
                "note": ("STRING", {"default": "", "multiline": True}),
                "lock": ("BOOLEAN", {"default": False}),
            },
        }

    RETURN_TYPES = (
        "INT",
        "INT",
        "FLOAT",
        "STRING",
    )
    RETURN_NAMES = (
        "width",
        "height",
        "fps",
        "project_path",
    )
    FUNCTION = "build_context"
    CATEGORY = "NOLABEL/Workflow"
    OUTPUT_NODE = True

    def build_context(
        self,
        project: str,
        episode: str,
        scene: str,
        shot: str,
        width: int,
        height: int,
        fps: float,
        project_path: str,
        note: str = "",
        lock: bool = False,  # noqa: ARG002 - UI-only guard
    ):
        warnings = []
        env_defaults = _env_defaults()

        project = _coalesce_text(project, env_defaults.project)
        episode = _coalesce_text(episode, env_defaults.episode)
        scene = _coalesce_text(scene, env_defaults.scene)
        shot = _coalesce_text(shot, env_defaults.shot)

        if not project:
            warnings.append("Project is empty.")
        if not scene:
            warnings.append("Scene is empty.")
        if not shot:
            warnings.append("Shot is empty.")
        if not project_path:
            warnings.append("Project path is empty.")

        shot_sanitized = _sanitize_identifier(shot)
        if shot and shot_sanitized != shot:
            warnings.append("Shot contained illegal characters and was sanitized.")
        shot = shot_sanitized

        project_path_sanitized = _sanitize_path(project_path)
        if project_path and project_path_sanitized != project_path:
            warnings.append("Project path contained illegal characters and was sanitized.")
        project_path = project_path_sanitized

        width = int(width)
        height = int(height)
        fps = float(fps)

        if width <= 0 or height <= 0:
            warnings.append("Resolution must be positive.")
        if fps <= 0:
            warnings.append("FPS should be positive.")

        context = {
            "workflow_id": str(uuid.uuid4()),
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "generated_at_epoch": time.time(),
            "project": project or None,
            "episode": episode or None,
            "scene": scene or None,
            "shot": shot or None,
            "resolution": (width, height),
            "fps": fps,
            "project_path": project_path or None,
            "note": note or None,
            "warnings": warnings,
        }

        _cache_context(context)
        _emit_warnings(warnings)

        return (
            width,
            height,
            fps,
            project_path or "",
        )


class NLContextDebug:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "optional": {
                "workflow_id": ("STRING", {"default": ""}),
                "use_last": ("BOOLEAN", {"default": True}),
                "print_to_console": ("BOOLEAN", {"default": True}),
            }
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("context_json",)
    FUNCTION = "debug_context"
    CATEGORY = "NOLABEL/Workflow"
    OUTPUT_NODE = True

    def debug_context(
        self,
        workflow_id: str = "",
        use_last: bool = True,
        print_to_console: bool = True,
    ):
        lookup_id = workflow_id.strip() if workflow_id else None
        context = get_workflow_context(lookup_id if lookup_id or not use_last else None)
        if context is None:
            payload = {"error": "No workflow context found."}
        else:
            payload = dict(context)
        try:
            serialized = json.dumps(payload, indent=2, sort_keys=True)
        except Exception:
            serialized = json.dumps({"error": "Failed to serialize context."})
        if print_to_console:
            print(f"[comfyui-nlnodes] NL Context Debug:\n{serialized}")
        return {"ui": {"context_json": [serialized]}, "result": (serialized,)}


class NLWorkflowResolution:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {}}

    RETURN_TYPES = ("INT", "INT")
    RETURN_NAMES = ("width", "height")
    FUNCTION = "get_resolution"
    CATEGORY = "NOLABEL/Workflow"

    @classmethod
    def IS_CHANGED(cls):
        context = get_workflow_context()
        if not isinstance(context, dict):
            return "no-context"
        return f"{context.get('workflow_id')}:{context.get('generated_at_epoch')}"

    def get_resolution(self):
        context = get_workflow_context()
        width = 0
        height = 0
        if isinstance(context, dict):
            resolution = context.get("resolution")
            if isinstance(resolution, (list, tuple)) and len(resolution) >= 2:
                width = int(resolution[0]) if resolution[0] is not None else 0
                height = int(resolution[1]) if resolution[1] is not None else 0
        return width, height


class NLWorkflowFPS:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {}}

    RETURN_TYPES = ("FLOAT",)
    RETURN_NAMES = ("fps",)
    FUNCTION = "get_fps"
    CATEGORY = "NOLABEL/Workflow"

    @classmethod
    def IS_CHANGED(cls):
        context = get_workflow_context()
        if not isinstance(context, dict):
            return "no-context"
        return f"{context.get('workflow_id')}:{context.get('generated_at_epoch')}"

    def get_fps(self):
        context = get_workflow_context()
        fps = 0.0
        if isinstance(context, dict):
            try:
                fps = float(context.get("fps", 0.0))
            except Exception:
                fps = 0.0
        return (fps,)


class NLWorkflowProjectPath:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {}}

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("project_path",)
    FUNCTION = "get_project_path"
    CATEGORY = "NOLABEL/Workflow"

    @classmethod
    def IS_CHANGED(cls):
        context = get_workflow_context()
        if not isinstance(context, dict):
            return "no-context"
        return f"{context.get('workflow_id')}:{context.get('generated_at_epoch')}"

    def get_project_path(self):
        context = get_workflow_context()
        project_path = ""
        if isinstance(context, dict):
            project_path = context.get("project_path") or ""
        return (str(project_path),)


def _coalesce_text(value: str | None, fallback: str | None) -> str:
    if value and value.strip():
        return value.strip()
    if fallback and fallback.strip():
        return fallback.strip()
    return ""


def _env_defaults() -> _EnvDefaults:
    return _EnvDefaults(
        project=os.environ.get("SHOW") or os.environ.get("PROJECT"),
        episode=os.environ.get("EPISODE") or os.environ.get("EP"),
        scene=os.environ.get("SCENE") or os.environ.get("SEQ"),
        shot=os.environ.get("SHOT"),
    )


def _sanitize_identifier(value: str) -> str:
    if not value:
        return value
    safe = []
    for char in value:
        if char.isalnum() or char in ("_", "-", "."):
            safe.append(char)
        else:
            safe.append("_")
    return "".join(safe)


_INVALID_PATH_CHARS = set('<>:"|?*')


def _sanitize_path(path_value: str) -> str:
    if not path_value:
        return path_value
    normalized = path_value.replace("\\", "/")
    drive, rest = os.path.splitdrive(normalized)
    prefix = ""
    if rest.startswith("/"):
        prefix = "/"
    parts = [part for part in rest.split("/") if part]
    sanitized_parts = []
    for part in parts:
        sanitized = []
        for char in part:
            if char in _INVALID_PATH_CHARS:
                sanitized.append("_")
            else:
                sanitized.append(char)
        sanitized_parts.append("".join(sanitized))
    sanitized_path = "/".join(sanitized_parts)
    return f"{drive}{prefix}{sanitized_path}"


def _defaults_path() -> Path:
    if folder_paths is not None:
        base = Path(folder_paths.get_user_directory())
    else:
        base = Path(os.getcwd()) / "user"
    path = base / _DEFAULTS_SUBDIR
    path.mkdir(parents=True, exist_ok=True)
    return path / _DEFAULTS_FILENAME


def _history_path() -> Path:
    if folder_paths is not None:
        base = Path(folder_paths.get_user_directory())
    else:
        base = Path(os.getcwd()) / "user"
    path = base / _DEFAULTS_SUBDIR
    path.mkdir(parents=True, exist_ok=True)
    return path / _HISTORY_FILENAME


def _read_history() -> dict:
    path = _history_path()
    if not path.exists():
        return {"ok": True, "data": [], "path": str(path)}
    try:
        with path.open("r", encoding="utf-8") as handle:
            data = json.load(handle)
    except Exception as exc:  # pragma: no cover - IO guard
        return {"ok": False, "error": str(exc), "path": str(path)}
    if not isinstance(data, list):
        data = []
    return {"ok": True, "data": data, "path": str(path)}


def _write_history(items: list[dict]) -> dict:
    path = _history_path()
    try:
        with path.open("w", encoding="utf-8") as handle:
            json.dump(items, handle, indent=2, sort_keys=True)
    except Exception as exc:  # pragma: no cover - IO guard
        return {"ok": False, "error": str(exc), "path": str(path)}
    return {"ok": True, "path": str(path)}


def _history_entry_from_context(context: dict) -> dict:
    return {
        "id": str(uuid.uuid4()),
        "saved_at": datetime.now(timezone.utc).isoformat(),
        "saved_at_epoch": time.time(),
        "project": context.get("project"),
        "episode": context.get("episode"),
        "scene": context.get("scene"),
        "shot": context.get("shot"),
        "resolution": context.get("resolution"),
        "fps": context.get("fps"),
        "project_path": context.get("project_path"),
        "note": context.get("note"),
    }


def _history_signature(entry: dict) -> tuple:
    return (
        entry.get("project"),
        entry.get("episode"),
        entry.get("scene"),
        entry.get("shot"),
        entry.get("project_path"),
        tuple(entry.get("resolution") or ()),
        entry.get("fps"),
    )


def _append_history_from_context(context: dict) -> None:
    if not isinstance(context, dict):
        return
    entry = _history_entry_from_context(context)
    snapshot = _read_history()
    items = snapshot.get("data") if snapshot.get("ok") else []
    if not isinstance(items, list):
        items = []
    signature = _history_signature(entry)
    deduped = []
    for item in items:
        if not isinstance(item, dict):
            continue
        if _history_signature(item) == signature:
            continue
        deduped.append(item)
    deduped.insert(0, entry)
    deduped = deduped[:_HISTORY_LIMIT]
    _write_history(deduped)


def _delete_history_entry(entry_id: str) -> dict:
    snapshot = _read_history()
    if not snapshot.get("ok"):
        return snapshot
    items = snapshot.get("data") or []
    if not isinstance(items, list):
        items = []
    filtered = [item for item in items if isinstance(item, dict) and item.get("id") != entry_id]
    return _write_history(filtered)


def _clear_history() -> dict:
    return _write_history([])


def _write_defaults(payload: dict) -> dict:
    path = _defaults_path()
    try:
        with path.open("w", encoding="utf-8") as handle:
            json.dump(payload, handle, indent=2, sort_keys=True)
    except Exception as exc:  # pragma: no cover - IO guard
        return {"ok": False, "error": str(exc)}
    return {"ok": True, "path": str(path)}


def _read_defaults() -> dict:
    path = _defaults_path()
    if not path.exists():
        return {"ok": True, "data": {}, "path": str(path)}
    try:
        with path.open("r", encoding="utf-8") as handle:
            data = json.load(handle)
    except Exception as exc:  # pragma: no cover - IO guard
        return {"ok": False, "error": str(exc), "path": str(path)}
    return {"ok": True, "data": data or {}, "path": str(path)}


def _clear_cache() -> None:
    global _WORKFLOW_CONTEXT_CACHE, _LAST_WORKFLOW_ID
    _WORKFLOW_CONTEXT_CACHE = {}
    _LAST_WORKFLOW_ID = None


def _reset_defaults() -> dict:
    path = _defaults_path()
    try:
        if path.exists():
            path.unlink()
    except Exception as exc:  # pragma: no cover - IO guard
        return {"ok": False, "error": str(exc), "path": str(path)}
    return {"ok": True, "path": str(path)}


def _emit_warnings(warnings: list[str]) -> None:
    if not warnings:
        return
    for warning in warnings:
        print(f"[comfyui-nlnodes] NL Workflow warning: {warning}")


def _cache_context(context: dict) -> None:
    global _LAST_WORKFLOW_ID
    workflow_id = context.get("workflow_id")
    if not isinstance(workflow_id, str) or not workflow_id:
        return
    _WORKFLOW_CONTEXT_CACHE[workflow_id] = dict(context)
    _LAST_WORKFLOW_ID = workflow_id


def get_workflow_context(workflow_id: str | None = None) -> dict | None:
    if workflow_id:
        return _WORKFLOW_CONTEXT_CACHE.get(workflow_id)
    if _LAST_WORKFLOW_ID:
        return _WORKFLOW_CONTEXT_CACHE.get(_LAST_WORKFLOW_ID)
    return None


def _build_cache_context(payload: dict) -> dict:
    warnings = []
    project = _coalesce_text(payload.get("project", ""), None)
    episode = _coalesce_text(payload.get("episode", ""), None)
    scene = _coalesce_text(payload.get("scene", ""), None)
    shot = _coalesce_text(payload.get("shot", ""), None)
    project_path = _sanitize_path(_coalesce_text(payload.get("project_path", ""), None))

    if not project_path:
        warnings.append("Project path is empty.")

    width = _safe_int(payload.get("width"), 0)
    height = _safe_int(payload.get("height"), 0)
    fps = _safe_float(payload.get("fps"), 0.0)
    if width <= 0 or height <= 0:
        warnings.append("Resolution must be positive.")
    if fps <= 0:
        warnings.append("FPS should be positive.")

    return {
        "workflow_id": str(uuid.uuid4()),
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "generated_at_epoch": time.time(),
        "project": project or None,
        "episode": episode or None,
        "scene": scene or None,
        "shot": shot or None,
        "resolution": (width, height),
        "fps": fps,
        "project_path": project_path or None,
        "note": payload.get("note"),
        "warnings": warnings,
    }


def _safe_int(value, default: int) -> int:
    try:
        return int(value)
    except Exception:
        return default


def _safe_float(value, default: float) -> float:
    try:
        return float(value)
    except Exception:
        return default


def populate_cache_from_payload(payload: dict) -> dict:
    if not isinstance(payload, dict):
        return {"ok": False, "error": "Invalid payload."}
    context = _build_cache_context(payload)
    if not context.get("project_path"):
        return {"ok": False, "error": "Project path is empty."}
    _cache_context(context)
    _emit_warnings(context.get("warnings") or [])
    return {"ok": True, "context": context}


async def _handle_get_defaults(request):
    return web.json_response(_read_defaults())


async def _handle_set_defaults(request):
    try:
        payload = await request.json()
    except Exception:
        payload = {}
    return web.json_response(_write_defaults(payload))


async def _handle_reset_defaults(request):
    _clear_cache()
    return web.json_response(_reset_defaults())


async def _handle_clear_cache(request):
    _clear_cache()
    return web.json_response({"ok": True})


async def _handle_get_history(request):
    return web.json_response(_read_history())


async def _handle_delete_history(request):
    try:
        payload = await request.json()
    except Exception:
        payload = {}
    entry_id = str(payload.get("id") or "")
    if not entry_id:
        return web.json_response({"ok": False, "error": "Missing id."}, status=400)
    result = _delete_history_entry(entry_id)
    status = 200 if result.get("ok") else 400
    return web.json_response(result, status=status)


async def _handle_clear_history(request):
    result = _clear_history()
    status = 200 if result.get("ok") else 400
    return web.json_response(result, status=status)


async def _handle_commit_history(request):
    try:
        payload = await request.json()
    except Exception:
        payload = {}
    if not isinstance(payload, dict):
        payload = {}
    context = _build_cache_context(payload)
    if not context.get("project_path"):
        return web.json_response({"ok": False, "error": "Project path is empty."}, status=400)
    _append_history_from_context(context)
    return web.json_response({"ok": True})

def _register_routes():
    global _ROUTES_REGISTERED
    if _ROUTES_REGISTERED:
        return
    if PromptServer is None or web is None:
        return
    if PromptServer.instance is None:
        return

    routes = web.RouteTableDef()

    @routes.get("/nl_workflow/defaults")
    async def get_defaults(request):
        return await _handle_get_defaults(request)

    @routes.post("/nl_workflow/defaults")
    async def set_defaults(request):
        return await _handle_set_defaults(request)

    @routes.get("/nl_workflow/history")
    async def get_history(request):
        return await _handle_get_history(request)

    @routes.post("/nl_workflow/history/delete")
    async def delete_history(request):
        return await _handle_delete_history(request)

    @routes.post("/nl_workflow/history/clear")
    async def clear_history(request):
        return await _handle_clear_history(request)

    @routes.post("/nl_workflow/history/commit")
    async def commit_history(request):
        return await _handle_commit_history(request)

    @routes.post("/nl_workflow/reset")
    async def reset_defaults(request):
        return await _handle_reset_defaults(request)

    @routes.post("/nl_workflow/clear_cache")
    async def clear_cache(request):
        return await _handle_clear_cache(request)

    @routes.post("/nl_workflow/populate_cache")
    async def populate_cache(request):
        try:
            payload = await request.json()
        except Exception:
            payload = {}
        return web.json_response(populate_cache_from_payload(payload))

    app = PromptServer.instance.app
    app.add_routes(routes)
    api_routes = web.RouteTableDef()
    for route in routes:
        if isinstance(route, web.RouteDef):
            api_routes.route(route.method, "/api" + route.path)(route.handler, **route.kwargs)
    app.add_routes(api_routes)
    _ROUTES_REGISTERED = True


_register_routes()

# Manual test checklist:
# - Set identifiers/timing/output, run the node, and confirm outputs match inputs.
# - Set SHOW/SHOT env vars and confirm auto-fill.
# - Use Save/Load Defaults buttons and confirm `ComfyUI/user/defaults/nl_workflow.json` updates.
