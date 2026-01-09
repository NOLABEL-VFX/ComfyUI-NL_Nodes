from . import model_localizer as _model_localizer  # ensure routes register for top-bar UI
from .nl_read_write import NLRead, NLWrite
from .nl_workflow import NLContextDebug, NLWorkflowResolution, NLWorkflowFPS, NLWorkflowProjectPath

NODE_CLASS_MAPPINGS = {
    "NLRead": NLRead,
    "NLWrite": NLWrite,
    "NLContextDebug": NLContextDebug,
    "NLWorkflowResolution": NLWorkflowResolution,
    "NLWorkflowFPS": NLWorkflowFPS,
    "NLWorkflowProjectPath": NLWorkflowProjectPath,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "NLRead": "📥 NL Read",
    "NLWrite": "📤 NL Write",
    "NLContextDebug": "NL Context Debug",
    "NLWorkflowResolution": "📐 NL Resolution",
    "NLWorkflowFPS": "🎞️ NL FPS",
    "NLWorkflowProjectPath": "📁 NL Project Path",
}

WEB_DIRECTORY = "./js"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]

print("[comfyui-nlnodes] Loaded: Model Manager, NL Workflow")
