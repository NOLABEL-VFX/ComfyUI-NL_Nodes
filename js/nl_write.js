import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const EXTENSION_NAME = "NOLABEL.NLWritePreview";
const NODE_NAME = "NLWrite";
const STYLE_ID = "nl-write-preview-style";
const NL_WRITE_NODES = new Set();
let GLOBAL_LISTENER_ATTACHED = false;
let LAST_GLOBAL_FETCH_AT = 0;
let LAST_PAYLOAD_SIGNATURE = "";

function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
        .nl-write-preview {
            width: 100%;
            height: 260px;
            border-radius: 6px;
            overflow: hidden;
            background: #0b0b0b;
            border: 1px solid #1f2937;
            display: flex;
            align-items: center;
            justify-content: center;
            position: relative;
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
        .nl-write-path {
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
            margin-top: 6px;
        }
    `;
    document.head.appendChild(style);
}

function attachPreview(node) {
    ensureStyles();

    if (node?.__nlWriteUI?.applyPayload) {
        NL_WRITE_NODES.add(node);
        return;
    }

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

    const widget = node.addDOMWidget("nlwrite_preview", "nlwrite_preview", container, { serialize: false });
    widget.serialize = false;
    widget.options.canvasOnly = false;
    widget.computeSize = (width) => [width, 270];

    const pathEl = document.createElement("div");
    pathEl.className = "nl-write-path";
    pathEl.textContent = "No output yet.";
    const pathWidget = node.addDOMWidget("nlwrite_path", "nlwrite_path", pathEl, { serialize: false });
    pathWidget.serialize = false;
    pathWidget.options.canvasOnly = false;
    pathWidget.computeSize = (width) => [width, Math.max(32, pathEl.scrollHeight + 10)];

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

    const resizePath = () => {
        pathEl.style.height = "auto";
        const nextHeight = Math.max(32, pathEl.scrollHeight + 10);
        pathEl.style.height = `${nextHeight}px`;
        pathWidget.computeSize?.(node.size[0]);
        node.setDirtyCanvas(true, true);
    };

    const applyPayload = (payload) => {
        if (!payload) return;
        const url = payload.preview_url || payload.url || "";
        const kind = payload.preview_kind || (url.includes("anim=1") ? "video" : "image");
        const summary = payload.summary || "";
        const savePath = payload.save_path || payload.savePath || "";

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
        } else {
            pathEl.textContent = "No output yet.";
        }
        requestAnimationFrame(resizePath);
    };

    node.__nlWriteUI = {
        applyPayload,
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
            const minWidth = 480;
            const minHeight = 640;
            const nextWidth = Math.max(this.size?.[0] || 0, minWidth);
            const nextHeight = Math.max(this.size?.[1] || 0, minHeight);
            if (this.size && (this.size[0] !== nextWidth || this.size[1] !== nextHeight)) {
                this.setSize([nextWidth, nextHeight]);
            }
            return result;
        };
    },
});
