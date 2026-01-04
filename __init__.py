from .model_localizer import ModelLocalizer
from .shot_path_builder import ShotPathBuilder

NODE_CLASS_MAPPINGS = {
    "ShotPathBuilder": ShotPathBuilder,
    "ModelLocalizer": ModelLocalizer,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "ShotPathBuilder": "🎬 NL Shot Path Builder",
    "ModelLocalizer": "NL Model Manager (Network ↔ Local)",
}

WEB_DIRECTORY = "./js"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]

print("[comfyui-nlnodes] Loaded: Shot Path Builder, Model Manager")
