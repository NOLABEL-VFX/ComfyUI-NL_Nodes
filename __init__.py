from .shot_path_builder import ShotPathBuilder

NODE_CLASS_MAPPINGS = {
    "ShotPathBuilder": ShotPathBuilder,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "ShotPathBuilder": "🎬 NL Shot Path Builder",
}

WEB_DIRECTORY = "./js"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]

print("[comfyui-nlnodes] Loaded: Shot Path Builder")
