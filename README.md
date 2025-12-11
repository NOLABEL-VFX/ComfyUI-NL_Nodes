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

## Contributing
Issues and pull requests are welcome, especially from studio artists adding more workflow helpers. Please keep additions lightweight and ComfyUI-friendly.
