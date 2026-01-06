from .model_localizer import ModelLocalizer

NODE_CLASS_MAPPINGS = {
    "ModelLocalizer": ModelLocalizer,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "ModelLocalizer": "NL Model Manager (Network ↔ Local)",
}

WEB_DIRECTORY = "./js"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]

print("[comfyui-nlnodes] Loaded: Model Manager")
