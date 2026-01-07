+# NL Read & NL Write Nodes Prompt
+
+## Overview
+Design NL Read and NL Write nodes that leverage the `workflow_context` produced by the NL Workflow node. These nodes should replace disparate file IO nodes (e.g., Load/Save Image, VHS Combine Video) by providing a unified, context-aware interface for reading/writing images and video assets tied to a project directory structure.
+
+## Shared goals
+- **Context first**: Infer paths and filenames from `workflow_context` (project, episode, scene, shot, frame range, resolution, FPS, output path, version, notes) with predictable defaults and light validation.
+- **Streamlined UX**: Minimal required inputs, smart defaults, clear presets (resolution/FPS), and optional expert controls to reduce setup time.
+- **Performance**: Avoid unnecessary copies; support lazy loading/streaming for sequences; allow batch-friendly outputs.
+- **Safety & reproducibility**: Sanitized filenames, collision handling (versioned outputs), optional sidecar metadata (JSON) describing read/write operations.
+
+---
+## NL Read node
+### Purpose
+Read visual media from the project workspace, supporting single images, image sequences, and video files, with optional preprocessing to match workflow settings.
+
+### Inputs
+- `workflow_context` (dict): required for resolving project paths and defaults.
+- `path_override` (string, optional): manual relative/absolute path to bypass context-derived paths.
+- `mode` selector: `single_image`, `sequence`, `video`.
+- `filename` / `pattern` (string): basename or glob/pattern; default derived from shot/frame range/version in context.
+- `folder` dropdown:
+  - Default to `{project_path}/input`.
+  - Secondary option for `{project_path}/output` for reference pulls.
+  - Allow custom subfolder within the selected root (e.g., `plates/`, `roto/`).
+- `preprocess` group (optional):
+  - Resize preset dropdown (e.g., `workflow resolution`, `HD 1920x1080`, `4K 3840x2160`, `custom`).
+  - Custom width/height fields (enabled when preset = custom).
+  - Fit mode (letterbox, crop, stretch), interpolation (nearest/bilinear/bicubic/area).
+  - Color convert (keep, linearize, RGB, RGBA, single-channel mask).
+- `frame_range_override` for sequences (start/end/step), defaults to context frame range.
+- `fps_override` for video playback metadata (defaults to context FPS).
+- `decode_stride` (int, optional) to subsample frames for speed.
+
+### Outputs
+- `image` / `images`: tensor(s) representing RGB or RGBA data.
+- `mask` (optional): extracted single-channel mask if requested via preprocess.
+- `metadata`: includes resolved file paths, applied preprocessing, source frame range/FPS, hash or timestamp for cache busting.
+
+### Behavior & UX
+- Resolve base path: `base = path_override or join(context.project_path, selected_root, custom_subfolder)`.
+- Pattern defaults: for sequences use `{project}_{episode}_{scene}_{shot}_v{version:02d}.####.exr` or similar; for single use `.png/.exr`; video use `.mov/.mp4`.
+- Provide a file chooser populated from the resolved folder (paginated to avoid UI stalls).
+- Validation warnings (non-blocking) for missing files, empty folder, or mismatched resolution/FPS vs context.
+- Optional caching of decoded frames when reading sequences for scrubbing/reuse.
+- Allow reading alpha when present; expose toggle to split alpha into mask output.
+- For movie inputs, output decoded frames (sequence) and optional proxy downscale for speed.
+
+---
+## NL Write node
+### Purpose
+Write images or sequences to disk using workflow context, with automatic path construction, versioning, and preview generation.
+
+### Shared inputs
+- `workflow_context` (dict): required for path resolution and defaults.
+- `path_override` (optional): bypass context path building.
+- `folder` dropdown: default `{project_path}/output`, optional `{project_path}/input` for intermediates, plus custom subfolder.
+- `basename` (string): default from context (e.g., `{project}_{episode}_{scene}_{shot}_v{version:02d}`).
+- `versioning` controls: increment toggle, collision policy (overwrite/skip/auto-bump), padding for frame numbers.
+- `metadata` toggle: write a JSON sidecar capturing node inputs/settings.
+
+### Mode: Single Image
+- Inputs: `image` (RGB or RGBA), optional `mask` (single channel).
+- Format selection: PNG, EXR, JPEG, TIFF, WebP. Default PNG with alpha if mask provided.
+- Color management toggle: preserve alpha; optional premult/unpremult; bit depth selection (8/16/32f depending on format).
+- Output path: `{base}/{basename}.{ext}` where `base` derives from context folder logic.
+
+### Mode: Sequence
+- Inputs: `images` (tensor list/sequence), optional `mask_sequence`.
+- Outputs:
+  - **Image sequence**: format selection (EXR/PNG/TIFF), frame padding controls, start frame default from context.
+  - **Video preview**: optional render to MP4/MOV, codec presets (H.264, ProRes proxy), resolution preset (workflow, 1080p, custom), FPS default from context.
+- Pathing:
+  - Sequence: `{base}/{basename}/{basename}.{frame:0{padding}d}.{ext}`.
+  - Video preview: `{base}/{basename}/{basename}_preview.{container}` with optional subfolder `preview/`.
+- Mask handling: if mask connected, combine into alpha before write; preserve separate mask export toggle (`basename_mask` sequence) if desired.
+- Performance: batch writes with efficient codecs; asynchronous write option to avoid UI stalls.
+
+### Outputs (node)
+- `file_paths`: list of written files (sequence) or single path.
+- `preview_path`: path to generated video preview (when enabled).
+- `metadata`: actual settings used, resolved paths, and timing info for downstream logging.
+
+### UX considerations
+- Compact UI with collapsible groups: **Pathing**, **Format**, **Sequence**, **Preview**, **Advanced**.
+- Inline summaries showing resolved output path pattern before execution.
+- Warnings rather than hard errors for missing context; fall back to user-entered fields.
+- Buttons: `Open Folder` (if allowed), `Copy Path`, `Bump Version`, `Render Preview Only`.
+- Preset buttons for common tasks: "Save plate (EXR)", "Save matte (PNG+alpha)", "Publish preview".
+
+---
+## Additional ideas
+- **Template manager**: allow saving/loading read/write presets per project under `ComfyUI/user/nl_presets.json`.
+- **Checksum & provenance**: optional MD5/hash to detect stale reads; embed workflow context into metadata chunks/EXR attributes.
+- **Error surface**: soft warnings aggregated in metadata output for UI display.
+- **Node category**: `NOLABEL/IO` or `NOLABEL/Workflow` for easy discovery.
+- **Testing hooks**: add sample scripts to validate path resolution and sequence writes (use `conda activate timemachine` before running tests).
+
+## Acceptance criteria (for future implementation)
+- Nodes resolve default paths from `workflow_context` and allow overrides.
+- NL Read supports single/sequence/video with preprocessing and mask/alpha options.
+- NL Write supports single and sequence modes with optional preview render and alpha/mask handling.
+- UI remains concise with sensible defaults and clear path previews.
+- Metadata outputs capture resolved settings and paths for downstream auditing.
