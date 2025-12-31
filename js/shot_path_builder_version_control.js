import { app } from "../../scripts/app.js";
import { addValueControlWidget } from "../../scripts/widgets.js";

app.registerExtension({
    name: "nolabel.ShotPathBuilderVersionControl",

    async nodeCreated(node) {
        if (node.comfyClass !== "ShotPathBuilder") return;
        if (!node.widgets) return;

        // 1) Set default colors
        // These three are the usual LiteGraph color fields
        node.color = "#000000";       // title bar / border
        node.bgcolor = "#000000";     // body background
        node.boxcolor = "#000000";    // little box color (depending on theme)

        // 2) Add control_after_generate if missing
        if (!node.widgets.some(w => w.name === "control_after_generate")) {
            const versionWidget = node.widgets.find(w => w.name === "version_int");
            if (!versionWidget) {
                console.warn("[ShotPathBuilderExt] version_int widget not found on node", node);
                return;
            }

            addValueControlWidget(node, versionWidget, "increment");
        }

        const previewFont = "11px monospace";
        const previewLineHeight = 12;
        const previewPadding = 6;

        const normalizeOutput = (value) => {
            if (Array.isArray(value)) return value[0] ?? "";
            return value ?? "";
        };

        const setPreviewLines = (lines) => {
            node._nlPreviewLines = lines;
            const previousExtra = node._nlPreviewExtraHeight ?? 0;
            const baseHeight = Math.max(0, node.size[1] - previousExtra);
            const extraHeight = lines.length
                ? previewPadding * 2 + previewLineHeight * lines.length
                : 0;
            node._nlPreviewExtraHeight = extraHeight;
            node.setSize([node.size[0], baseHeight + extraHeight]);
            node.setDirtyCanvas(true, true);
        };

        const originalOnExecuted = node.onExecuted;
        node.onExecuted = function (message) {
            originalOnExecuted?.apply(this, arguments);

            const standardPath = normalizeOutput(message?.standard_path);
            const pngPath = normalizeOutput(message?.png_path);
            const lines = [];
            if (standardPath) lines.push(`standard: ${standardPath}`);
            if (pngPath) lines.push(`png: ${pngPath}`);
            setPreviewLines(lines);
        };

        const originalOnDrawForeground = node.onDrawForeground;
        node.onDrawForeground = function (ctx) {
            originalOnDrawForeground?.apply(this, arguments);

            const lines = node._nlPreviewLines;
            if (!lines || !lines.length) return;

            const width = node.size[0];
            const height = node.size[1];
            const totalHeight = previewLineHeight * lines.length;
            const startY = height - (previewPadding + totalHeight);

            ctx.save();
            ctx.beginPath();
            ctx.rect(0, height - (totalHeight + previewPadding * 2), width, totalHeight + previewPadding * 2);
            ctx.clip();
            ctx.font = previewFont;
            ctx.fillStyle = "#d0d0d0";
            ctx.textBaseline = "top";
            for (let i = 0; i < lines.length; i++) {
                ctx.fillText(lines[i], previewPadding, startY + i * previewLineHeight);
            }
            ctx.restore();
        };
    },
});
