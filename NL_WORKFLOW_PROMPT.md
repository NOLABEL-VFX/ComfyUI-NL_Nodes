+# NL Workflow Node Implementation Prompt
+
+## Goal
+Implement an "NL Workflow" ComfyUI node that owns global workflow metadata for studio-oriented pipelines. The node should emit structured context that other NL nodes (e.g., future NL Read/NL Write) can consume instead of duplicating inputs.
+
+## Core requirements
+- **Fields**
+  - Project name (string)
+  - Episode (string)
+  - Scene (string)
+  - Shot (string)
+  - Resolution (width, height)
+  - FPS (float or int)
+  - Frame range (start, end)
+  - Output path (string)
+  - Optional: version (int) with a bump toggle; optional note/description field
+- **Outputs**
+  - Individual outputs for key fields (project, episode, scene, shot, resolution tuple, fps, frame range, version, output path)
+  - A combined `workflow_context` output containing all fields plus metadata such as timestamps and a unique ID
+  - Consider an optional output for a JSON sidecar path if you choose to write the context to disk
+- **Validation**
+  - Basic type checks (numeric for resolution/fps/range) and gentle warnings for empty critical fields (e.g., missing output path)
+  - Sanitization for filesystem-touching fields (shot ID, output path segments) to avoid illegal characters
+- **UX**
+  - Group UI fields logically (Identifiers, Timing, Output) and keep labels succinct
+  - Add a lock toggle to prevent accidental edits once configured
+  - Provide buttons to save/load defaults to a JSON file under `ComfyUI/user/defaults/nl_workflow.json` (or similar) so users can persist show settings
+  - Reserve a `custom_metadata` dictionary field for future extension without schema changes
+- **Data shape**
+  - Prefer a plain Python dict for the `workflow_context` so other nodes can consume it easily
+  - Include resolved integers for width/height, start/end, fps, version, and strings for the rest; allow `None` for unset optional fields
+
+## Behavioral notes
+- Do not block execution on validation; surface warnings instead.
+- Include a helper that can auto-initialize fields from environment variables if present (e.g., `SHOW`, `SHOT`, `SEQ`), but keep this optional and non-fatal.
+- Keep code lightweight and in line with existing repository patterns for ComfyUI nodes.
+
+## Testing guidance
+- Add a minimal test plan or manual checklist in comments/docstrings.
+- If running tests or sample scripts locally, use `conda activate timemachine` before executing commands.
+
+## Deliverables
+- Node implementation Python file within this repository (name it appropriately, e.g., `nl_workflow.py`), plus any small UI helper JS if needed.
+- Update repository metadata (e.g., README or nodes manifest) so the node appears in ComfyUI under an `NOLABEL/Workflow` category.
+
+## Tone and scope
+Keep the implementation focused on providing a reliable source of workflow context. Leave more advanced pipeline actions to future nodes.
