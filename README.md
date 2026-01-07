# ComfyUI-NL_Nodes

Custom nodes for ComfyUI maintained by NOLABEL (initially by Wojciech Czub). The pack focuses on streamlining studio workflows so artists can share consistent utilities.

## Installation
- Go to your `ComfyUI/custom_nodes` directory and clone or copy this repository into `ComfyUI-NL_Nodes`.
- Restart ComfyUI. You will find the node under `NOLABEL/Utilities` as "NL Model Manager (Network ↔ Local)".

## NL Workflow
Provides a single source of workflow metadata (show/shot, resolution, timing, project paths) for studio pipelines. The node emits individual outputs plus a combined `workflow_context` dict for downstream nodes. It lives under `NOLABEL/Workflow` as "NL Workflow".

### Notes
- Includes a lock toggle and save/load defaults buttons.
- Defaults are stored in `ComfyUI/user/defaults/nl_workflow.json`.

## NL Context Debug
Utility node for testing. Reads the cached workflow context (by workflow ID or last run) and outputs a JSON string plus the raw context dict.

## NL Model Manager (Network ↔ Local)
Manages model files referenced by the current workflow or the entire local cache, including copy actions from a network models root to a local cache. The node renders a table with status, size, and actions, and includes “Localize All” plus progress with cancel support.

### How it decides local vs network
- Reads `extra_model_paths.yaml` via `comfy.cli_args.args.extra_model_paths_config` when available, otherwise falls back to `./extra_model_paths.yaml` in the ComfyUI working directory.
- Uses `models1` as the local cache root and `models2` as the network root, mapping categories exactly as defined in the YAML.

### Safety constraints
- Only copies within category subfolders defined in the YAML.
- Rejects path traversal and absolute paths.
- Copies via a temp file (`.partial.<job_id>`) then atomically renames.

### Limitations / performance notes
- The UI only lists candidates it sees in the current workflow widgets and confirms by existence on disk; it does not crawl all models.
- If the network mount is unavailable, files that exist only on the network will not appear until the mount is back.
- Cache size is calculated by walking the entire local `models1.base_path`, which can be slow on very large caches.
- If a category path is configured as a list in YAML, the first entry is used.

### Manual test checklist
- Load a workflow referencing checkpoints/loras/vae/etc; verify rows appear with correct green/red indicators.
- With a network-only file: click “Localize” and confirm it copies into the local cache path and updates to green.
- With a file on both sides but different size: “Re-localize” overwrites and sizes match after refresh.
- “Localize All” copies all eligible entries.
- Unmount the network path: indicators show missing network and copy attempts error gracefully.
- Click “Cancel” during a large copy and confirm partial files are removed.

## Contributing
Issues and pull requests are welcome, especially from studio artists adding more workflow helpers. Please keep additions lightweight and ComfyUI-friendly.
