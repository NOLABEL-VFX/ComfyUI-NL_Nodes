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
            this.setDirtyCanvas(true, true);
            return result;
        };
    },
});
