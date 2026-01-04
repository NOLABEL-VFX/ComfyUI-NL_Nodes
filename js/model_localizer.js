import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const STYLE_ID = "nl-model-localizer-style";

function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
    .nl-ml-root { font-family: "IBM Plex Mono", "Courier New", monospace; font-size: 11px; color: #e6e6e6; }
    .nl-ml-bar { display: flex; gap: 8px; align-items: center; margin-bottom: 6px; flex-wrap: wrap; }
    .nl-ml-toggle { display: inline-flex; border: 1px solid #333; border-radius: 6px; overflow: hidden; }
    .nl-ml-toggle button { border: 0; background: #1e1e1e; color: #bdbdbd; padding: 4px 8px; }
    .nl-ml-toggle button.active { background: #3a3a3a; color: #fff; }
    .nl-ml-bar button { background: #2a2a2a; color: #f0f0f0; border: 1px solid #444; padding: 4px 8px; border-radius: 4px; cursor: pointer; }
    .nl-ml-bar button:disabled { opacity: 0.5; cursor: default; }
    .nl-ml-cache { margin-left: auto; font-weight: 600; color: #c9f7a1; }
    .nl-ml-error { color: #ff6b6b; margin-left: 8px; }
    .nl-ml-table-wrap { max-height: 260px; overflow: auto; border: 1px solid #2e2e2e; border-radius: 6px; }
    .nl-ml-table { width: 100%; border-collapse: collapse; }
    .nl-ml-table th, .nl-ml-table td { border-bottom: 1px solid #2e2e2e; padding: 4px 6px; text-align: left; }
    .nl-ml-table th { color: #9aa0a6; font-weight: 600; position: sticky; top: 0; background: #111; }
    .nl-ml-table td { vertical-align: top; }
    .nl-ml-pill { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-right: 6px; }
    .nl-ml-pill.ok { background: #4cd964; }
    .nl-ml-pill.bad { background: #ff4d4d; }
    .nl-ml-muted { color: #9aa0a6; }
    .nl-ml-actions button { background: #3a3a3a; border: 1px solid #555; color: #fff; padding: 2px 6px; border-radius: 4px; }
    .nl-ml-actions button:disabled { opacity: 0.5; }
    .nl-ml-delete { margin-left: 6px; background: transparent; border: 1px solid #444; color: #ff9c9c; padding: 0 4px; border-radius: 4px; cursor: pointer; }
    .nl-ml-delete:disabled { opacity: 0.4; cursor: default; }
    .nl-ml-progress { display: flex; align-items: center; gap: 8px; margin-top: 6px; }
    .nl-ml-progress progress { width: 140px; height: 12px; }
    .nl-ml-message { color: #cbd5e1; }
    `;
    document.head.appendChild(style);
}

function formatBytes(bytes) {
    if (bytes === null || bytes === undefined) return "-";
    let size = Number(bytes);
    if (!Number.isFinite(size)) return "-";
    const units = ["B", "KiB", "MiB", "GiB", "TiB"];
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex += 1;
    }
    if (unitIndex === 0) return `${Math.round(size)} ${units[unitIndex]}`;
    return `${size.toFixed(2)} ${units[unitIndex]}`;
}

async function readJsonOrText(response) {
    const text = await response.text();
    if (!text) return {};
    try {
        return JSON.parse(text);
    } catch (err) {
        return { _raw: text, _parseError: err };
    }
}

function collectCandidates() {
    const graph = app.graph || app.canvas?.graph;
    const candidates = new Set();
    if (!graph || !graph._nodes) return [];

    for (const node of graph._nodes) {
        if (!node?.widgets) continue;
        for (const widget of node.widgets) {
            const value = widget?.value;
            if (typeof value === "string") {
                const trimmed = value.trim();
                if (trimmed && trimmed.length <= 512 && !trimmed.includes("\n")) {
                    candidates.add(trimmed);
                }
            } else if (Array.isArray(value)) {
                for (const item of value) {
                    if (typeof item === "string") {
                        const trimmed = item.trim();
                        if (trimmed && trimmed.length <= 512 && !trimmed.includes("\n")) {
                            candidates.add(trimmed);
                        }
                    }
                }
            } else if (value && typeof value === "object") {
                const maybe = value?.value ?? value?.name ?? value?.content ?? value?.path;
                if (typeof maybe === "string") {
                    const trimmed = maybe.trim();
                    if (trimmed && trimmed.length <= 512 && !trimmed.includes("\n")) {
                        candidates.add(trimmed);
                    }
                }
            }
        }
        if (Array.isArray(node.widgets_values)) {
            for (const value of node.widgets_values) {
                if (typeof value === "string") {
                    const trimmed = value.trim();
                    if (trimmed && trimmed.length <= 512 && !trimmed.includes("\n")) {
                        candidates.add(trimmed);
                    }
                } else if (Array.isArray(value)) {
                    for (const item of value) {
                        if (typeof item === "string") {
                            const trimmed = item.trim();
                            if (trimmed && trimmed.length <= 512 && !trimmed.includes("\n")) {
                                candidates.add(trimmed);
                            }
                        }
                    }
                }
            }
        }
        if (node.properties && typeof node.properties === "object") {
            for (const value of Object.values(node.properties)) {
                if (typeof value === "string") {
                    const trimmed = value.trim();
                    if (trimmed && trimmed.length <= 512 && !trimmed.includes("\n")) {
                        candidates.add(trimmed);
                    }
                }
            }
        }
    }

    function collectFromNodeList(nodes) {
        if (!Array.isArray(nodes)) return;
        for (const node of nodes) {
            if (Array.isArray(node.widgets_values)) {
                for (const value of node.widgets_values) {
                    if (typeof value === "string") {
                        const trimmed = value.trim();
                        if (trimmed && trimmed.length <= 512 && !trimmed.includes("\n")) {
                            candidates.add(trimmed);
                        }
                    } else if (Array.isArray(value)) {
                        for (const item of value) {
                            if (typeof item === "string") {
                                const trimmed = item.trim();
                                if (trimmed && trimmed.length <= 512 && !trimmed.includes("\n")) {
                                    candidates.add(trimmed);
                                }
                            }
                        }
                    }
                }
            }
            if (node.properties && typeof node.properties === "object") {
                for (const value of Object.values(node.properties)) {
                    if (typeof value === "string") {
                        const trimmed = value.trim();
                        if (trimmed && trimmed.length <= 512 && !trimmed.includes("\n")) {
                            candidates.add(trimmed);
                        }
                    }
                }
            }
        }
    }

    function collectFromWorkflowData(data) {
        if (!data || typeof data !== "object") return;
        collectFromNodeList(data.nodes);
        if (data.definitions && Array.isArray(data.definitions.subgraphs)) {
            for (const subgraph of data.definitions.subgraphs) {
                collectFromNodeList(subgraph.nodes);
            }
        }
    }

    if (typeof graph.serialize === "function") {
        try {
            const data = graph.serialize();
            collectFromWorkflowData(data);
            if (data?.extra && data.extra?.workflow) {
                collectFromWorkflowData(data.extra.workflow);
            }
        } catch (err) {
            console.warn("[NL Model Localizer] Failed to serialize graph", err);
        }
    }

    return Array.from(candidates);
}

app.registerExtension({
    name: "nolabel.ModelLocalizer",

    async nodeCreated(node) {
        if (node.comfyClass !== "ModelLocalizer") return;
        ensureStyles();

        node.color = "#000000";
        node.bgcolor = "#000000";
        node.boxcolor = "#000000";

        const root = document.createElement("div");
        root.className = "nl-ml-root";

        const bar = document.createElement("div");
        bar.className = "nl-ml-bar";

        const toggleWrap = document.createElement("div");
        toggleWrap.className = "nl-ml-toggle";
        const workflowButton = document.createElement("button");
        workflowButton.textContent = "Workflow";
        workflowButton.classList.add("active");
        const localButton = document.createElement("button");
        localButton.textContent = "All Local";
        toggleWrap.append(workflowButton, localButton);

        const refreshButton = document.createElement("button");
        refreshButton.textContent = "Refresh";

        const localizeAllButton = document.createElement("button");
        localizeAllButton.textContent = "Localize All";

        const cacheLabel = document.createElement("div");
        cacheLabel.className = "nl-ml-cache";
        cacheLabel.textContent = "Cache: -";

        const errorLabel = document.createElement("div");
        errorLabel.className = "nl-ml-error";

        bar.append(toggleWrap, refreshButton, localizeAllButton, cacheLabel, errorLabel);

        const tableWrap = document.createElement("div");
        tableWrap.className = "nl-ml-table-wrap";

        const table = document.createElement("table");
        table.className = "nl-ml-table";

        const header = document.createElement("thead");
        header.innerHTML = `
            <tr>
                <th>Category</th>
                <th>Filename</th>
                <th>Local</th>
                <th>Network</th>
                <th>Size</th>
                <th>Action</th>
            </tr>
        `;
        table.appendChild(header);

        const body = document.createElement("tbody");
        table.appendChild(body);
        tableWrap.appendChild(table);

        const progressWrap = document.createElement("div");
        progressWrap.className = "nl-ml-progress";
        progressWrap.style.display = "none";
        const progressBar = document.createElement("progress");
        progressBar.value = 0;
        progressBar.max = 100;
        const progressText = document.createElement("div");
        progressText.className = "nl-ml-message";
        const cancelButton = document.createElement("button");
        cancelButton.textContent = "Cancel";
        cancelButton.disabled = true;

        progressWrap.append(progressBar, progressText, cancelButton);

        root.append(bar, tableWrap, progressWrap);

        const widget = node.addDOMWidget("model_localizer", "model_localizer", root, { serialize: false });
        widget.serialize = false;
        widget.options.canvasOnly = false;

        node.setSize([Math.max(node.size[0], 1120), Math.max(node.size[1], 420)]);

        let latestData = [];
        let currentMode = "workflow";
        let currentJobId = null;
        let pollTimer = null;

        function setError(message) {
            errorLabel.textContent = message || "";
        }

        function setMode(mode) {
            currentMode = mode;
            workflowButton.classList.toggle("active", mode === "workflow");
            localButton.classList.toggle("active", mode === "local");
            refresh();
        }

        function setBusy(isBusy) {
            refreshButton.disabled = isBusy;
            localizeAllButton.disabled = isBusy;
            cancelButton.disabled = !isBusy;
            progressWrap.style.display = isBusy ? "flex" : "none";
            for (const btn of body.querySelectorAll("button")) {
                btn.disabled = isBusy || btn.dataset.disabled === "true";
            }
        }

        function renderRows(items) {
            body.innerHTML = "";
            latestData = items;

            for (const item of items) {
                const row = document.createElement("tr");

                const categoryCell = document.createElement("td");
                categoryCell.textContent = item.category;

                const nameCell = document.createElement("td");
                nameCell.textContent = item.relpath;

                const localCell = document.createElement("td");
                const localDot = document.createElement("span");
                localDot.className = `nl-ml-pill ${item.local_exists ? "ok" : "bad"}`;
                localCell.append(localDot, document.createTextNode(item.local_exists ? "Present" : "Missing"));
                if (item.local_exists) {
                    const deleteButton = document.createElement("button");
                    deleteButton.className = "nl-ml-delete";
                    deleteButton.title = "Delete local copy";
                    deleteButton.textContent = "🗑";
                    deleteButton.addEventListener("click", async (event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        if (!confirm(`Delete local copy of ${item.relpath}?`)) return;
                        await deleteLocal(item.category, item.relpath);
                    });
                    localCell.appendChild(deleteButton);
                }

                const netCell = document.createElement("td");
                const netDot = document.createElement("span");
                netDot.className = `nl-ml-pill ${item.network_exists ? "ok" : "bad"}`;
                netCell.append(netDot, document.createTextNode(item.network_exists ? "Present" : "Missing"));

                const sizeCell = document.createElement("td");
                if (item.local_exists && item.network_exists) {
                    sizeCell.textContent = `L: ${formatBytes(item.local_size_bytes)} / N: ${formatBytes(item.network_size_bytes)}`;
                } else if (item.local_exists) {
                    sizeCell.textContent = `L: ${formatBytes(item.local_size_bytes)}`;
                } else if (item.network_exists) {
                    sizeCell.textContent = `N: ${formatBytes(item.network_size_bytes)}`;
                } else {
                    sizeCell.textContent = "-";
                }

                const actionCell = document.createElement("td");
                actionCell.className = "nl-ml-actions";
                const actionButton = document.createElement("button");

                let canLocalize = false;
                let overwrite = false;
                if (item.network_exists && !item.local_exists) {
                    actionButton.textContent = "Localize";
                    canLocalize = true;
                } else if (item.network_exists && item.status === "different_size") {
                    actionButton.textContent = "Re-localize";
                    canLocalize = true;
                    overwrite = true;
                } else {
                    actionButton.textContent = "-";
                    actionButton.dataset.disabled = "true";
                    actionButton.disabled = true;
                    actionButton.classList.add("nl-ml-muted");
                }

                if (canLocalize) {
                    actionButton.addEventListener("click", () => startLocalize([{ category: item.category, relpath: item.relpath }], overwrite));
                }

                actionCell.appendChild(actionButton);

                row.append(categoryCell, nameCell, localCell, netCell, sizeCell, actionCell);
                body.appendChild(row);
            }
        }

        async function refresh() {
            setError("");
            progressText.textContent = currentMode === "workflow" ? "Scanning workflow..." : "Scanning local models...";
            try {
                let response;
                if (currentMode === "workflow") {
                    const candidates = collectCandidates();
                    if (!candidates.length) {
                        setError("No model candidates found in workflow widgets.");
                    }
                    response = await api.fetchApi("/model_localizer/scan", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ candidates }),
                    });
                } else {
                    response = await api.fetchApi("/model_localizer/list_local");
                }
                const data = await readJsonOrText(response);
                if (!response.ok) {
                    throw new Error(data?.error || data?._raw || response.statusText);
                }

                cacheLabel.textContent = `Cache: ${data.cache_size_human} (${data.cache_size_bytes} bytes)`;
                renderRows(data.items || []);
                progressText.textContent = "";
            } catch (err) {
                setError(err.message || String(err));
                progressText.textContent = "";
            }
        }

        async function startLocalize(items, overwrite) {
            setError("");
            setBusy(true);
            progressText.textContent = "Starting copy...";
            try {
                const response = await api.fetchApi("/model_localizer/localize", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ items, overwrite }),
                });
                const data = await readJsonOrText(response);
                if (!response.ok) {
                    throw new Error(data?.error || data?._raw || response.statusText);
                }
                currentJobId = data.job_id;
                pollJob();
            } catch (err) {
                setBusy(false);
                setError(err.message || String(err));
                progressText.textContent = "";
            }
        }

        async function pollJob() {
            if (!currentJobId) return;
            if (pollTimer) {
                clearTimeout(pollTimer);
                pollTimer = null;
            }
            try {
                const response = await api.fetchApi(`/model_localizer/job/${currentJobId}`);
                const data = await readJsonOrText(response);
                if (!response.ok) {
                    throw new Error(data?.error || data?._raw || response.statusText);
                }

                progressBar.value = data.percent ?? 0;
                const doneText = formatBytes(data.bytes_done);
                const totalText = formatBytes(data.bytes_total);
                const currentItem = data.current_item ? `${data.current_item.category}/${data.current_item.relpath}` : "";
                progressText.textContent = `${data.message || data.state} ${currentItem}`.trim();
                if (data.bytes_total > 0) {
                    progressText.textContent += ` (${doneText} / ${totalText})`;
                }

                if (["done", "error", "cancelled"].includes(data.state)) {
                    setBusy(false);
                    currentJobId = null;
                    if (data.state === "error") {
                        setError(data.message || "Copy failed");
                    }
                    await refresh();
                    return;
                }

                pollTimer = setTimeout(pollJob, 1000);
            } catch (err) {
                setBusy(false);
                setError(err.message || String(err));
                currentJobId = null;
            }
        }

        async function deleteLocal(category, relpath) {
            setError("");
            setBusy(true);
            progressText.textContent = "Deleting local copy...";
            try {
                const response = await api.fetchApi("/model_localizer/delete_local", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ category, relpath }),
                });
                const data = await readJsonOrText(response);
                if (!response.ok) {
                    throw new Error(data?.error || data?._raw || response.statusText);
                }
                await refresh();
                progressText.textContent = "";
            } catch (err) {
                setError(err.message || String(err));
            } finally {
                setBusy(false);
            }
        }

        refreshButton.addEventListener("click", refresh);
        workflowButton.addEventListener("click", () => setMode("workflow"));
        localButton.addEventListener("click", () => setMode("local"));

        localizeAllButton.addEventListener("click", () => {
            const items = latestData.filter(
                (item) => item.network_exists && (!item.local_exists || item.status === "different_size")
            );
            if (!items.length) {
                setError("No eligible models to localize");
                return;
            }
            const overwrite = items.some((item) => item.status === "different_size");
            const payloadItems = items.map((item) => ({ category: item.category, relpath: item.relpath }));
            startLocalize(payloadItems, overwrite);
        });

        cancelButton.addEventListener("click", async () => {
            if (!currentJobId) return;
            try {
                await api.fetchApi(`/model_localizer/job/${currentJobId}/cancel`, { method: "POST" });
            } catch (err) {
                setError(err.message || String(err));
            }
        });

        refresh();
    },
});
