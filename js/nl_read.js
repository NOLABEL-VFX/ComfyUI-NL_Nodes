import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const EXTENSION_NAME = "NOLABEL.NLReadPreview";
const NODE_NAME = "NLRead";
const STYLE_ID = "nl-read-preview-style";
const REFRESH_KEY = "__nlReadRefreshCallbacks";

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
            padding: 4px 6px;
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
            overflow: visible;
            margin-bottom: 10px;
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
    const statsState = {
        mode: "",
        kind: "",
        frameCount: null,
        fps: null,
        selectedFrames: null,
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
        if (statsState.width && statsState.height) {
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
        stats.textContent = parts.join(" | ");
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
        const current = sourceWidget.value;
        const values = current && !entries.includes(current) ? [current, ...entries] : entries;
        sourceWidget.options = sourceWidget.options || {};
        sourceWidget.options.values = values.length ? values : [""];
        if (!values.length) {
            sourceWidget.value = current || "";
        }
        node.setDirtyCanvas(true, true);
    };

    insertWidgetBefore(node, "source", controlsWidget);

    const updatePreview = async () => {
        const sourceWidget = findWidget(node, "source");
        const source = sourceWidget?.value || "";
        const skipFirst = Math.max(0, Number(findWidget(node, "skip_first")?.value || 0));
        const everyNth = Math.max(1, Number(findWidget(node, "every_nth")?.value || 1));
        const maxFrames = Math.max(0, Number(findWidget(node, "max_frames")?.value || 0));

        const url = `/nl_read/resolve?source=${encodeURIComponent(source)}&mode=auto&skip_first=${encodeURIComponent(
            skipFirst
        )}&every_nth=${encodeURIComponent(everyNth)}&max_frames=${encodeURIComponent(maxFrames)}`;
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
        statsState.width = null;
        statsState.height = null;
        statsState.duration = null;
        statsState.path = payload?.resolved_path || source;

        if (!previewUrl) {
            container.classList.remove("is-image", "is-video");
            img.removeAttribute("src");
            video.removeAttribute("src");
            statsState.mode = "";
            statsState.kind = "";
            statsState.frameCount = null;
            statsState.fps = null;
            statsState.selectedFrames = null;
            statsState.width = null;
            statsState.height = null;
            statsState.duration = null;
            statsState.path = "";
            updateStatsDisplay();
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
}

app.registerExtension({
    name: EXTENSION_NAME,
    async beforeRegisterNodeDef(nodeType, nodeData) {
        const nodeName = nodeData?.name || nodeType?.name || "";
        if (nodeName !== NODE_NAME) return;
        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            const result = onNodeCreated?.apply(this, arguments);
            attachPreview(this);
            return result;
        };
    },
});
