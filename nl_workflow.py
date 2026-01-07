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
                "frame_start": ("INT", {"default": 1001}),
                "frame_end": ("INT", {"default": 1100}),
                "project_path": ("STRING", {"default": ""}),
            },
            "optional": {
                "note": ("STRING", {"default": "", "multiline": True}),
                "lock": ("BOOLEAN", {"default": False}),
                "use_env_defaults": ("BOOLEAN", {"default": True}),
            },
        }

    RETURN_TYPES = (
        "INT",
        "INT",
        "FLOAT",
        "INT",
        "STRING",
        "NL_WORKFLOW_CONTEXT",
    )
    RETURN_NAMES = (
        "width",
        "height",
        "fps",
        "frame_count",
        "project_path",
        "workflow_context",
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
        frame_start: int,
        frame_end: int,
        project_path: str,
        note: str = "",
        lock: bool = False,  # noqa: ARG002 - UI-only guard
        use_env_defaults: bool = True,
    ):
        warnings = []
        env_defaults = _env_defaults() if use_env_defaults else _EnvDefaults()

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
        frame_start = int(frame_start)
        frame_end = int(frame_end)

        if width <= 0 or height <= 0:
            warnings.append("Resolution must be positive.")
        if fps <= 0:
            warnings.append("FPS should be positive.")
        if frame_end < frame_start:
            warnings.append("Frame range end is before start.")

        frame_count = max(0, frame_end - frame_start + 1)

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
            "frame_range": (frame_start, frame_end),
            "frame_count": frame_count,
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
            frame_count,
            project_path or "",
            context,
        )


class NLContextDebug:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "optional": {
                "workflow_context": ("NL_WORKFLOW_CONTEXT",),
                "workflow_id": ("STRING", {"default": ""}),
                "use_last": ("BOOLEAN", {"default": True}),
                "print_to_console": ("BOOLEAN", {"default": True}),
            }
        }

    RETURN_TYPES = ("STRING", "NL_WORKFLOW_CONTEXT")
    RETURN_NAMES = ("context_json", "workflow_context")
    FUNCTION = "debug_context"
    CATEGORY = "NOLABEL/Workflow"
    OUTPUT_NODE = True

    def debug_context(
        self,
        workflow_context: dict | None = None,
        workflow_id: str = "",
        use_last: bool = True,
        print_to_console: bool = True,
    ):
        context = workflow_context if isinstance(workflow_context, dict) and workflow_context else None
        if context is None:
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
        return {"ui": {"context_json": [serialized]}, "result": (serialized, context or {})}


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


async def _handle_get_defaults(request):
    return web.json_response(_read_defaults())


async def _handle_set_defaults(request):
    try:
        payload = await request.json()
    except Exception:
        payload = {}
    return web.json_response(_write_defaults(payload))


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
# - Toggle "use_env_defaults" with SHOW/SHOT env vars set and confirm auto-fill.
# - Use Save/Load Defaults buttons and confirm `ComfyUI/user/defaults/nl_workflow.json` updates.
