import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const EXTENSION_NAME = "NOLABEL.NLReadPreview";
const NODE_NAME = "NLRead";
const STYLE_ID = "nl-read-preview-style";
const REFRESH_KEY = "__nlReadRefreshCallbacks";
const READ_WIDGET_STATE_KEY = "__nlReadWidgetValues";
const READ_WIDGET_NAMES = [
    "source",
    "max_frames",
    "skip_first",
    "every_nth",
    "force_resize",
    "resize_mode",
    "resize_width",
    "resize_height",
];

function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
        .nl-read-controls {
            display: flex;
            gap: 6px;
            align-items: center;
            flex-wrap: nowrap;
            width: 100%;
            height: 28px;
            min-height: 28px;
            max-height: 28px;
            padding: 2px 6px;
            box-sizing: border-box;
            background: #0b0b0b;
            border: 1px solid #1f2937;
            border-radius: 6px;
            margin-bottom: 6px;
        }
        .nl-read-controls select,
        .nl-read-controls button,
        .nl-read-controls label {
            font-size: 11px;
        }
        .nl-read-preview {
            width: 100%;
            height: 360px;
            border-radius: 6px;
            overflow: hidden;
            background: #0b0b0b;
            border: 1px solid #1f2937;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .nl-read-preview img,
        .nl-read-preview video {
            width: 100%;
            height: 100%;
            object-fit: scale-down;
            display: none;
        }
        .nl-read-preview.is-image img {
            display: block;
        }
        .nl-read-preview.is-video video {
            display: block;
        }
        .nl-read-stats {
            width: 100%;
            min-height: 24px;
            padding: 6px 8px;
            box-sizing: border-box;
            background: #0b0b0b;
            color: #9ca3af;
            border: 1px solid #1f2937;
            border-radius: 6px;
            font-size: 11px;
            line-height: 1.35;
            white-space: normal;
            word-break: break-word;
            display: block;
            height: auto;
            max-height: 96px;
            overflow: auto;
            margin-bottom: 10px;
        }
        .nl-read-stats-strong {
            font-weight: 600;
            color: #e5e7eb;
        }
    `;
    document.head.appendChild(style);
}

function findWidget(node, name) {
    return (node.widgets || []).find((widget) => widget?.name === name);
}

function insertWidgetBefore(node, targetName, widget) {
    const widgets = node.widgets || [];
    const targetIndex = widgets.findIndex((item) => item?.name === targetName);
    if (targetIndex === -1) return;
    const widgetIndex = widgets.indexOf(widget);
    if (widgetIndex === -1) return;
    widgets.splice(widgetIndex, 1);
    widgets.splice(targetIndex, 0, widget);
}

function ensureComboWidget(node, widget) {
    if (!widget) return null;
    if (widget.type === "combo") {
        widget.options = widget.options || {};
        widget.options.values = widget.options.values || [widget.value || ""];
        return widget;
    }
    const widgetIndex = (node.widgets || []).indexOf(widget);
    if (widgetIndex === -1) return widget;
    const values = widget.options?.values || [widget.value || ""];
    const newWidget = node.addWidget("combo", widget.name, widget.value || "", () => {}, { values });
    newWidget.options = { ...(widget.options || {}), values };
    newWidget.serialize = widget.serialize;
    newWidget.options.canvasOnly = widget.options?.canvasOnly ?? newWidget.options?.canvasOnly;
    const newIndex = (node.widgets || []).indexOf(newWidget);
    if (newIndex !== -1) {
        node.widgets.splice(newIndex, 1);
    }
    node.widgets.splice(widgetIndex, 1, newWidget);
    return newWidget;
}

function persistWidgetState(node) {
    if (!node) return;
    const state = {};
    for (const name of READ_WIDGET_NAMES) {
        const widget = findWidget(node, name);
        if (!widget) continue;
        state[name] = widget.value;
    }
    node.properties = node.properties || {};
    node.properties[READ_WIDGET_STATE_KEY] = state;
}

function restoreWidgetState(node) {
    const state = node?.properties?.[READ_WIDGET_STATE_KEY];
    if (!state || typeof state !== "object") return;
    for (const name of READ_WIDGET_NAMES) {
        if (state[name] === undefined) continue;
        const widget = findWidget(node, name);
        if (!widget) continue;
        if (widget.value === state[name]) continue;
        if (widget.type === "combo") {
            const values = widget.options?.values || [];
            if (!values.includes(state[name])) {
                widget.options = widget.options || {};
                widget.options.values = [state[name], ...values];
            }
        }
        widget.value = state[name];
    }
}

function attachPreview(node) {
    ensureStyles();

    const basename = (value) => {
        if (!value) return "";
        const parts = value.split(/[\\/]/);
        return parts[parts.length - 1] || value;
    };

    const controls = document.createElement("div");
    controls.className = "nl-read-controls";

    const rootSelect = document.createElement("select");
    for (const key of ["input", "output", "temp"]) {
        const option = document.createElement("option");
        option.value = key;
        option.textContent = key;
        rootSelect.appendChild(option);
    }

    const filterSelect = document.createElement("select");
    for (const key of ["all", "images", "videos", "sequences"]) {
        const option = document.createElement("option");
        option.value = key;
        option.textContent = key;
        filterSelect.appendChild(option);
    }

    const collapseLabel = document.createElement("label");
    const collapseToggle = document.createElement("input");
    collapseToggle.type = "checkbox";
    collapseToggle.checked = true;
    collapseLabel.appendChild(collapseToggle);
    collapseLabel.appendChild(document.createTextNode(" Collapse sequences"));

    controls.appendChild(rootSelect);
    controls.appendChild(filterSelect);
    controls.appendChild(collapseLabel);

    const container = document.createElement("div");
    container.className = "nl-read-preview";

    const message = document.createElement("div");
    message.style.cssText = [
        "position: absolute",
        "bottom: 6px",
        "left: 6px",
        "right: 6px",
        "padding: 4px 6px",
        "background: rgba(0,0,0,0.6)",
        "color: #e5e7eb",
        "font-size: 11px",
        "border-radius: 4px",
        "display: none",
    ].join(";");

    const img = document.createElement("img");
    const video = document.createElement("video");
    video.muted = true;
    video.loop = true;
    video.autoplay = true;
    video.playsInline = true;

    container.appendChild(img);
    container.appendChild(video);
    container.appendChild(message);
    container.style.position = "relative";

    const controlsWidget = node.addDOMWidget("source_controls", "source_controls", controls, { serialize: false });
    controlsWidget.serialize = false;
    controlsWidget.options.canvasOnly = false;
    controlsWidget.computeSize = (width) => [width, 38];

    const widget = node.addDOMWidget("videopreview", "videopreview", container, { serialize: false });
    widget.serialize = false;
    widget.options.canvasOnly = false;
    const stats = document.createElement("div");
    stats.className = "nl-read-stats";
    stats.textContent = "No preview.";
    const statsWidget = node.addDOMWidget("preview_stats", "preview_stats", stats, { serialize: false });
    statsWidget.serialize = false;
    statsWidget.options.canvasOnly = false;
    const baseNodeHeight = Math.max(node.size[1], 540);
    const statsMetrics = { lastHeight: 28 };
    const statsSpacing = 10;
    const measureStatsHeight = (width) => {
        const targetWidth = width || node.size[0] || 300;
        const previousWidth = stats.style.width;
        stats.style.width = `${targetWidth}px`;
        stats.style.height = "auto";
        const measured = stats.scrollHeight || stats.getBoundingClientRect().height || 0;
        const height = Math.max(24, measured + 2 + statsSpacing);
        stats.style.width = previousWidth;
        return height;
    };
    const syncStatsHeight = () => {
        const desired = measureStatsHeight(node.size[0]);
        if (desired === statsMetrics.lastHeight) return;
        const delta = desired - statsMetrics.lastHeight;
        const nextHeight = Math.max(baseNodeHeight, node.size[1] + delta);
        statsMetrics.lastHeight = desired;
        if (nextHeight !== node.size[1]) {
            node.setSize([node.size[0], nextHeight]);
            node.setDirtyCanvas(true, true);
        }
    };
    statsWidget.computeSize = (width) => [width, measureStatsHeight(width)];
    if (node.size[1] < 540) {
        node.setSize([node.size[0], 540]);
    }

    let lastResolve = null;
    let sourceWidget = ensureComboWidget(node, findWidget(node, "source"));
    restoreWidgetState(node);
    const saveState = () => persistWidgetState(node);
    const readState = (node.__nlReadState ||= { pinnedSource: "" });
    const storedPinned = node.properties?.__nlReadPinnedSource;
    if (storedPinned && !readState.pinnedSource) {
        readState.pinnedSource = storedPinned;
    }
    if (sourceWidget && (!sourceWidget.value || sourceWidget.value === "null") && readState.pinnedSource) {
        sourceWidget.value = readState.pinnedSource;
    }
    const resizeModeWidget = findWidget(node, "force_resize");
    const resizeStrategyWidget = findWidget(node, "resize_mode");
    const resizeWidthWidget = findWidget(node, "resize_width");
    const resizeHeightWidget = findWidget(node, "resize_height");
    const updateResizeFields = () => {
        const resizeMode = resizeModeWidget?.value || "none";
        const isCustom = resizeMode === "custom";
        const showStrategy = resizeMode !== "none";
        if (resizeWidthWidget) {
            resizeWidthWidget.hidden = !isCustom;
            resizeWidthWidget.disabled = !isCustom;
        }
        if (resizeHeightWidget) {
            resizeHeightWidget.hidden = !isCustom;
            resizeHeightWidget.disabled = !isCustom;
        }
        if (resizeStrategyWidget) {
            resizeStrategyWidget.hidden = !showStrategy;
            resizeStrategyWidget.disabled = !showStrategy;
        }
        node.setDirtyCanvas(true, true);
    };
    const updateFrameControls = () => {
        const isImage = (statsState.mode || statsState.kind) === "image";
        for (const widgetName of ["max_frames", "skip_first", "every_nth"]) {
            const widget = findWidget(node, widgetName);
            if (!widget) continue;
            widget.hidden = isImage;
            widget.disabled = isImage;
        }
        node.setDirtyCanvas(true, true);
    };
    const statsState = {
        mode: "",
        kind: "",
        frameCount: null,
        fps: null,
        selectedFrames: null,
        resizeTo: null,
        width: null,
        height: null,
        duration: null,
        path: "",
    };

    const updateStatsDisplay = () => {
        const mode = statsState.mode || statsState.kind;
        if (!mode) {
            stats.textContent = "No preview.";
            requestAnimationFrame(syncStatsHeight);
            return;
        }
        const label =
            mode === "sequence" ? "Sequence" : mode === "video" ? "Video" : mode === "image" ? "Image" : "Media";
        const parts = [label];
        const resizeTo = statsState.resizeTo;
        if (resizeTo && Array.isArray(resizeTo) && resizeTo.length === 2) {
            parts.push(`${resizeTo[0]}x${resizeTo[1]}`);
        } else if (statsState.width && statsState.height) {
            parts.push(`${statsState.width}x${statsState.height}`);
        }
        if (mode === "sequence" && Number.isFinite(statsState.frameCount)) {
            parts.push(`${statsState.frameCount} frames`);
            if (
                Number.isFinite(statsState.selectedFrames) &&
                statsState.selectedFrames !== statsState.frameCount
            ) {
                parts.push(`selected ${statsState.selectedFrames}`);
            }
        }
        if (mode === "video") {
            if (Number.isFinite(statsState.fps)) {
                parts.push(`${statsState.fps.toFixed(2)} fps`);
            }
            if (Number.isFinite(statsState.frameCount)) {
                parts.push(`${statsState.frameCount} frames`);
            }
            if (
                Number.isFinite(statsState.selectedFrames) &&
                Number.isFinite(statsState.frameCount) &&
                statsState.selectedFrames !== statsState.frameCount
            ) {
                parts.push(`selected ${statsState.selectedFrames}`);
            }
        }
        if (mode === "video" && Number.isFinite(statsState.duration)) {
            parts.push(`${statsState.duration.toFixed(2)}s`);
        }
        if (statsState.path) {
            parts.push(basename(statsState.path));
        }
        stats.innerHTML = "";
        parts.forEach((part, index) => {
            if (index === 0) {
                const strong = document.createElement("span");
                strong.className = "nl-read-stats-strong";
                strong.textContent = part;
                stats.appendChild(strong);
            } else {
                stats.appendChild(document.createTextNode(" | " + part));
            }
        });
        requestAnimationFrame(syncStatsHeight);
    };

    img.addEventListener("load", () => {
        statsState.width = img.naturalWidth || null;
        statsState.height = img.naturalHeight || null;
        updateStatsDisplay();
    });

    video.addEventListener("loadedmetadata", () => {
        statsState.width = video.videoWidth || null;
        statsState.height = video.videoHeight || null;
        statsState.duration = Number.isFinite(video.duration) ? video.duration : null;
        updateStatsDisplay();
    });

    const refreshList = async () => {
        const root = rootSelect.value || "input";
        const filter = filterSelect.value || "all";
        const collapse = collapseToggle.checked ? "1" : "0";
        const response = await api.fetchApi(
            `/nl_read/list?root=${encodeURIComponent(root)}&filter=${encodeURIComponent(filter)}&collapse=${collapse}`
        );
        if (!response.ok) {
            return;
        }
        const payload = await response.json();
        const items = payload?.items || [];
        const entries = items.map((item) => item.path);
        if (!sourceWidget) {
            return;
        }
        const widgetValue = sourceWidget.value;
        const current =
            widgetValue && widgetValue !== "null"
                ? widgetValue
                : readState.pinnedSource || "";
        const values = current && !entries.includes(current) ? [current, ...entries] : entries;
        sourceWidget.options = sourceWidget.options || {};
        sourceWidget.options.values = values.length ? values : [""];
        if (current && sourceWidget.value !== current) {
            sourceWidget.value = current;
            saveState();
        } else if (!values.length) {
            sourceWidget.value = "";
            saveState();
        }
        node.setDirtyCanvas(true, true);
    };

    insertWidgetBefore(node, "source", controlsWidget);

    const updatePreview = async () => {
        const sourceWidget = findWidget(node, "source");
        const sourceValue = sourceWidget?.value;
        const source =
            sourceValue && sourceValue !== "null" ? sourceValue : readState.pinnedSource || "";
        const skipFirstWidget = findWidget(node, "skip_first");
        const everyNthWidget = findWidget(node, "every_nth");
        const maxFramesWidget = findWidget(node, "max_frames");
        const readNumber = (widget, fallback) => {
            if (!widget) return fallback;
            const parsed = Number(widget.value);
            if (!Number.isFinite(parsed)) {
                widget.value = fallback;
                return fallback;
            }
            return parsed;
        };
        const skipFirst = Math.max(0, readNumber(skipFirstWidget, 0));
        const everyNth = Math.max(1, readNumber(everyNthWidget, 1));
        const maxFrames = Math.max(0, readNumber(maxFramesWidget, 120));
        const resizeModeValues = resizeModeWidget?.options?.values || ["none", "context", "custom"];
        const resizeMode = resizeModeValues.includes(resizeModeWidget?.value)
            ? resizeModeWidget?.value
            : "none";
        if (resizeModeWidget && resizeModeWidget.value !== resizeMode) {
            resizeModeWidget.value = resizeMode;
        }
        const resizeStrategyValues = resizeStrategyWidget?.options?.values || ["stretch", "fit", "fill"];
        const resizeStrategy = resizeStrategyValues.includes(resizeStrategyWidget?.value)
            ? resizeStrategyWidget?.value
            : "stretch";
        if (resizeStrategyWidget && resizeStrategyWidget.value !== resizeStrategy) {
            resizeStrategyWidget.value = resizeStrategy;
        }
        const resizeWidth = Math.max(0, readNumber(resizeWidthWidget, 0));
        const resizeHeight = Math.max(0, readNumber(resizeHeightWidget, 0));

        const url = `/nl_read/resolve?source=${encodeURIComponent(source)}&mode=auto&skip_first=${encodeURIComponent(
            skipFirst
        )}&every_nth=${encodeURIComponent(everyNth)}&max_frames=${encodeURIComponent(
            maxFrames
        )}&force_resize=${encodeURIComponent(resizeMode)}&resize_mode=${encodeURIComponent(
            resizeStrategy
        )}&resize_w=${encodeURIComponent(resizeWidth)}&resize_h=${encodeURIComponent(resizeHeight)}`;
        const response = await api.fetchApi(url);
        if (!response.ok) {
            return;
        }
        const payload = await response.json();
        lastResolve = payload;
        const previewUrl = payload?.url || "";
        const kind = payload?.kind || "image";
        const blockedReason = payload?.blocked_reason || "";
        statsState.mode = payload?.mode || kind;
        statsState.kind = kind;
        statsState.frameCount = payload?.stats?.frame_count ?? null;
        statsState.fps = payload?.stats?.fps ?? null;
        statsState.selectedFrames = payload?.stats?.selected_frames ?? null;
        statsState.resizeTo = payload?.stats?.resize_to || null;
        statsState.width = null;
        statsState.height = null;
        statsState.duration = null;
        statsState.path = payload?.resolved_path || source;
        if (payload?.resolved_path) {
            readState.pinnedSource = payload.resolved_path;
            node.properties = node.properties || {};
            node.properties.__nlReadPinnedSource = payload.resolved_path;
            if (sourceWidget && sourceWidget.value !== payload.resolved_path) {
                sourceWidget.value = payload.resolved_path;
                saveState();
            }
        }

        updateFrameControls();

        if (!previewUrl) {
            container.classList.remove("is-image", "is-video");
            img.removeAttribute("src");
            video.removeAttribute("src");
            statsState.mode = "";
            statsState.kind = "";
            statsState.frameCount = null;
            statsState.fps = null;
            statsState.selectedFrames = null;
            statsState.resizeTo = null;
            statsState.width = null;
            statsState.height = null;
            statsState.duration = null;
            statsState.path = "";
            updateStatsDisplay();
            updateFrameControls();
            if (blockedReason) {
                message.textContent = blockedReason;
                message.style.display = "block";
            } else {
                message.textContent = "";
                message.style.display = "none";
            }
            return;
        }

        const cacheUrl = previewUrl + (previewUrl.includes("?") ? "&" : "?") + "t=" + Date.now();
        if (kind === "video") {
            container.classList.add("is-video");
            container.classList.remove("is-image");
            if (video.src !== cacheUrl) {
                video.src = cacheUrl;
                video.load();
            }
        } else {
            container.classList.add("is-image");
            container.classList.remove("is-video");
            img.src = cacheUrl;
        }
        message.textContent = "";
        message.style.display = "none";
        updateStatsDisplay();
    };

    if (sourceWidget) {
        const original = sourceWidget.callback;
        sourceWidget.callback = function () {
            if (typeof original === "function") {
                original.apply(this, arguments);
            }
            if (sourceWidget.value === "") {
                readState.pinnedSource = "";
                if (node.properties) {
                    node.properties.__nlReadPinnedSource = "";
                }
            } else {
                readState.pinnedSource = sourceWidget.value || readState.pinnedSource;
                node.properties = node.properties || {};
                node.properties.__nlReadPinnedSource = readState.pinnedSource;
            }
            saveState();
            updatePreview();
        };
    }

    if (resizeModeWidget) {
        const original = resizeModeWidget.callback;
        resizeModeWidget.callback = function () {
            if (typeof original === "function") {
                original.apply(this, arguments);
            }
            updateResizeFields();
            saveState();
            updatePreview();
        };
        updateResizeFields();
    }

    if (resizeStrategyWidget) {
        const original = resizeStrategyWidget.callback;
        resizeStrategyWidget.callback = function () {
            if (typeof original === "function") {
                original.apply(this, arguments);
            }
            saveState();
            updatePreview();
        };
    }

    for (const widgetName of ["skip_first", "every_nth", "max_frames"]) {
        const widget = findWidget(node, widgetName);
        if (!widget) continue;
        const original = widget.callback;
        widget.callback = function () {
            if (typeof original === "function") {
                original.apply(this, arguments);
            }
            saveState();
            updatePreview();
        };
    }

    for (const widgetName of ["resize_width", "resize_height"]) {
        const widget = findWidget(node, widgetName);
        if (!widget) continue;
        const original = widget.callback;
        widget.callback = function () {
            if (typeof original === "function") {
                original.apply(this, arguments);
            }
            saveState();
            updatePreview();
        };
    }

    rootSelect.addEventListener("change", refreshList);
    filterSelect.addEventListener("change", refreshList);
    collapseToggle.addEventListener("change", refreshList);

    const cacheUpdatedHandler = () => {
        refreshList();
        updatePreview();
    };
    window.addEventListener("nl-workflow-cache-updated", cacheUpdatedHandler);
    const refreshRegistry = (window[REFRESH_KEY] ||= new Set());
    refreshRegistry.add(cacheUpdatedHandler);

    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.multiple = true;
    fileInput.style.display = "none";
    document.body.appendChild(fileInput);

    const uploadFiles = async (files, target) => {
        if (!files || !files.length) return;
        const form = new FormData();
        for (const file of files) {
            form.append("file", file, file.name);
        }
        const response = await api.fetchApi(`/nl_read/upload?target=${encodeURIComponent(target)}`, {
            method: "POST",
            body: form,
        });
        if (!response.ok) {
            message.textContent = "Upload failed. Check server logs.";
            message.style.display = "block";
            return;
        }
        const payload = await response.json();
        const saved = payload?.saved || [];
        if (saved.length && sourceWidget) {
            sourceWidget.value = saved[0];
            if (typeof sourceWidget.callback === "function") {
                sourceWidget.callback(sourceWidget.value);
            }
            saveState();
        }
    };

    fileInput.addEventListener("change", async () => {
        const target = fileInput.dataset.target || "project_input";
        await uploadFiles(fileInput.files, target);
        fileInput.value = "";
    });

    node.addWidget("button", "Upload Images", "", async () => {
        await updatePreview();
        const hasContext = Boolean(lastResolve?.has_context);
        let target = "project_input";
        if (!hasContext) {
            const useDefault = window.confirm(
                "No NL Workflow context found. Upload to default ComfyUI input folder instead?"
            );
            if (!useDefault) return;
            target = "default_input";
        }
        fileInput.dataset.target = target;
        fileInput.click();
    });

    setTimeout(() => {
        refreshList();
        updatePreview();
        saveState();
    }, 0);

    const onRemoved = node.onRemoved;
    node.onRemoved = function () {
        window.removeEventListener("nl-workflow-cache-updated", cacheUpdatedHandler);
        refreshRegistry.delete(cacheUpdatedHandler);
        if (typeof onRemoved === "function") {
            onRemoved.apply(this, arguments);
        }
    };

    requestAnimationFrame(refreshList);
    requestAnimationFrame(updatePreview);

    node.__nlReadUI = {
        restoreState: () => restoreWidgetState(node),
        saveState,
        updatePreview,
    };
}

app.registerExtension({
    name: EXTENSION_NAME,
    async beforeRegisterNodeDef(nodeType, nodeData) {
        const nodeName = nodeData?.name || nodeType?.name || "";
        if (nodeName !== NODE_NAME) return;
        const onNodeCreated = nodeType.prototype.onNodeCreated;
        const onConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onNodeCreated = function () {
            const result = onNodeCreated?.apply(this, arguments);
            attachPreview(this);
            return result;
        };
        nodeType.prototype.onConfigure = function () {
            const result = onConfigure?.apply(this, arguments);
            this.__nlReadUI?.restoreState?.();
            this.__nlReadUI?.updatePreview?.();
            return result;
        };
    },
});
