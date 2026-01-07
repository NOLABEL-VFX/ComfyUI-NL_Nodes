import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const EXTENSION_NAME = "NOLABEL.NLWorkflow";
const NODE_NAME = "NLWorkflow";
const DEFAULT_FIELDS = new Set([
    "project",
    "episode",
    "scene",
    "shot",
    "width",
    "height",
    "fps",
    "frame_start",
    "frame_end",
    "project_path",
    "note",
    "use_env_defaults",
    "lock",
]);

const DEBUG_STYLE_ID = "nl-context-debug-style";

function ensureDebugStyles() {
    if (document.getElementById(DEBUG_STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = DEBUG_STYLE_ID;
    style.textContent = `
        .nl-context-debug-output {
            width: 100%;
            min-height: 140px;
            max-height: 900px;
            background: #0b0b0b;
            color: #e5e7eb;
            border: 1px solid #1f2937;
            border-radius: 6px;
            padding: 6px;
            font-family: "IBM Plex Mono", "Courier New", monospace;
            font-size: 11px;
            resize: vertical;
        }
    `;
    document.head.appendChild(style);
}

function extractDebugOutput(message) {
    const output = message?.output ?? message?.outputs ?? message;
    if (!output) return null;
    if (typeof output.context_json === "string") return output.context_json;
    if (Array.isArray(output.context_json) && typeof output.context_json[0] === "string") return output.context_json[0];
    if (typeof output.text === "string") return output.text;
    if (typeof output.value === "string") return output.value;
    if (output.ui && typeof output.ui.context_json === "string") return output.ui.context_json;
    if (output.ui && Array.isArray(output.ui.context_json) && typeof output.ui.context_json[0] === "string") {
        return output.ui.context_json[0];
    }
    if (Array.isArray(output) && typeof output[0] === "string") return output[0];
    if (Array.isArray(output.result) && typeof output.result[0] === "string") return output.result[0];
    if (Array.isArray(output.outputs) && typeof output.outputs[0] === "string") return output.outputs[0];
    if (Array.isArray(output.output) && typeof output.output[0] === "string") return output.output[0];
    if (Array.isArray(output.data) && typeof output.data[0] === "string") return output.data[0];
    return null;
}

function collectDefaults(node) {
    const payload = {};
    for (const widget of node.widgets || []) {
        if (!widget || !widget.name || !DEFAULT_FIELDS.has(widget.name)) continue;
        payload[widget.name] = widget.value;
    }
    return payload;
}

function applyDefaults(node, data) {
    if (!data || typeof data !== "object") return;
    for (const widget of node.widgets || []) {
        if (!widget || !widget.name || !DEFAULT_FIELDS.has(widget.name)) continue;
        if (data[widget.name] === undefined) continue;
        widget.value = data[widget.name];
        if (typeof widget.callback === "function") {
            widget.callback(widget.value);
        }
    }
    node.setDirtyCanvas(true, true);
}

async function saveDefaults(node) {
    const payload = collectDefaults(node);
    const response = await api.fetchApi("/nl_workflow/defaults", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    });
    if (!response.ok) {
        console.warn("[NL Workflow] Failed to save defaults");
    }
}

async function loadDefaults(node) {
    const response = await api.fetchApi("/nl_workflow/defaults");
    if (!response.ok) {
        console.warn("[NL Workflow] Failed to load defaults");
        return;
    }
    const payload = await response.json();
    applyDefaults(node, payload?.data || {});
}

function applyLockState(node, locked) {
    for (const widget of node.widgets || []) {
        if (!widget || !widget.name) continue;
        if (widget.name === "lock") continue;
        if (widget.type === "button") continue;
        widget.disabled = locked;
    }
    node.setDirtyCanvas(true, true);
}

function attachLockHandler(node) {
    const lockWidget = (node.widgets || []).find((widget) => widget?.name === "lock");
    if (!lockWidget) return;
    const original = lockWidget.callback;
    lockWidget.callback = (value) => {
        if (typeof original === "function") {
            original(value);
        }
        applyLockState(node, Boolean(value));
    };
    applyLockState(node, Boolean(lockWidget.value));
}

app.registerExtension({
    name: EXTENSION_NAME,
    async beforeRegisterNodeDef(nodeType, nodeData) {
        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            const result = onNodeCreated?.apply(this, arguments);
            if (nodeData?.name === NODE_NAME || nodeData?.name === "NLContextDebug") {
                this.color = "#000000";
                this.bgcolor = "#000000";
                this.boxcolor = "#000000";
            }
            if (nodeData?.name === "NLContextDebug") {
                this.boxcolor = "#f59e0b";
                ensureDebugStyles();
                const textarea = document.createElement("textarea");
                textarea.className = "nl-context-debug-output";
                textarea.readOnly = true;
                textarea.value = "Run the workflow to see context output.";
                const widget = this.addDOMWidget("context_preview", "context_preview", textarea, { serialize: false });
                widget.serialize = false;
                widget.options.canvasOnly = false;
                const resizeToTextarea = () => {
                    const desired = Math.min(textarea.scrollHeight + 140, 900);
                    if (desired > this.size[1]) {
                        this.setSize([this.size[0], desired]);
                    }
                };
                const updatePreview = (message) => {
                    const outputText = extractDebugOutput(message);
                    if (outputText !== null && outputText !== undefined) {
                        textarea.value = outputText;
                        resizeToTextarea();
                    }
                };
                requestAnimationFrame(resizeToTextarea);
                const onExecuted = this.onExecuted;
                this.onExecuted = function (message) {
                    updatePreview(message);
                    if (typeof onExecuted === "function") {
                        onExecuted.apply(this, arguments);
                    }
                };
                const executedHandler = (event) => {
                    if (!event?.detail) return;
                    if (event.detail.node !== this.id) return;
                    updatePreview(event.detail);
                };
                api.addEventListener("executed", executedHandler);
                const onRemoved = this.onRemoved;
                this.onRemoved = function () {
                    api.removeEventListener("executed", executedHandler);
                    if (typeof onRemoved === "function") {
                        onRemoved.apply(this, arguments);
                    }
                };
            }
            if (nodeData?.name === NODE_NAME) {
                this.addWidget("button", "Save Defaults", "", () => saveDefaults(this));
                this.addWidget("button", "Load Defaults", "", () => loadDefaults(this));
                attachLockHandler(this);
            }
            return result;
        };
    },
});

const IO_EXTENSION_NAME = "NOLABEL.NLReadWrite";
const READ_NODE = "NLRead";
const WRITE_NODE = "NLWrite";
const READ_TITLE = "NL Read";
const WRITE_TITLE = "NL Write";
const IO_NODE_COLOR = "#000000";
const PREVIEW_STYLE_ID = "nl-read-write-preview-style";
const TOAST_STYLE_ID = "nl-read-write-toast-style";

function ensurePreviewStyles() {
    if (document.getElementById(PREVIEW_STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = PREVIEW_STYLE_ID;
    style.textContent = `
        .nl-io-path-preview {
            width: 100%;
            min-height: 48px;
            background: #0b0b0b;
            color: #e5e7eb;
            border: 1px solid #1f2937;
            border-radius: 6px;
            padding: 6px;
            font-family: "IBM Plex Mono", "Courier New", monospace;
            font-size: 11px;
            resize: vertical;
        }
    `;
    document.head.appendChild(style);
}

function ensureToastStyles() {
    if (document.getElementById(TOAST_STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = TOAST_STYLE_ID;
    style.textContent = `
        .nl-io-toast {
            position: fixed;
            right: 18px;
            bottom: 18px;
            background: rgba(15, 15, 15, 0.96);
            color: #f3f4f6;
            border: 1px solid #1f2937;
            border-radius: 10px;
            padding: 10px 14px;
            font-family: "IBM Plex Sans", "Helvetica Neue", sans-serif;
            font-size: 12px;
            z-index: 9999;
            box-shadow: 0 10px 24px rgba(0, 0, 0, 0.35);
            opacity: 0;
            transform: translateY(6px);
            transition: opacity 160ms ease, transform 160ms ease;
        }
        .nl-io-toast.show {
            opacity: 1;
            transform: translateY(0);
        }
    `;
    document.head.appendChild(style);
}

let activeToast = null;

function toast(message) {
    ensureToastStyles();
    if (activeToast) {
        activeToast.remove();
        activeToast = null;
    }
    const node = document.createElement("div");
    node.className = "nl-io-toast";
    node.textContent = message;
    document.body.appendChild(node);
    requestAnimationFrame(() => node.classList.add("show"));
    activeToast = node;
    setTimeout(() => {
        node.classList.remove("show");
        setTimeout(() => {
            node.remove();
            if (activeToast === node) activeToast = null;
        }, 200);
    }, 1800);
}

function notify(message) {
    if (app?.ui?.dialog && typeof app.ui.dialog.show === "function") {
        app.ui.dialog.show(message);
        return;
    }
    if (typeof window !== "undefined") {
        toast(message);
        return;
    }
    console.warn(message);
}

function getWidgetValue(node, name, fallback = "") {
    const widget = (node.widgets || []).find((item) => item?.name === name);
    if (!widget) return fallback;
    const value = widget.value;
    return value === undefined || value === null ? fallback : value;
}

function normalizeSubfolder(value) {
    if (!value) return "";
    return String(value).replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

function ensureExtension(value, ext) {
    const text = String(value || "");
    if (!text || text.includes(".")) return text;
    if (!ext) return text;
    return `${text}.${ext}`;
}

function resolvePreview(node, kind) {
    const pathOverride = String(getWidgetValue(node, "path_override", "")).trim();
    const folderRoot = String(getWidgetValue(node, "folder_root", "output")).trim() || "output";
    const subfolder = normalizeSubfolder(getWidgetValue(node, "subfolder", ""));
    const base = pathOverride || `[context]/${folderRoot}${subfolder ? `/${subfolder}` : ""}`;

    if (kind === "write") {
        const mode = getWidgetValue(node, "mode", "single_image");
        const basename = String(getWidgetValue(node, "basename", "")).trim() || "[basename]";
        const format = getWidgetValue(node, "format", "png");
        if (mode === "sequence") {
            return `${base}/${basename}/${basename}.####.${format}`;
        }
        return `${base}/${ensureExtension(basename, format)}`;
    }

    const pattern = String(getWidgetValue(node, "name_or_pattern", "")).trim() || "[pattern]";
    const ext = getWidgetValue(node, "file_ext", "png");
    return `${base}/${ensureExtension(pattern, ext)}`;
}

function resolveFolderPath(pathPreview) {
    if (!pathPreview || typeof pathPreview !== "string") return "";
    const normalized = pathPreview.replace(/\\/g, "/");
    if (normalized.includes("[context]")) return "";
    const lastSlash = normalized.lastIndexOf("/");
    if (lastSlash <= 0) return normalized;
    return normalized.slice(0, lastSlash);
}

async function copyToClipboard(text) {
    if (!text) return false;
    if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
    }
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    let ok = false;
    try {
        ok = document.execCommand("copy");
    } catch (err) {
        ok = false;
    }
    document.body.removeChild(textarea);
    return ok;
}

function attachPreviewWidget(node, kind) {
    ensurePreviewStyles();
    const textarea = document.createElement("textarea");
    textarea.className = "nl-io-path-preview";
    textarea.readOnly = true;
    textarea.value = "Resolved path preview will appear here.";
    const widget = node.addDOMWidget("path_preview", "path_preview", textarea, { serialize: false });
    widget.serialize = false;
    widget.options.canvasOnly = false;

    const updatePreview = () => {
        textarea.value = resolvePreview(node, kind);
    };

    for (const widgetItem of node.widgets || []) {
        if (!widgetItem || !widgetItem.name) continue;
        const watched = [
            "path_override",
            "folder_root",
            "subfolder",
            "basename",
            "mode",
            "format",
            "name_or_pattern",
            "file_ext",
        ];
        if (!watched.includes(widgetItem.name)) continue;
        const original = widgetItem.callback;
        widgetItem.callback = (value) => {
            if (typeof original === "function") {
                original(value);
            }
            updatePreview();
        };
    }

    requestAnimationFrame(updatePreview);
}

function attachActionButtons(node, kind) {
    node.addWidget("button", "Open Folder", "", () => {
        const preview = resolvePreview(node, kind);
        const folderPath = resolveFolderPath(preview);
        if (!folderPath) {
            notify("Open Folder is unavailable without a resolved path. Use a path override or run the workflow.");
            return;
        }
        window.open(`file://${folderPath}`);
    });

    node.addWidget("button", "Copy Path", "", async () => {
        const preview = resolvePreview(node, kind);
        if (!preview) {
            notify("No path available to copy.");
            return;
        }
        const ok = await copyToClipboard(preview);
        if (!ok) {
            notify("Failed to copy path to clipboard.");
        }
    });
}

app.registerExtension({
    name: IO_EXTENSION_NAME,
    async beforeRegisterNodeDef(nodeType, nodeData) {
        const nodeName = nodeData?.name || nodeType?.name || "";
        const displayName = nodeData?.display_name || nodeType?.display_name || "";
        const title = nodeType?.title || "";
        const isRead = nodeName === READ_NODE || displayName.includes(READ_TITLE) || title.includes(READ_TITLE);
        const isWrite = nodeName === WRITE_NODE || displayName.includes(WRITE_TITLE) || title.includes(WRITE_TITLE);
        if (!isRead && !isWrite) return;
        if (nodeData) {
            nodeData.color = IO_NODE_COLOR;
            nodeData.bgcolor = IO_NODE_COLOR;
            nodeData.boxcolor = IO_NODE_COLOR;
        }
        if (nodeType) {
            nodeType.color = IO_NODE_COLOR;
            nodeType.bgcolor = IO_NODE_COLOR;
            nodeType.boxcolor = IO_NODE_COLOR;
        }
        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            const result = onNodeCreated?.apply(this, arguments);
            this.color = IO_NODE_COLOR;
            this.bgcolor = IO_NODE_COLOR;
            this.boxcolor = IO_NODE_COLOR;
            const kind = isWrite ? "write" : "read";
            attachPreviewWidget(this, kind);
            attachActionButtons(this, kind);
            this.setDirtyCanvas(true, true);
            return result;
        };
    },
});
