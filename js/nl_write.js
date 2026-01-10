import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const EXTENSION_NAME = "NOLABEL.NLWritePreview";
const NODE_NAME = "NLWrite";
const STYLE_ID = "nl-write-preview-style";
const NL_WRITE_NODES = new Set();
const WRITE_WIDGET_STATE_KEY = "__nlWriteWidgetValues";
const WRITE_WIDGET_NAMES = [
    "mode",
    "name",
    "single_extension",
    "sequence_save_png",
    "sequence_save_mp4",
    "sequence_save_mov",
    "sequence_mp4_crf",
    "sequence_mp4_preset",
    "sequence_mov_profile",
];
let GLOBAL_LISTENER_ATTACHED = false;
let LAST_GLOBAL_FETCH_AT = 0;
let LAST_PAYLOAD_SIGNATURE = "";

function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
        .nl-write-panel {
            display: flex;
            flex-direction: column;
            width: 100%;
            height: 100%;
            gap: 8px;
        }
        .nl-write-preview {
            width: 100%;
            height: 100%;
            border-radius: 6px;
            overflow: hidden;
            background: #0b0b0b;
            border: 1px solid #1f2937;
            display: flex;
            align-items: center;
            justify-content: center;
            position: relative;
            flex: 1 1 auto;
            min-height: 0;
        }
        .nl-write-preview img,
        .nl-write-preview video {
            width: 100%;
            height: 100%;
            object-fit: scale-down;
            display: none;
        }
        .nl-write-preview.is-image img {
            display: block;
        }
        .nl-write-preview.is-video video {
            display: block;
        }
        .nl-write-preview .nl-write-message {
            display: none;
        }
        .nl-write-meta {
            width: 100%;
            min-height: 36px;
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
            margin-top: 8px;
            margin-top: auto;
            max-height: 96px;
            overflow: auto;
        }
        .nl-write-meta .nl-write-stats {
            display: block;
            font-weight: 600;
            color: #e5e7eb;
            margin-bottom: 4px;
        }
        .nl-write-meta .nl-write-path {
            display: block;
            margin-top: 4px;
            color: #9ca3af;
        }
        .nl-write-controls {
            display: flex;
            flex-direction: column;
            gap: 8px;
            padding: 8px;
            border-radius: 6px;
            border: 1px solid #2e2e2e;
            background: #0b0b0b;
            color: #e6e6e6;
            font-family: "IBM Plex Mono", "Courier New", monospace;
            font-size: 11px;
        }
        .nl-write-controls .nl-write-group {
            display: flex;
            flex-direction: column;
            gap: 8px;
        }
        .nl-write-controls .nl-write-group-title {
            font-size: 10px;
            color: #9aa0a6;
        }
        .nl-write-controls .nl-write-row {
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .nl-write-controls .nl-write-row label {
            min-width: 86px;
            color: #9aa0a6;
            font-size: 10px;
        }
        .nl-write-controls input[type="text"],
        .nl-write-controls select {
            flex: 1 1 auto;
            background: #111;
            color: #e6e6e6;
            border: 1px solid #333;
            border-radius: 4px;
            padding: 4px 6px;
            outline: none;
            font-size: 11px;
        }
        .nl-write-controls input[type="text"]::placeholder {
            color: #6b7280;
        }
        .nl-write-controls .nl-write-segmented {
            display: flex;
            background: #111;
            border: 1px solid #333;
            border-radius: 6px;
            overflow: hidden;
            flex: 1 1 auto;
        }
        .nl-write-controls .nl-write-segmented button {
            flex: 1 1 0;
            background: #1e1e1e;
            border: 0;
            color: #bdbdbd;
            padding: 4px 8px;
            cursor: pointer;
            font-size: 11px;
        }
        .nl-write-controls .nl-write-segmented button.is-active {
            background: #3a3a3a;
            color: #fff;
        }
        .nl-write-controls .nl-write-toggle {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 4px 8px;
            border-radius: 4px;
            border: 1px solid #444;
            background: #2a2a2a;
            color: #f0f0f0;
            cursor: pointer;
            font-size: 11px;
        }
        .nl-write-controls .nl-write-toggle.is-active {
            border-color: #555;
            background: #3a3a3a;
            color: #fff;
        }
        .nl-write-controls .nl-write-toggle[disabled] {
            cursor: not-allowed;
            opacity: 0.5;
        }
        .nl-write-controls .nl-write-range {
            flex: 1 1 auto;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .nl-write-controls input[type="range"] {
            flex: 1 1 auto;
        }
        .nl-write-controls .nl-write-range-value {
            width: 36px;
            text-align: right;
            font-variant-numeric: tabular-nums;
            color: #e6e6e6;
        }
        .nl-write-controls .nl-write-hint {
            font-size: 11px;
            color: #6b7280;
        }
    `;
    document.head.appendChild(style);
}

function findWidget(node, name) {
    return (node.widgets || []).find((widget) => widget?.name === name);
}

function persistWidgetState(node) {
    if (!node) return;
    const state = {};
    for (const name of WRITE_WIDGET_NAMES) {
        const widget = findWidget(node, name);
        if (!widget) continue;
        state[name] = widget.value;
    }
    node.properties = node.properties || {};
    node.properties[WRITE_WIDGET_STATE_KEY] = state;
}

function restoreWidgetState(node) {
    const state = node?.properties?.[WRITE_WIDGET_STATE_KEY];
    if (!state || typeof state !== "object") return;
    for (const name of WRITE_WIDGET_NAMES) {
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

    if (node?.__nlWriteUI?.applyPayload) {
        NL_WRITE_NODES.add(node);
        return;
    }

    const panel = document.createElement("div");
    panel.className = "nl-write-panel";

    const container = document.createElement("div");
    container.className = "nl-write-preview";

    const img = document.createElement("img");
    const video = document.createElement("video");
    video.muted = true;
    video.loop = true;
    video.autoplay = true;
    video.playsInline = true;

    container.appendChild(img);
    container.appendChild(video);

    const previewWidget = node.addDOMWidget("nlwrite_preview", "nlwrite_preview", panel, { serialize: false });
    previewWidget.serialize = false;
    previewWidget.options.canvasOnly = false;

    const meta = document.createElement("div");
    meta.className = "nl-write-meta";
    const stats = document.createElement("div");
    stats.className = "nl-write-stats";
    stats.textContent = "No preview.";
    const pathEl = document.createElement("div");
    pathEl.className = "nl-write-path";
    pathEl.textContent = "No output yet.";
    meta.appendChild(stats);
    meta.appendChild(pathEl);
    panel.appendChild(container);
    panel.appendChild(meta);

    const panelState = { controlsHeight: 200 };
    const getWidgetMargin = () => {
        const margin = window?.LiteGraph?.NODE_WIDGET_MARGIN;
        return Number.isFinite(margin) ? margin : 4;
    };
    const getDefaultWidgetHeight = () => {
        const height = window?.LiteGraph?.NODE_WIDGET_HEIGHT;
        return Number.isFinite(height) ? height : 20;
    };
    const estimateControlsHeight = () => {
        const width = node.size?.[0] || 300;
        const widgets = node.widgets || [];
        const margin = getWidgetMargin();
        let total = 0;
        let count = 0;
        for (const widget of widgets) {
            if (widget === previewWidget) continue;
            if (widget.hidden) continue;
            if (typeof widget.computeSize === "function") {
                const size = widget.computeSize(width);
                total += size?.[1] || 0;
            } else if (Number.isFinite(widget?.height)) {
                total += widget.height;
            } else {
                total += getDefaultWidgetHeight();
            }
            count += 1;
        }
        const padding = margin * 2;
        panelState.controlsHeight = total + count * margin + padding;
    };
    const getTitleHeight = () => {
        const titleHeight = window?.LiteGraph?.NODE_TITLE_HEIGHT;
        return Number.isFinite(titleHeight) ? titleHeight : 24;
    };
    const computePanelHeight = () => {
        const baseHeight = node.size?.[1] || 560;
        const available = baseHeight - panelState.controlsHeight - getTitleHeight();
        return Math.max(0, Math.floor(available));
    };
    const requestLayout = () => {
        node.setDirtyCanvas(true, true);
    };
    previewWidget.computeSize = (width) => {
        estimateControlsHeight();
        return [width, computePanelHeight()];
    };
    estimateControlsHeight();
    requestLayout();

    const buildControlsUI = () => {
        const controls = document.createElement("div");
        controls.className = "nl-write-controls";

        const createGroup = (title) => {
            const group = document.createElement("div");
            group.className = "nl-write-group";
            const label = document.createElement("div");
            label.className = "nl-write-group-title";
            label.textContent = title;
            group.appendChild(label);
            controls.appendChild(group);
            return group;
        };

        const createRow = (labelText, contentEl) => {
            const row = document.createElement("div");
            row.className = "nl-write-row";
            const label = document.createElement("label");
            label.textContent = labelText;
            row.appendChild(label);
            row.appendChild(contentEl);
            return row;
        };

        const basicsGroup = createGroup("Basics");
        const nameInput = document.createElement("input");
        nameInput.type = "text";
        nameInput.placeholder = "Base name";
        basicsGroup.appendChild(createRow("Name", nameInput));

        const modeRow = document.createElement("div");
        modeRow.className = "nl-write-segmented";
        const modeSingle = document.createElement("button");
        modeSingle.type = "button";
        modeSingle.textContent = "Single";
        const modeSequence = document.createElement("button");
        modeSequence.type = "button";
        modeSequence.textContent = "Sequence";
        modeRow.appendChild(modeSingle);
        modeRow.appendChild(modeSequence);
        basicsGroup.appendChild(createRow("Mode", modeRow));

        const singleGroup = createGroup("Single Output");
        const singleExtensionSelect = document.createElement("select");
        singleGroup.appendChild(createRow("Format", singleExtensionSelect));

        const sequenceGroup = createGroup("Sequence Outputs");
        const sequenceRow = document.createElement("div");
        sequenceRow.style.display = "flex";
        sequenceRow.style.gap = "8px";
        const togglePng = document.createElement("button");
        togglePng.type = "button";
        togglePng.className = "nl-write-toggle";
        togglePng.textContent = "PNG";
        const toggleMp4 = document.createElement("button");
        toggleMp4.type = "button";
        toggleMp4.className = "nl-write-toggle";
        toggleMp4.textContent = "MP4";
        const toggleMov = document.createElement("button");
        toggleMov.type = "button";
        toggleMov.className = "nl-write-toggle";
        toggleMov.textContent = "MOV";
        sequenceRow.appendChild(togglePng);
        sequenceRow.appendChild(toggleMp4);
        sequenceRow.appendChild(toggleMov);
        sequenceGroup.appendChild(createRow("Save", sequenceRow));

        const encodingGroup = createGroup("Encoding");
        const crfWrap = document.createElement("div");
        crfWrap.className = "nl-write-range";
        const crfInput = document.createElement("input");
        crfInput.type = "range";
        crfInput.min = "0";
        crfInput.max = "51";
        const crfValue = document.createElement("div");
        crfValue.className = "nl-write-range-value";
        crfValue.textContent = "23";
        crfWrap.appendChild(crfInput);
        crfWrap.appendChild(crfValue);
        encodingGroup.appendChild(createRow("CRF", crfWrap));

        const presetSelect = document.createElement("select");
        encodingGroup.appendChild(createRow("MP4", presetSelect));

        const movProfileSelect = document.createElement("select");
        encodingGroup.appendChild(createRow("MOV", movProfileSelect));

        const controlsWidget = node.addDOMWidget("nlwrite_controls", "nlwrite_controls", controls, {
            serialize: false,
        });
        controlsWidget.serialize = false;
        controlsWidget.options.canvasOnly = false;

        const widgetMap = {
            name: findWidget(node, "name"),
            mode: findWidget(node, "mode"),
            singleExtension: findWidget(node, "single_extension"),
            sequencePng: findWidget(node, "sequence_save_png"),
            sequenceMp4: findWidget(node, "sequence_save_mp4"),
            sequenceMov: findWidget(node, "sequence_save_mov"),
            mp4Crf: findWidget(node, "sequence_mp4_crf"),
            mp4Preset: findWidget(node, "sequence_mp4_preset"),
            movProfile: findWidget(node, "sequence_mov_profile"),
        };

        const setWidgetValue = (widget, value, options = {}) => {
            if (!widget) return;
            const callCallback = options.callCallback !== false;
            widget.value = value;
            if (callCallback && typeof widget.callback === "function") {
                widget.callback(value);
            }
            node.setDirtyCanvas(true, true);
            node.__nlWriteUI?.saveState?.();
        };

        const updateSelectOptions = (select, widget) => {
            const values = widget?.options?.values || [];
            if (!values.length) return;
            select.innerHTML = "";
            for (const value of values) {
                const option = document.createElement("option");
                option.value = value;
                option.textContent = String(value).toUpperCase();
                select.appendChild(option);
            }
        };

        const syncDisabledState = (options = {}) => {
            const encodingDisabled = Boolean(options.encodingDisabled);
            const map = [
                [nameInput, widgetMap.name],
                [singleExtensionSelect, widgetMap.singleExtension],
                [modeSingle, widgetMap.mode],
                [modeSequence, widgetMap.mode],
                [togglePng, widgetMap.sequencePng],
                [toggleMp4, widgetMap.sequenceMp4],
                [toggleMov, widgetMap.sequenceMov],
                [crfInput, widgetMap.mp4Crf],
                [presetSelect, widgetMap.mp4Preset],
                [movProfileSelect, widgetMap.movProfile],
            ];
            for (const [element, widget] of map) {
                if (!element) continue;
                const disabled =
                    Boolean(widget?.disabled) ||
                    (encodingDisabled && (element === crfInput || element === presetSelect || element === movProfileSelect));
                element.disabled = disabled;
                if (element.classList?.contains("nl-write-toggle")) {
                    if (disabled) {
                        element.setAttribute("disabled", "disabled");
                    } else {
                        element.removeAttribute("disabled");
                    }
                }
            }
        };

        const syncFromWidgets = () => {
            if (widgetMap.name) {
                nameInput.value = widgetMap.name.value ?? "";
            }
            const modeValue = widgetMap.mode?.value === "sequence" ? "sequence" : "single";
            modeSingle.classList.toggle("is-active", modeValue === "single");
            modeSequence.classList.toggle("is-active", modeValue === "sequence");
            singleGroup.style.display = modeValue === "single" ? "flex" : "none";
            sequenceGroup.style.display = modeValue === "sequence" ? "flex" : "none";
            encodingGroup.style.display = modeValue === "sequence" ? "flex" : "none";

            updateSelectOptions(singleExtensionSelect, widgetMap.singleExtension);
            if (widgetMap.singleExtension) {
                singleExtensionSelect.value = widgetMap.singleExtension.value ?? "";
            }

            togglePng.classList.toggle("is-active", Boolean(widgetMap.sequencePng?.value));
            toggleMp4.classList.toggle("is-active", Boolean(widgetMap.sequenceMp4?.value));
            toggleMov.classList.toggle("is-active", Boolean(widgetMap.sequenceMov?.value));

            if (widgetMap.mp4Crf) {
                const value = Number(widgetMap.mp4Crf.value ?? 23);
                crfInput.value = Number.isFinite(value) ? String(value) : "23";
                crfValue.textContent = crfInput.value;
            }
            updateSelectOptions(presetSelect, widgetMap.mp4Preset);
            if (widgetMap.mp4Preset) {
                presetSelect.value = widgetMap.mp4Preset.value ?? "";
            }
            updateSelectOptions(movProfileSelect, widgetMap.movProfile);
            if (widgetMap.movProfile) {
                movProfileSelect.value = widgetMap.movProfile.value ?? "";
            }

            const encodingEnabled = Boolean(widgetMap.sequenceMp4?.value || widgetMap.sequenceMov?.value);
            syncDisabledState({ encodingDisabled: !encodingEnabled });
        };

        const updateControlsHeight = () => {
            return Math.ceil(controls.scrollHeight) + 6;
        };

        modeSingle.addEventListener("click", () => {
            setWidgetValue(widgetMap.mode, "single");
        });
        modeSequence.addEventListener("click", () => {
            setWidgetValue(widgetMap.mode, "sequence");
        });
        nameInput.addEventListener("change", () => {
            setWidgetValue(widgetMap.name, nameInput.value);
        });
        singleExtensionSelect.addEventListener("change", () => {
            setWidgetValue(widgetMap.singleExtension, singleExtensionSelect.value);
        });
        togglePng.addEventListener("click", () => {
            setWidgetValue(widgetMap.sequencePng, !widgetMap.sequencePng?.value);
        });
        toggleMp4.addEventListener("click", () => {
            setWidgetValue(widgetMap.sequenceMp4, !widgetMap.sequenceMp4?.value);
        });
        toggleMov.addEventListener("click", () => {
            setWidgetValue(widgetMap.sequenceMov, !widgetMap.sequenceMov?.value);
        });
        crfInput.addEventListener("input", () => {
            const value = Number(crfInput.value);
            crfValue.textContent = crfInput.value;
            setWidgetValue(widgetMap.mp4Crf, value, { callCallback: false });
        });
        crfInput.addEventListener("change", () => {
            const value = Number(crfInput.value);
            setWidgetValue(widgetMap.mp4Crf, value, { callCallback: true });
        });
        presetSelect.addEventListener("change", () => {
            setWidgetValue(widgetMap.mp4Preset, presetSelect.value);
        });
        movProfileSelect.addEventListener("change", () => {
            setWidgetValue(widgetMap.movProfile, movProfileSelect.value);
        });

        controlsWidget.computeSize = (width) => {
            const height = updateControlsHeight();
            return [width, height];
        };

        syncFromWidgets();
        updateControlsHeight();

        return {
            controlsWidget,
            syncFromWidgets,
            updateControlsHeight,
            widgetMap,
            groups: { singleGroup, sequenceGroup, encodingGroup },
        };
    };

    const statsState = {
        mode: "",
        kind: "",
        frameCount: null,
        fps: null,
        width: null,
        height: null,
        extension: "",
        outputs: [],
        path: "",
    };

    const updateStatsDisplay = () => {
        const mode = statsState.mode || statsState.kind;
        if (!mode) {
            stats.textContent = "No preview.";
            return;
        }
        const label = mode === "sequence" ? "Sequence" : "Image";
        const parts = [label];
        if (statsState.width && statsState.height) {
            parts.push(`${statsState.width}x${statsState.height}`);
        }
        if (mode === "sequence") {
            if (Number.isFinite(statsState.frameCount)) {
                parts.push(`${statsState.frameCount} frames`);
            }
            if (Number.isFinite(statsState.fps)) {
                parts.push(`${statsState.fps.toFixed(2)} fps`);
            }
        } else if (statsState.extension) {
            parts.push(statsState.extension.toUpperCase());
        }
        if (Array.isArray(statsState.outputs) && statsState.outputs.length) {
            parts.push(statsState.outputs.join(", "));
        }
        if (statsState.path) {
            const basename = statsState.path.split(/[\\/]/).pop() || statsState.path;
            parts.push(basename);
        }
        stats.textContent = parts.join(" | ");
    };

    img.addEventListener("load", () => {
        statsState.width = img.naturalWidth || null;
        statsState.height = img.naturalHeight || null;
        updateStatsDisplay();
    });

    video.addEventListener("loadedmetadata", () => {
        statsState.width = video.videoWidth || null;
        statsState.height = video.videoHeight || null;
        updateStatsDisplay();
    });

    const extractPayload = (output) => {
        if (!output) return null;
        if (output.ui?.nlwrite) return output.ui.nlwrite;
        if (output.nlwrite) return output.nlwrite;
        if (output.ui?.output?.nlwrite) return output.ui.output.nlwrite;
        if (output.outputs?.ui?.nlwrite) return output.outputs.ui.nlwrite;
        if (output.outputs?.nlwrite) return output.outputs.nlwrite;
        if (output.output?.ui?.nlwrite) return output.output.ui.nlwrite;
        if (output.output?.nlwrite) return output.output.nlwrite;
        if (output.output?.outputs?.nlwrite) return output.output.outputs.nlwrite;
        if (output.output?.outputs?.ui?.nlwrite) return output.output.outputs.ui.nlwrite;
        return null;
    };

    let lastFetchAt = 0;
    const fetchLastPayload = async () => {
        const now = Date.now();
        if (now - lastFetchAt < 500) return null;
        lastFetchAt = now;
        try {
            const response = await api.fetchApi("/nl_write/last");
            if (!response.ok) return null;
            const data = await response.json();
            return data?.payload || null;
        } catch (err) {
            console.warn("[NL Write] Failed to fetch last payload", err);
            return null;
        }
    };

    const applyPayload = (payload) => {
        if (!payload) return;
        const url = payload.preview_url || payload.url || "";
        const kind = payload.preview_kind || (url.includes("anim=1") ? "video" : "image");
        const summary = payload.summary || "";
        const savePath = payload.save_path || payload.savePath || "";
        const statsPayload = payload.stats || {};
        const outputs = Array.isArray(statsPayload.outputs) ? statsPayload.outputs : [];
        const logParts = [];

        container.classList.toggle("is-image", kind !== "video");
        container.classList.toggle("is-video", kind === "video");

        if (url) {
            if (kind === "video") {
                video.src = url;
                video.load?.();
            } else {
                img.src = url;
            }
        }

        if (savePath) {
            pathEl.textContent = savePath;
            logParts.push(savePath.split(/[\\/]/).pop() || savePath);
        } else {
            pathEl.textContent = "No output yet.";
        }
        statsState.mode = statsPayload.mode || "";
        statsState.kind = kind;
        statsState.frameCount = statsPayload.frame_count ?? null;
        statsState.fps = statsPayload.fps ?? null;
        statsState.extension = statsPayload.extension || "";
        statsState.outputs = outputs
            .map((item) => {
                const type = item?.type || "";
                if (type === "png_sequence") return "png seq";
                if (type === "mp4") return "mp4 proxy";
                if (type === "mov") return "mov prores";
                return String(type || "").toLowerCase();
            })
            .filter(Boolean);
        if (statsState.mode || kind) {
            logParts.unshift(statsState.mode || kind);
        }
        if (statsState.outputs.length) {
            logParts.push(statsState.outputs.join(", "));
        }
        if (summary) {
            logParts.push(summary);
        }
        if (logParts.length) {
            console.debug(`[NL Write] ${logParts.join(" | ")}`);
        }
        statsState.path = savePath;
        if (!url) {
            statsState.width = null;
            statsState.height = null;
        }
        updateStatsDisplay();
    };

    node.__nlWriteUI = {
        applyPayload,
        computePanelHeight: requestLayout,
        estimateControlsHeight,
        panelState,
    };
    NL_WRITE_NODES.add(node);

    const originalOnExecuted = node.onExecuted;
    node.onExecuted = function (output) {
        originalOnExecuted?.apply(this, arguments);
        const payload = extractPayload(output);
        if (payload) {
            applyPayload(payload);
            return;
        }
        void fetchLastPayload().then((fallback) => {
            if (fallback) {
                applyPayload(fallback);
            }
        });
    };

    const modeWidget = findWidget(node, "mode");
    const nameWidget = findWidget(node, "name");
    const singleExtensionWidget = findWidget(node, "single_extension");
    const sequenceWidgets = [
        findWidget(node, "sequence_save_png"),
        findWidget(node, "sequence_save_mp4"),
        findWidget(node, "sequence_save_mov"),
        findWidget(node, "sequence_mp4_crf"),
        findWidget(node, "sequence_mp4_preset"),
        findWidget(node, "sequence_mov_profile"),
    ].filter(Boolean);
    let controlsUI = null;
    try {
        controlsUI = buildControlsUI();
    } catch (err) {
        console.warn("[NL Write] Failed to build controls UI, falling back to default widgets.", err);
    }
    const widgetsToHide = [modeWidget, nameWidget, singleExtensionWidget, ...sequenceWidgets].filter(Boolean);
    const saveState = () => persistWidgetState(node);
    const updateModeWidgets = () => {
        const isSequence = modeWidget?.value === "sequence";
        if (controlsUI) {
            widgetsToHide.forEach((widget) => {
                widget.hidden = true;
            });
        } else {
            widgetsToHide.forEach((widget) => {
                widget.hidden = false;
            });
            if (singleExtensionWidget) {
                singleExtensionWidget.hidden = isSequence;
                singleExtensionWidget.disabled = isSequence;
            }
            sequenceWidgets.forEach((widget) => {
                widget.hidden = !isSequence;
                widget.disabled = !isSequence;
            });
        }
        estimateControlsHeight();
        requestLayout();
        controlsUI?.syncFromWidgets?.();
        controlsUI?.updateControlsHeight?.();
    };
    if (modeWidget) {
        const original = modeWidget.callback;
        modeWidget.callback = function () {
            if (typeof original === "function") {
                original.apply(this, arguments);
            }
            updateModeWidgets();
            saveState();
        };
        updateModeWidgets();
    }
    restoreWidgetState(node);
    updateModeWidgets();
    saveState();
    for (const widget of [singleExtensionWidget, ...sequenceWidgets].filter(Boolean)) {
        const original = widget.callback;
        widget.callback = function () {
            if (typeof original === "function") {
                original.apply(this, arguments);
            }
            controlsUI?.syncFromWidgets?.();
            controlsUI?.updateControlsHeight?.();
            saveState();
        };
    }
    if (nameWidget) {
        const original = nameWidget.callback;
        nameWidget.callback = function () {
            if (typeof original === "function") {
                original.apply(this, arguments);
            }
            controlsUI?.syncFromWidgets?.();
            controlsUI?.updateControlsHeight?.();
            saveState();
        };
    }

    const executedHandler = (event) => {
        if (!event?.detail) return;
        const eventNode =
            event.detail.node ??
            event.detail.node_id ??
            event.detail.nodeId ??
            event.detail.id ??
            null;
        const payload =
            extractPayload(event.detail) ||
            extractPayload(event.detail.output) ||
            extractPayload(event.detail.outputs);
        if (eventNode !== null && String(eventNode) !== String(node.id)) return;
        if (payload) {
            applyPayload(payload);
            return;
        }
        void fetchLastPayload().then((fallback) => {
            if (fallback) {
                applyPayload(fallback);
            }
        });
    };
    api.addEventListener("executed", executedHandler);
    const onRemoved = node.onRemoved;
    node.onRemoved = function () {
        api.removeEventListener("executed", executedHandler);
        NL_WRITE_NODES.delete(node);
        if (node.__nlWriteUI) {
            delete node.__nlWriteUI;
        }
        onRemoved?.apply(this, arguments);
    };

    const originalResize = node.onResize;
    node.onResize = function () {
        originalResize?.apply(this, arguments);
        requestLayout();
    };

    const originalComputeSize = node.computeSize;
    node.computeSize = function () {
        const size = typeof originalComputeSize === "function" ? originalComputeSize.apply(this, arguments) : null;
        const baseWidth = Array.isArray(size) ? size[0] : this.size?.[0] || 0;
        estimateControlsHeight();
        const minPreviewHeight = 140;
        const minHeight = panelState.controlsHeight + getTitleHeight() + minPreviewHeight;
        return [baseWidth, minHeight];
    };

    if (!GLOBAL_LISTENER_ATTACHED) {
        GLOBAL_LISTENER_ATTACHED = true;
        api.addEventListener("executed", async () => {
            const now = Date.now();
            if (now - LAST_GLOBAL_FETCH_AT < 300) return;
            LAST_GLOBAL_FETCH_AT = now;
            let payload = null;
            try {
                const response = await api.fetchApi("/nl_write/last");
                if (response.ok) {
                    const data = await response.json();
                    payload = data?.payload || null;
                }
            } catch (err) {
                console.warn("[NL Write] Global fetch failed", err);
            }
            if (!payload) return;
            const signature = `${payload.save_path || ""}|${payload.preview_url || ""}|${payload.summary || ""}`;
            if (signature && signature === LAST_PAYLOAD_SIGNATURE) return;
            LAST_PAYLOAD_SIGNATURE = signature;
            NL_WRITE_NODES.forEach((nodeRef) => {
                nodeRef?.__nlWriteUI?.applyPayload?.(payload);
            });
        });
    }

    node.__nlWriteUI = {
        ...node.__nlWriteUI,
        restoreState: () => restoreWidgetState(node),
        saveState,
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
            const minWidth = 440;
            const minHeight = 520;
            const nextWidth = Math.max(this.size?.[0] || 0, minWidth);
            const nextHeight = Math.max(this.size?.[1] || 0, minHeight);
            if (this.size && (this.size[0] !== nextWidth || this.size[1] !== nextHeight)) {
                this.setSize([nextWidth, nextHeight]);
            }
            this.__nlWriteUI?.estimateControlsHeight?.();
            this.__nlWriteUI?.computePanelHeight?.();
            return result;
        };
        nodeType.prototype.onConfigure = function () {
            const result = onConfigure?.apply(this, arguments);
            this.__nlWriteUI?.restoreState?.();
            return result;
        };
    },
});
