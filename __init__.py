from .model_localizer import ModelLocalizer
from .nl_read_write import NLRead, NLWrite
from .nl_workflow import NLWorkflow, NLContextDebug

NODE_CLASS_MAPPINGS = {
    "ModelLocalizer": ModelLocalizer,
    "NLRead": NLRead,
    "NLWrite": NLWrite,
    "NLWorkflow": NLWorkflow,
    "NLContextDebug": NLContextDebug,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "ModelLocalizer": "NL Model Manager (Network ↔ Local)",
    "NLRead": "📥 NL Read",
    "NLWrite": "📤 NL Write",
    "NLWorkflow": "🎬 NL Workflow",
    "NLContextDebug": "NL Context Debug",
}

WEB_DIRECTORY = "./js"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]

print("[comfyui-nlnodes] Loaded: Model Manager, NL Workflow")
