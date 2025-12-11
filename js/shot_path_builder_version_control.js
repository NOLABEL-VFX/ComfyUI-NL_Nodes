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
    },
});

