# ComfyUI-NL_Nodes

Custom nodes for ComfyUI maintained by NOLABEL (initially by Wojciech Czub). The pack focuses on streamlining studio workflows so artists can share consistent utilities. The first node included is the Shot Path Builder, which standardizes file and folder names for renders.

## Installation
- Go to your `ComfyUI/custom_nodes` directory and clone or copy this repository into `ComfyUI-NL_Nodes`.
- Restart ComfyUI. You will find the node under `NOLABEL/Paths` as "Shot Path Builder".

## Shot Path Builder
Generates predictable, sanitized paths and filenames with versioning to keep shots organized.

### Inputs
- `shot_folder` (string): Shot folder path (can include subfolders); drives the folder tree.
- `base_name` (string): Base filename. If empty, uses the last component of `shot_folder`.
- `version_int` (int): Version number used for folder and filename.
- `version_format` (string): Python or printf style format, e.g., `v{:03d}` or `v%03d`; falls back to padded `v###`.
- `name_delim` (string): Delimiter between base, version, and tag (default `_`).
- `png_folder` (string): Subfolder for PNG outputs under the version folder (default `PNG`).
- `sanitize` (bool): When true, converts spaces to `_`, removes illegal filesystem characters, collapses repeats, and trims dots.
- `tag` (string): Optional suffix appended after the version (uses the delimiter).

### Outputs
- `standard_path`: `{shot}/{version_str}/{file_name}`
- `png_path`: `{shot}/{version_str}/{png_folder}/{file_name}`
- `file_name`: `{base}{delim}{version_str}[{delim}{tag}]`
- `version_str`: Formatted version string.
- `folder_standard`: `{shot}/{version_str}/` (trailing slash included).
- `folder_png`: `{shot}/{version_str}/{png_folder}/` (trailing slash included).

### Behavior notes
- Sanitization removes control characters and `<>:"|?*`, replaces whitespace with `_`, collapses multiple underscores, and converts `.` or `..` segments to `_`.
- If `version_format` cannot be parsed, it defaults to `v{version_int}` padded to three digits.
- A small UI helper (`js/shot_path_builder_version_control.js`) sets the node theme to black and adds a "control after generate" button to increment `version_int` after a render.

### Example
With `shot_folder="PFX_101_010_0010_SUBJECT_1001-1081"`, `base_name=""`, `version_int=3`, `version_format="v{:03d}"`, `name_delim="_"`, `png_folder="PNG"`, `tag="beauty"`, `sanitize=True`:
- `version_str`: `v003`
- `file_name`: `PFX_101_010_0010_SUBJECT_1001-1081_v003_beauty`
- `standard_path`: `PFX_101_010_0010_SUBJECT_1001-1081/v003/PFX_101_010_0010_SUBJECT_1001-1081_v003_beauty`
- `png_path`: `PFX_101_010_0010_SUBJECT_1001-1081/v003/PNG/PFX_101_010_0010_SUBJECT_1001-1081_v003_beauty`
- `folder_standard`: `PFX_101_010_0010_SUBJECT_1001-1081/v003/`
- `folder_png`: `PFX_101_010_0010_SUBJECT_1001-1081/v003/PNG/`

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
