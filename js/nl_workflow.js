import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const EXTENSION_NAME = "NOLABEL.NLWorkflow";
const NODE_NAME = "NLWorkflow";
const BLACK_NODE_NAMES = new Set([
    "NLWorkflow",
    "NLContextDebug",
    "NLWorkflowFPS",
    "NLWorkflowResolution",
    "NLWorkflowProjectPath",
]);
const DEFAULT_FIELDS = new Set([
    "project",
    "episode",
    "scene",
    "shot",
    "width",
    "height",
    "fps",
    "project_path",
    "note",
    "lock",
]);

const DEBUG_STYLE_ID = "nl-context-debug-style";
const PANEL_STYLE_ID = "nl-workflow-panel-style";
const PANEL_ID = "nl-workflow-panel";
const PANEL_TOGGLE_ID = "nl-workflow-toggle";
const REQUIRED_FIELDS = ["project", "scene", "shot", "project_path"];
const REQUIRED_CACHE_FIELDS = ["project_path"];
const AUTO_APPLY_DELAY_MS = 600;
const HISTORY_LIMIT = 12;

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

function ensurePanelStyles() {
    if (document.getElementById(PANEL_STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = PANEL_STYLE_ID;
    style.textContent = `
        .nl-wf-panel {
            position: fixed;
            top: 72px;
            right: 16px;
            width: 480px;
            max-width: calc(100vw - 32px);
            background: #0b0b0b;
            color: #e6e6e6;
            border: 1px solid #2e2e2e;
            border-radius: 8px;
            box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
            z-index: 10001;
            display: none;
            font-family: "IBM Plex Mono", "Courier New", monospace;
            font-size: 11px;
        }

        .nl-wf-panel-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 8px;
            padding: 4px 6px;
            cursor: move;
            user-select: none;
        }

        .nl-wf-panel-title {
            font-weight: 600;
            color: #e6e6e6;
            font-size: 13px;
        }

        .nl-wf-panel-hint {
            color: #9aa0a6;
            font-size: 10px;
            margin-left: 8px;
        }

        .nl-wf-panel-close {
            background: #2a2a2a;
            color: #f0f0f0;
            border: 1px solid #444;
            padding: 2px 8px;
            border-radius: 4px;
            cursor: pointer;
        }

        .nl-wf-panel-body {
            padding: 0 6px 8px;
            display: flex;
            flex-direction: column;
            gap: 8px;
            max-height: calc(100vh - 190px);
            overflow: auto;
        }

        .nl-wf-field {
            display: flex;
            flex-direction: column;
            gap: 4px;
        }

        .nl-wf-field label {
            font-size: 10px;
            color: #9aa0a6;
        }

        .nl-wf-field input,
        .nl-wf-field textarea {
            width: 100%;
            background: #111;
            color: #e6e6e6;
            border: 1px solid #333;
            border-radius: 4px;
            padding: 4px 6px;
            font-size: 11px;
        }

        .nl-wf-field textarea {
            min-height: 64px;
            resize: vertical;
        }

        .nl-wf-field-hint {
            margin-top: 4px;
            font-size: 10px;
            color: #6b7280;
        }

        .nl-wf-inline {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 8px;
        }

        .nl-wf-inline-2 {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 8px;
        }

        .nl-wf-actions {
            display: flex;
            gap: 8px;
            flex-wrap: wrap;
        }

        .nl-wf-actions button {
            background: #2a2a2a;
            color: #f0f0f0;
            border: 1px solid #444;
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 11px;
            cursor: pointer;
        }

        .nl-wf-actions button:hover {
            background: #3a3a3a;
        }

        .nl-wf-status {
            padding: 4px 6px;
            border-radius: 4px;
            font-size: 11px;
            background: #0b0b0b;
            border: 1px solid #2e2e2e;
        }

        .nl-wf-status.is-warning {
            color: #ff6b6b;
            border-color: #5a2a2a;
            background: rgba(255, 77, 77, 0.08);
        }

        .nl-wf-status.is-ok {
            color: #c9f7a1;
            border-color: #2f4a2f;
            background: rgba(76, 217, 100, 0.08);
        }

        .nl-wf-lock {
            display: flex;
            align-items: center;
            gap: 6px;
            font-size: 11px;
            color: #cbd5e1;
        }

        .nl-wf-history {
            border: 1px solid #2e2e2e;
            border-radius: 6px;
            background: #0b0b0b;
            padding: 6px;
        }

        .nl-wf-history-header {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 6px;
            color: #9aa0a6;
            font-size: 10px;
        }

        .nl-wf-history-header button {
            background: #2a2a2a;
            color: #f0f0f0;
            border: 1px solid #444;
            padding: 2px 6px;
            border-radius: 4px;
            font-size: 10px;
            cursor: pointer;
        }

        .nl-wf-history-list {
            display: flex;
            flex-direction: column;
            gap: 4px;
        }

        .nl-wf-history-item {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 6px;
            padding: 4px 6px;
            border: 1px solid #2e2e2e;
            border-radius: 4px;
            background: #111;
        }

        .nl-wf-history-item button {
            background: #2a2a2a;
            color: #f0f0f0;
            border: 1px solid #444;
            padding: 2px 6px;
            border-radius: 4px;
            font-size: 10px;
            cursor: pointer;
        }

        .nl-wf-history-item .nl-wf-history-delete {
            color: #ff9c9c;
        }

        .nl-wf-history-text {
            display: flex;
            flex-direction: column;
            gap: 2px;
            flex: 1;
            min-width: 0;
        }

        .nl-wf-history-title {
            font-size: 11px;
            color: #e6e6e6;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .nl-wf-history-sub {
            font-size: 10px;
            color: #9aa0a6;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .nl-wf-history-empty {
            color: #9aa0a6;
            font-size: 10px;
            padding: 4px 2px;
        }

        .nl-wf-panel-toggle {
            position: fixed;
            right: 16px;
            bottom: 16px;
            background: #2a2a2a;
            color: #f0f0f0;
            border: 1px solid #444;
            border-radius: 999px;
            padding: 6px 10px;
            font-size: 11px;
            cursor: pointer;
            z-index: 10001;
        }

        .nl-wf-toggle-warning {
            border-color: #ef4444 !important;
            color: #fecaca !important;
        }

        .nl-wf-toggle-ok {
            border-color: #10b981 !important;
            color: #bbf7d0 !important;
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

async function saveDefaultsPayload(payload) {
    const response = await api.fetchApi("/nl_workflow/defaults", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    });
    return response.ok;
}

async function loadDefaultsData() {
    const response = await api.fetchApi("/nl_workflow/defaults");
    if (!response.ok) {
        return { ok: false, data: null };
    }
    const payload = await response.json();
    return { ok: true, data: payload?.data || {} };
}

async function resetDefaults() {
    const response = await api.fetchApi("/nl_workflow/reset", { method: "POST" });
    if (!response.ok) {
        return { ok: false };
    }
    const payload = await response.json();
    return { ok: Boolean(payload?.ok) };
}

async function clearCache() {
    const response = await api.fetchApi("/nl_workflow/clear_cache", { method: "POST" });
    return response.ok;
}

async function loadHistory() {
    const response = await api.fetchApi("/nl_workflow/history");
    if (!response.ok) {
        return { ok: false, data: [] };
    }
    const payload = await response.json();
    const items = Array.isArray(payload?.data) ? payload.data : [];
    return { ok: true, data: items };
}

async function deleteHistoryEntry(entryId) {
    const response = await api.fetchApi("/nl_workflow/history/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: entryId }),
    });
    return response.ok;
}

async function clearHistory() {
    const response = await api.fetchApi("/nl_workflow/history/clear", { method: "POST" });
    return response.ok;
}

async function commitHistory(payload) {
    const response = await api.fetchApi("/nl_workflow/history/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    });
    return response.ok;
}

function collectDefaults(node) {
    const payload = {};
    for (const widget of node.widgets || []) {
        if (!widget || !widget.name || !DEFAULT_FIELDS.has(widget.name)) continue;
        payload[widget.name] = widget.value;
    }
    return payload;
}

function collectDefaultsFromInputs(inputs) {
    const payload = {};
    for (const [name, input] of inputs.entries()) {
        if (!DEFAULT_FIELDS.has(name)) continue;
        if (input.type === "checkbox") {
            payload[name] = Boolean(input.checked);
        } else if (input.type === "number") {
            payload[name] = input.value === "" ? "" : Number(input.value);
        } else {
            payload[name] = input.value ?? "";
        }
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

function applyDefaultsToInputs(inputs, data) {
    if (!data || typeof data !== "object") return;
    for (const [name, input] of inputs.entries()) {
        if (!DEFAULT_FIELDS.has(name)) continue;
        if (data[name] === undefined) continue;
        if (input.type === "checkbox") {
            input.checked = Boolean(data[name]);
        } else if (input.type === "number") {
            input.value = data[name] === "" ? "" : String(data[name]);
        } else {
            input.value = data[name] ?? "";
        }
    }
}

async function saveDefaults(node) {
    const payload = collectDefaults(node);
    const ok = await saveDefaultsPayload(payload);
    if (!ok) {
        console.warn("[NL Workflow] Failed to save defaults");
    }
}

async function loadDefaults(node) {
    const result = await loadDefaultsData();
    if (!result.ok) {
        console.warn("[NL Workflow] Failed to load defaults");
        return;
    }
    applyDefaults(node, result.data || {});
    await populateCache(node);
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

function insertWidgetAfter(node, targetName, widget) {
    const widgets = node.widgets || [];
    const targetIndex = widgets.findIndex((item) => item?.name === targetName);
    if (targetIndex === -1) return;
    const widgetIndex = widgets.indexOf(widget);
    if (widgetIndex === -1) return;
    widgets.splice(widgetIndex, 1);
    widgets.splice(targetIndex + 1, 0, widget);
}

function notifyUser(message) {
    if (app?.ui?.showToast) {
        app.ui.showToast(message);
        return;
    }
    if (window?.alert) {
        window.alert(message);
    }
}

function refreshAllNLReadNodes() {
    const callbacks = window?.__nlReadRefreshCallbacks;
    if (!callbacks || typeof callbacks.forEach !== "function") return;
    callbacks.forEach((callback) => {
        try {
            callback();
        } catch (err) {
            console.warn("[NL Workflow] Failed to refresh NL Read node", err);
        }
    });
}

async function populateCachePayload(payload, { notifyOnError = true } = {}) {
    const response = await api.fetchApi("/nl_workflow/populate_cache", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    });
    if (!response.ok) {
        console.warn("[NL Workflow] Failed to populate cache");
        if (notifyOnError) {
            notifyUser("NL Workflow: populate cache failed.");
        }
        return { ok: false, error: "request_failed" };
    }
    const result = await response.json();
    if (!result?.ok) {
        console.warn("[NL Workflow] Populate cache error:", result?.error);
        if (notifyOnError) {
            notifyUser(result?.error || "NL Workflow: populate cache failed.");
        }
        return { ok: false, error: result?.error };
    }
    // Silent success to avoid toast spam on auto-apply.
    window.dispatchEvent(new CustomEvent("nl-workflow-cache-updated"));
    refreshAllNLReadNodes();
    return { ok: true };
}

async function populateCache(node) {
    const payload = collectDefaults(node);
    return populateCachePayload(payload);
}

function createField({ name, label, type = "text", placeholder = "", min, max, step }) {
    const wrapper = document.createElement("div");
    wrapper.className = "nl-wf-field";

    const fieldLabel = document.createElement("label");
    fieldLabel.textContent = label;

    let input;
    if (type === "textarea") {
        input = document.createElement("textarea");
    } else {
        input = document.createElement("input");
        input.type = type;
    }
    input.name = name;
    if (placeholder) input.placeholder = placeholder;
    if (min !== undefined) input.min = String(min);
    if (max !== undefined) input.max = String(max);
    if (step !== undefined) input.step = String(step);

    wrapper.append(fieldLabel, input);
    return { wrapper, input };
}

function missingRequiredFields(payload, requiredFields = REQUIRED_FIELDS) {
    const missing = [];
    for (const name of requiredFields) {
        const value = payload?.[name];
        if (value === undefined || value === null || String(value).trim() === "") {
            missing.push(name);
        }
    }
    return missing;
}

function createWorkflowPanel() {
    if (document.getElementById(PANEL_ID)) return;
    ensurePanelStyles();

    const panel = document.createElement("div");
    panel.id = PANEL_ID;
    panel.className = "nl-wf-panel";

    const header = document.createElement("div");
    header.className = "nl-wf-panel-header";
    const title = document.createElement("div");
    title.className = "nl-wf-panel-title";
    title.textContent = "NL Workflow";
    const hint = document.createElement("div");
    hint.className = "nl-wf-panel-hint";
    hint.textContent = "Drag to move";
    const headerLeft = document.createElement("div");
    headerLeft.style.display = "flex";
    headerLeft.style.alignItems = "center";
    headerLeft.append(title, hint);
    const closeButton = document.createElement("button");
    closeButton.className = "nl-wf-panel-close";
    closeButton.textContent = "Close";
    header.append(headerLeft, closeButton);

    const body = document.createElement("div");
    body.className = "nl-wf-panel-body";

    const status = document.createElement("div");
    status.className = "nl-wf-status";
    status.textContent = "Load defaults to enable context.";
    body.appendChild(status);

    const inputs = new Map();
    const defaults = {
        project: "",
        episode: "",
        scene: "",
        shot: "",
        width: 1920,
        height: 1080,
        fps: 24,
        project_path: "",
        note: "",
        lock: false,
    };

    const rowOne = document.createElement("div");
    rowOne.className = "nl-wf-inline-2";
    const projectField = createField({ name: "project", label: "Project" });
    const episodeField = createField({ name: "episode", label: "Episode" });
    rowOne.append(projectField.wrapper, episodeField.wrapper);

    const rowTwo = document.createElement("div");
    rowTwo.className = "nl-wf-inline-2";
    const sceneField = createField({ name: "scene", label: "Scene" });
    const shotField = createField({ name: "shot", label: "Shot" });
    rowTwo.append(sceneField.wrapper, shotField.wrapper);

    const rowThree = document.createElement("div");
    rowThree.className = "nl-wf-inline-2";
    const widthField = createField({ name: "width", label: "Width", type: "number", min: 1, max: 16384, step: 1 });
    const heightField = createField({ name: "height", label: "Height", type: "number", min: 1, max: 16384, step: 1 });
    rowThree.append(widthField.wrapper, heightField.wrapper);

    const fpsField = createField({ name: "fps", label: "FPS", type: "number", min: 0.1, max: 240, step: 0.1 });
    const projectPathField = createField({
        name: "project_path",
        label: "Project Path",
        placeholder: "/mnt/skynet/projects/.../050_COMFY",
    });
    const projectPathHint = document.createElement("div");
    projectPathHint.className = "nl-wf-field-hint";
    projectPathHint.textContent = "Tip: point to the .../050_COMFY folder; NL Write saves into ./output.";
    projectPathField.wrapper.appendChild(projectPathHint);
    const noteField = createField({ name: "note", label: "Note", type: "textarea" });

    for (const field of [
        projectField,
        episodeField,
        sceneField,
        shotField,
        widthField,
        heightField,
        fpsField,
        projectPathField,
        noteField,
    ]) {
        inputs.set(field.input.name, field.input);
    }

    for (const [name, value] of Object.entries(defaults)) {
        const input = inputs.get(name);
        if (!input) continue;
        if (input.type === "number") {
            input.value = value === "" ? "" : String(value);
        } else {
            input.value = value ?? "";
        }
    }

    body.append(rowOne, rowTwo, rowThree, fpsField.wrapper, projectPathField.wrapper, noteField.wrapper);

    const lockRow = document.createElement("label");
    lockRow.className = "nl-wf-lock";
    const lockInput = document.createElement("input");
    lockInput.type = "checkbox";
    lockInput.name = "lock";
    lockRow.append(lockInput, document.createTextNode("Lock fields"));
    body.appendChild(lockRow);
    inputs.set("lock", lockInput);

    const historyWrap = document.createElement("div");
    historyWrap.className = "nl-wf-history";
    const historyHeader = document.createElement("div");
    historyHeader.className = "nl-wf-history-header";
    const historyTitle = document.createElement("div");
    historyTitle.textContent = "Recent contexts";
    const historyAdd = document.createElement("button");
    historyAdd.textContent = "Add";
    const historyClear = document.createElement("button");
    historyClear.textContent = "Clear";
    historyHeader.append(historyTitle, historyAdd, historyClear);
    const historyList = document.createElement("div");
    historyList.className = "nl-wf-history-list";
    historyWrap.append(historyHeader, historyList);
    body.appendChild(historyWrap);

    panel.append(header, body);
    document.body.appendChild(panel);

    const toggle = document.createElement("button");
    toggle.id = PANEL_TOGGLE_ID;
    toggle.textContent = "NL Workflow";
    toggle.className = "nl-wf-panel-toggle";

    let lastApplyOk = false;
    let lastError = null;
    let autoApplyTimer = null;
    let lastCommitSignature = "";

    function isLocked() {
        return Boolean(lockInput.checked);
    }

    function applyLockState(locked) {
        for (const [name, input] of inputs.entries()) {
            if (name === "lock") continue;
            input.disabled = locked;
        }
    }

    function setToggleState(state) {
        if (state === "warning") {
            toggle.classList.add("nl-wf-toggle-warning");
            toggle.classList.remove("nl-wf-toggle-ok");
            toggle.style.borderColor = "#ef4444";
            toggle.style.color = "#fecaca";
            toggle.style.backgroundColor = "#7f1d1d";
            return;
        }
        if (state === "ok") {
            toggle.classList.remove("nl-wf-toggle-warning");
            toggle.classList.add("nl-wf-toggle-ok");
            toggle.style.borderColor = "#10b981";
            toggle.style.color = "#bbf7d0";
            toggle.style.backgroundColor = "#065f46";
            return;
        }
        toggle.classList.remove("nl-wf-toggle-warning");
        toggle.classList.remove("nl-wf-toggle-ok");
        toggle.style.borderColor = "";
        toggle.style.color = "";
        toggle.style.backgroundColor = "";
    }

    function updateStatus() {
        const payload = collectDefaultsFromInputs(inputs);
        const missing = missingRequiredFields(payload);
        if (missing.length) {
            status.textContent = `Missing: ${missing.join(", ")}`;
            status.classList.add("is-warning");
            status.classList.remove("is-ok");
            setToggleState("warning");
            if (panel.style.display !== "block") {
                panel.style.display = "block";
            }
            return;
        }
        if (lastError) {
            status.textContent = `Cache error: ${lastError}`;
            status.classList.add("is-warning");
            status.classList.remove("is-ok");
            setToggleState("warning");
            if (panel.style.display !== "block") {
                panel.style.display = "block";
            }
            return;
        }
        if (lastApplyOk) {
            status.textContent = "Context applied.";
            status.classList.add("is-ok");
            status.classList.remove("is-warning");
            setToggleState("ok");
            return;
        }
        status.textContent = "Ready to apply cache.";
        status.classList.remove("is-warning");
        status.classList.remove("is-ok");
        setToggleState("default");
    }

    async function applyCache({ notifyOnError = true } = {}) {
        const payload = collectDefaultsFromInputs(inputs);
        const result = await populateCachePayload(payload, { notifyOnError });
        lastApplyOk = result.ok;
        lastError = result.ok ? null : result.error;
        updateStatus();
        if (result.ok) {
            await refreshHistory();
        }
        return result;
    }

    function commitSignature(payload) {
        return JSON.stringify({
            project: payload.project || "",
            episode: payload.episode || "",
            scene: payload.scene || "",
            shot: payload.shot || "",
            project_path: payload.project_path || "",
            width: payload.width || "",
            height: payload.height || "",
            fps: payload.fps || "",
        });
    }

    async function commitCurrentContext() {
        const payload = collectDefaultsFromInputs(inputs);
        const missing = missingRequiredFields(payload);
        if (missing.length) {
            return { ok: false, reason: "missing" };
        }
        const signature = commitSignature(payload);
        if (signature === lastCommitSignature) {
            return { ok: true, skipped: true };
        }
        const ok = await commitHistory(payload);
        if (!ok) {
            notifyUser("NL Workflow: failed to commit history.");
            return { ok: false, reason: "request_failed" };
        }
        lastCommitSignature = signature;
        await refreshHistory();
        return { ok: true };
    }

    function scheduleAutoApply() {
        if (isLocked()) return;
        if (autoApplyTimer) {
            clearTimeout(autoApplyTimer);
        }
        autoApplyTimer = setTimeout(async () => {
            const payload = collectDefaultsFromInputs(inputs);
            const missingForCache = missingRequiredFields(payload, REQUIRED_CACHE_FIELDS);
            if (missingForCache.length) {
                await clearCache();
                lastApplyOk = false;
                lastError = null;
                lastCommitSignature = "";
                updateStatus();
                return;
            }
            await applyCache({ notifyOnError: false });
        }, AUTO_APPLY_DELAY_MS);
    }

    function formatHistoryTitle(entry) {
        const project = entry?.project || "";
        const episode = entry?.episode || "";
        const scene = entry?.scene || "";
        const shot = entry?.shot || "";
        const label = [project, episode, scene, shot].filter(Boolean).join(" / ");
        return label || "(unnamed context)";
    }

    function formatHistorySub(entry) {
        const projectPath = entry?.project_path || "";
        const resolution = Array.isArray(entry?.resolution) ? entry.resolution.join("x") : "";
        const fps = entry?.fps ? `${entry.fps} fps` : "";
        const parts = [projectPath, resolution, fps].filter(Boolean);
        return parts.join(" | ");
    }

    function entryToPayload(entry) {
        return {
            project: entry?.project || "",
            episode: entry?.episode || "",
            scene: entry?.scene || "",
            shot: entry?.shot || "",
            width: Array.isArray(entry?.resolution) ? Number(entry.resolution[0]) || "" : "",
            height: Array.isArray(entry?.resolution) ? Number(entry.resolution[1]) || "" : "",
            fps: entry?.fps ?? "",
            project_path: entry?.project_path || "",
            note: entry?.note || "",
            lock: false,
        };
    }

    function renderHistory(items) {
        historyList.innerHTML = "";
        if (!items.length) {
            const empty = document.createElement("div");
            empty.className = "nl-wf-history-empty";
            empty.textContent = "No recent contexts yet.";
            historyList.appendChild(empty);
            return;
        }
        const limited = items.slice(0, HISTORY_LIMIT);
        for (const entry of limited) {
            const row = document.createElement("div");
            row.className = "nl-wf-history-item";
            const text = document.createElement("div");
            text.className = "nl-wf-history-text";
            const titleEl = document.createElement("div");
            titleEl.className = "nl-wf-history-title";
            titleEl.textContent = formatHistoryTitle(entry);
            const subEl = document.createElement("div");
            subEl.className = "nl-wf-history-sub";
            subEl.textContent = formatHistorySub(entry);
            text.append(titleEl, subEl);
            const applyButton = document.createElement("button");
            applyButton.textContent = "Apply";
            const deleteButton = document.createElement("button");
            deleteButton.textContent = "Del";
            deleteButton.className = "nl-wf-history-delete";
            applyButton.addEventListener("click", async () => {
                const payload = entryToPayload(entry);
                applyDefaultsToInputs(inputs, payload);
                updateStatus();
                scheduleAutoApply();
            });
            deleteButton.addEventListener("click", async () => {
                if (!entry?.id) return;
                const ok = await deleteHistoryEntry(entry.id);
                if (!ok) {
                    notifyUser("NL Workflow: failed to delete history entry.");
                    return;
                }
                await refreshHistory();
            });
            row.append(text, applyButton, deleteButton);
            historyList.appendChild(row);
        }
    }

    async function refreshHistory() {
        const result = await loadHistory();
        if (!result.ok) {
            renderHistory([]);
            return;
        }
        renderHistory(result.data || []);
    }

    function bindInput(input) {
        input.addEventListener("input", () => {
            updateStatus();
            scheduleAutoApply();
        });
        input.addEventListener("change", () => {
            updateStatus();
            scheduleAutoApply();
        });
    }

    for (const [name, input] of inputs.entries()) {
        if (name === "lock") continue;
        bindInput(input);
    }

    lockInput.addEventListener("change", () => {
        applyLockState(isLocked());
    });

    historyClear.addEventListener("click", async () => {
        const confirmed = window?.confirm
            ? window.confirm("Clear NL Workflow history?")
            : true;
        if (!confirmed) return;
        const ok = await clearHistory();
        if (!ok) {
            notifyUser("NL Workflow: failed to clear history.");
            return;
        }
        lastCommitSignature = "";
        await refreshHistory();
    });

    historyAdd.addEventListener("click", async () => {
        await commitCurrentContext();
    });

    closeButton.addEventListener("click", async () => {
        await commitCurrentContext();
        panel.style.display = "none";
    });

    let isDragging = false;
    let dragOffsetX = 0;
    let dragOffsetY = 0;

    function beginDrag(event) {
        if (event.button !== 0) return;
        if (event.target === closeButton) return;
        const rect = panel.getBoundingClientRect();
        isDragging = true;
        dragOffsetX = event.clientX - rect.left;
        dragOffsetY = event.clientY - rect.top;
        document.addEventListener("mousemove", onDrag);
        document.addEventListener("mouseup", endDrag);
        event.preventDefault();
    }

    function onDrag(event) {
        if (!isDragging) return;
        const maxX = Math.max(0, window.innerWidth - panel.offsetWidth);
        const maxY = Math.max(0, window.innerHeight - panel.offsetHeight);
        const nextLeft = Math.min(maxX, Math.max(0, event.clientX - dragOffsetX));
        const nextTop = Math.min(maxY, Math.max(0, event.clientY - dragOffsetY));
        panel.style.left = `${nextLeft}px`;
        panel.style.top = `${nextTop}px`;
        panel.style.right = "auto";
        panel.style.bottom = "auto";
    }

    function endDrag() {
        if (!isDragging) return;
        isDragging = false;
        document.removeEventListener("mousemove", onDrag);
        document.removeEventListener("mouseup", endDrag);
    }

    header.addEventListener("mousedown", beginDrag);

    function findTopBarRow() {
        const primary = document.querySelector(".mx-1.flex.flex-col.items-end.gap-1 > .flex.items-center.gap-2");
        if (primary) return primary;
        const candidates = Array.from(document.querySelectorAll(".flex.items-center.gap-2"));
        for (const candidate of candidates) {
            if (candidate.querySelector(".actionbar-container")) {
                return candidate;
            }
        }
        return null;
    }

    function mountToggle(row) {
        if (!row) return false;
        if (row.querySelector("[data-nl-workflow-wrapper='true']")) return true;

        const wrapper = document.createElement("div");
        wrapper.dataset.nlWorkflowWrapper = "true";
        wrapper.className =
            "pointer-events-auto flex h-12 shrink-0 items-center rounded-lg border border-interface-stroke bg-comfy-menu-bg px-2 shadow-interface";

        toggle.className =
            "flex items-center justify-center shrink-0 outline-hidden rounded-lg cursor-pointer p-0 size-8 text-[10px] !rounded-md border-none text-base-foreground transition-colors duration-200 ease-in-out bg-secondary-background hover:bg-secondary-background-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-background";

        wrapper.appendChild(toggle);

        const actionbar = row.querySelector(".actionbar-container");
        if (actionbar) {
            row.insertBefore(wrapper, actionbar);
        } else {
            row.appendChild(wrapper);
        }

        toggle.dataset.mounted = "true";
        return true;
    }

    const topBarRow = findTopBarRow();
    if (!mountToggle(topBarRow)) {
        document.body.appendChild(toggle);
    }

    const observer = new MutationObserver(() => {
        if (mountToggle(findTopBarRow())) {
            observer.disconnect();
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    toggle.addEventListener("click", () => {
        panel.style.display = panel.style.display === "block" ? "none" : "block";
    });

    async function initializeDefaults() {
        const result = await loadDefaultsData();
        if (result.ok) {
            applyDefaultsToInputs(inputs, result.data || {});
        }
        applyLockState(isLocked());
        updateStatus();
        await refreshHistory();
        const payload = collectDefaultsFromInputs(inputs);
        if (!missingRequiredFields(payload).length) {
            await applyCache({ notifyOnError: false });
        } else if (!result.data || Object.keys(result.data).length === 0) {
            panel.style.display = "block";
        }
    }

    initializeDefaults();
}

app.registerExtension({
    name: EXTENSION_NAME,
    async beforeRegisterNodeDef(nodeType, nodeData) {
        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            const result = onNodeCreated?.apply(this, arguments);
            if (BLACK_NODE_NAMES.has(nodeData?.name)) {
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
                const cacheWidget = this.addWidget("button", "Apply Cache", "", () => populateCache(this));
                insertWidgetAfter(this, "project_path", cacheWidget);
                attachLockHandler(this);
                setTimeout(() => populateCache(this), 0);
            }
            return result;
        };
    },
    setup() {
        const init = () => {
            if (!document.body) {
                setTimeout(init, 50);
                return;
            }
            createWorkflowPanel();
        };
        init();
    },
    init() {
        const init = () => {
            if (!document.body) {
                setTimeout(init, 50);
                return;
            }
            createWorkflowPanel();
        };
        init();
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
