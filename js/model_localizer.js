import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const STYLE_ID = "nl-model-localizer-style";
const PANEL_ID = "nl-model-localizer-panel";
const PANEL_TOGGLE_ID = "nl-model-localizer-toggle";
const graphChangeCallbacks = new Set();
let graphHooked = false;

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
    .nl-ml-checkbox { width: 24px; text-align: center; }
    .nl-ml-panel { position: fixed; right: 16px; top: 72px; width: 980px; max-width: calc(100vw - 32px); max-height: calc(100vh - 120px); background: #0b0b0b; border: 1px solid #2e2e2e; border-radius: 8px; padding: 10px; z-index: 10000; display: none; box-shadow: 0 8px 24px rgba(0,0,0,0.4); }
    .nl-ml-panel-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; cursor: move; }
    .nl-ml-panel-hint { color: #9aa0a6; font-size: 10px; margin-left: 8px; }
    .nl-ml-panel-title { font-weight: 600; color: #e6e6e6; }
    .nl-ml-panel-close { background: #2a2a2a; color: #f0f0f0; border: 1px solid #444; padding: 2px 8px; border-radius: 4px; cursor: pointer; }
    .nl-ml-panel-body { max-height: calc(100vh - 190px); overflow: auto; }
    .nl-ml-panel-toggle { position: fixed; right: 16px; bottom: 16px; z-index: 10001; background: #2a2a2a; color: #f0f0f0; border: 1px solid #444; padding: 6px 10px; border-radius: 999px; cursor: pointer; }
    .nl-ml-menu-button { background: #2a2a2a; color: #f0f0f0; border: 1px solid #444; padding: 2px 8px; border-radius: 4px; cursor: pointer; margin-left: 6px; }
    .nl-ml-row-recent { background: rgba(76, 217, 100, 0.08); }
    .nl-ml-row-warm { background: rgba(255, 214, 102, 0.08); }
    .nl-ml-row-stale { background: rgba(255, 77, 77, 0.06); }
    .nl-ml-pill { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-right: 6px; }
    .nl-ml-pill.ok { background: #4cd964; }
    .nl-ml-pill.bad { background: #ff4d4d; }
    .nl-ml-muted { color: #9aa0a6; }
    .nl-ml-localize { background: #3a3a3a; border: 1px solid #555; color: #fff; padding: 2px 6px; border-radius: 4px; margin-left: 6px; }
    .nl-ml-localize:disabled { opacity: 0.5; }
    .nl-ml-upload { background: #2e3a2e; border: 1px solid #4c6b4c; color: #e2ffe2; padding: 2px 6px; border-radius: 4px; margin-left: 6px; }
    .nl-ml-upload:disabled { opacity: 0.5; }
    .nl-ml-delete { margin-left: 6px; background: transparent; border: 1px solid #444; color: #ff9c9c; padding: 0 4px; border-radius: 4px; cursor: pointer; }
    .nl-ml-delete:disabled { opacity: 0.4; cursor: default; }
    .nl-ml-progress { display: flex; align-items: center; gap: 8px; margin-top: 6px; }
    .nl-ml-progress progress { width: 140px; height: 12px; }
    .nl-ml-message { color: #cbd5e1; }
    .nl-ml-pagination { display: flex; align-items: center; gap: 8px; margin-top: 6px; }
    .nl-ml-pagination button { background: #2a2a2a; color: #f0f0f0; border: 1px solid #444; padding: 2px 8px; border-radius: 4px; cursor: pointer; }
    .nl-ml-pagination button:disabled { opacity: 0.5; cursor: default; }
    .nl-ml-pagination input[type="number"] { width: 52px; background: #111; color: #e6e6e6; border: 1px solid #333; border-radius: 4px; padding: 2px 6px; }
    .nl-ml-page-info { display: inline-flex; align-items: center; gap: 4px; color: #9aa0a6; }
    .nl-ml-settings { display: flex; align-items: center; gap: 6px; }
    .nl-ml-settings input[type="number"] { width: 70px; background: #111; color: #e6e6e6; border: 1px solid #333; border-radius: 4px; padding: 2px 6px; }
    .nl-ml-settings label { display: inline-flex; align-items: center; gap: 4px; color: #cbd5e1; }
    .nl-ml-log { display: none; margin-top: 6px; border: 1px solid #2e2e2e; border-radius: 6px; padding: 6px; background: #0b0b0b; }
    .nl-ml-log textarea { width: 100%; min-height: 140px; background: #111; color: #e6e6e6; border: 1px solid #333; border-radius: 4px; padding: 6px; font-family: "IBM Plex Mono", "Courier New", monospace; font-size: 11px; }
    .nl-ml-log button { margin-bottom: 6px; background: #2a2a2a; color: #f0f0f0; border: 1px solid #444; padding: 2px 6px; border-radius: 4px; cursor: pointer; }
    `;
    document.head.appendChild(style);
}

function ensureGraphHook() {
    const graph = app.graph || app.canvas?.graph;
    if (!graph) {
        setTimeout(ensureGraphHook, 300);
        return;
    }
    if (graphHooked) return;
    const prev = graph.onAfterChange;
    graph.onAfterChange = function (...args) {
        if (typeof prev === "function") {
            prev.apply(this, args);
        }
        for (const callback of graphChangeCallbacks) {
            callback();
        }
    };
    graphHooked = true;
}

function registerGraphChange(callback) {
    if (typeof callback !== "function") return () => {};
    graphChangeCallbacks.add(callback);
    ensureGraphHook();
    return () => graphChangeCallbacks.delete(callback);
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

function createModelLocalizerUI({ onResize, autoRefresh = false, initialVisible = true } = {}) {
    ensureStyles();
    const resize = typeof onResize === "function" ? onResize : () => {};
    let isVisible = Boolean(initialVisible);
    let autoRefreshTimer = null;

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

    const localizeSelectedButton = document.createElement("button");
    localizeSelectedButton.textContent = "Localize Selected";

    const uploadAllButton = document.createElement("button");
    uploadAllButton.textContent = "Upload All";

    const uploadSelectedButton = document.createElement("button");
    uploadSelectedButton.textContent = "Upload Selected";

    const deleteSelectedButton = document.createElement("button");
    deleteSelectedButton.textContent = "Delete Selected";

    const settingsWrap = document.createElement("div");
    settingsWrap.className = "nl-ml-settings";
    const autoLabel = document.createElement("label");
    const autoToggle = document.createElement("input");
    autoToggle.type = "checkbox";
    const autoText = document.createElement("span");
    autoText.textContent = "Auto-prune";
    autoLabel.append(autoToggle, autoText);

    const maxLabel = document.createElement("span");
    maxLabel.textContent = "Max GB";
    const maxInput = document.createElement("input");
    maxInput.type = "number";
    maxInput.min = "0";
    maxInput.step = "1";
    maxInput.placeholder = "0";

    const pruneButton = document.createElement("button");
    pruneButton.textContent = "Prune Now";

    const logButton = document.createElement("button");
    logButton.textContent = "Log";

    settingsWrap.append(autoLabel, maxLabel, maxInput, pruneButton, logButton);

    const cacheLabel = document.createElement("div");
    cacheLabel.className = "nl-ml-cache";
    cacheLabel.textContent = "Cache: -";

    const errorLabel = document.createElement("div");
    errorLabel.className = "nl-ml-error";

    bar.append(
        toggleWrap,
        refreshButton,
        localizeAllButton,
        localizeSelectedButton,
        uploadAllButton,
        uploadSelectedButton,
        deleteSelectedButton,
        settingsWrap,
        cacheLabel,
        errorLabel
    );

    const tableWrap = document.createElement("div");
    tableWrap.className = "nl-ml-table-wrap";

    const table = document.createElement("table");
    table.className = "nl-ml-table";

    const header = document.createElement("thead");
    header.innerHTML = `
        <tr>
            <th class="nl-ml-checkbox"><input type="checkbox" class="nl-ml-select-all" /></th>
            <th>Category</th>
            <th>Filename</th>
            <th>Local</th>
            <th>Network</th>
            <th>Size</th>
            <th>Last Used</th>
        </tr>
    `;
    table.appendChild(header);

    const body = document.createElement("tbody");
    table.appendChild(body);
    tableWrap.appendChild(table);

    const pagination = document.createElement("div");
    pagination.className = "nl-ml-pagination";
    const prevButton = document.createElement("button");
    prevButton.textContent = "Prev";
    const nextButton = document.createElement("button");
    nextButton.textContent = "Next";
    const pageSizeInput = document.createElement("input");
    pageSizeInput.type = "number";
    pageSizeInput.min = "1";
    pageSizeInput.step = "1";
    pageSizeInput.value = "10";
    const pageInfo = document.createElement("div");
    pageInfo.className = "nl-ml-page-info";
    const pageStart = document.createElement("span");
    pageStart.textContent = "1-";
    const pageTotal = document.createElement("span");
    pageTotal.textContent = "of 0";
    pageInfo.append(pageStart, pageSizeInput, pageTotal);
    pagination.append(prevButton, nextButton, pageInfo);

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

    const logWrap = document.createElement("div");
    logWrap.className = "nl-ml-log";
    const logClose = document.createElement("button");
    logClose.textContent = "Close";
    const logArea = document.createElement("textarea");
    logArea.readOnly = true;
    logWrap.append(logClose, logArea);

    root.append(bar, tableWrap, pagination, progressWrap, logWrap);

    let latestData = [];
    let currentMode = "workflow";
    let currentJobId = null;
    let pollTimer = null;
    let currentPage = 1;
    let pageSize = 10;
    let currentSettings = { auto_delete_enabled: false, max_cache_bytes: 0 };
    let isBusy = false;
    const selectedKeys = new Set();
    const selectAllInput = header.querySelector(".nl-ml-select-all");

    function setError(message) {
        errorLabel.textContent = message || "";
    }

    function scheduleAutoRefresh() {
        if (!autoRefresh || !isVisible || isBusy || currentMode !== "workflow") return;
        if (autoRefreshTimer) return;
        autoRefreshTimer = setTimeout(() => {
            autoRefreshTimer = null;
            refresh();
        }, 400);
    }

    function setMode(mode) {
        currentMode = mode;
        currentPage = 1;
        selectedKeys.clear();
        workflowButton.classList.toggle("active", mode === "workflow");
        localButton.classList.toggle("active", mode === "local");
        pagination.style.display = "flex";
        pageInfo.style.display = "inline-flex";
        updateSelectionControls();
        if (!isBusy && isVisible) {
            refresh();
        }
    }

    function setBusy(busyState) {
        const busy = Boolean(busyState);
        isBusy = busy;
        refreshButton.disabled = busy;
        localizeAllButton.disabled = busy;
        localizeSelectedButton.disabled = busy;
        uploadAllButton.disabled = busy;
        uploadSelectedButton.disabled = busy;
        deleteSelectedButton.disabled = busy;
        workflowButton.disabled = busy;
        localButton.disabled = busy;
        pageSizeInput.disabled = busy;
        selectAllInput.disabled = busy;
        cancelButton.disabled = !busy;
        progressWrap.style.display = busy ? "flex" : "none";
        for (const btn of body.querySelectorAll("button")) {
            btn.disabled = busy || btn.dataset.disabled === "true";
        }
        for (const checkbox of body.querySelectorAll("input[type='checkbox']")) {
            checkbox.disabled = busy;
        }
        if (currentMode === "local") {
            prevButton.disabled = busy || currentPage <= 1;
            nextButton.disabled = busy || currentPage >= Math.max(1, Math.ceil(latestData.length / pageSize));
        }
        updateSelectionControls();
    }

    function updatePagination(totalItems) {
        const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
        if (currentPage > totalPages) currentPage = totalPages;
        if (currentPage < 1) currentPage = 1;
        prevButton.disabled = currentPage <= 1;
        nextButton.disabled = currentPage >= totalPages;
        const start = totalItems === 0 ? 0 : (currentPage - 1) * pageSize + 1;
        const end = Math.min(currentPage * pageSize, totalItems);
        pageStart.textContent = `${start}-`;
        pageTotal.textContent = `of ${totalItems}`;
    }

    function sortItems(items) {
        if (currentMode !== "local") return items;
        return [...items].sort((a, b) => {
            const scoreA = Number(a.usage_score || 0);
            const scoreB = Number(b.usage_score || 0);
            if (scoreA !== scoreB) return scoreB - scoreA;
            const lastA = Number(a.last_used || 0);
            const lastB = Number(b.last_used || 0);
            if (lastA !== lastB) return lastB - lastA;
            return String(a.category).localeCompare(String(b.category)) || String(a.relpath).localeCompare(String(b.relpath));
        });
    }

    function renderRows(items) {
        body.innerHTML = "";
        const sortedItems = sortItems(items);
        latestData = sortedItems;
        const allKeys = new Set(sortedItems.map((item) => selectionKey(item)));
        for (const key of Array.from(selectedKeys)) {
            if (!allKeys.has(key)) {
                selectedKeys.delete(key);
            }
        }

        let pageItems = sortedItems;
        updatePagination(sortedItems.length);
        const startIndex = (currentPage - 1) * pageSize;
        pageItems = sortedItems.slice(startIndex, startIndex + pageSize);
        tableWrap.style.maxHeight = "none";
        tableWrap.style.overflow = "visible";

        const allSameLastUsed = sortedItems.every(
            (item) => Number(item.last_used || 0) === Number(sortedItems[0]?.last_used || 0)
        );
        const totalItems = sortedItems.length;
        updateSelectAllState(pageItems);

        for (let index = 0; index < pageItems.length; index += 1) {
            const item = pageItems[index];
            const row = document.createElement("tr");
            if (!allSameLastUsed && totalItems >= 3) {
                const globalIndex = (currentMode === "local" ? (currentPage - 1) * pageSize : 0) + index;
                const ratio = totalItems > 1 ? globalIndex / (totalItems - 1) : 0;
                if (ratio <= 0.33) {
                    row.classList.add("nl-ml-row-recent");
                } else if (ratio <= 0.66) {
                    row.classList.add("nl-ml-row-warm");
                } else {
                    row.classList.add("nl-ml-row-stale");
                }
            }

            const selectCell = document.createElement("td");
            selectCell.className = "nl-ml-checkbox";
            const selectBox = document.createElement("input");
            selectBox.type = "checkbox";
            selectBox.checked = selectedKeys.has(selectionKey(item));
            selectBox.addEventListener("change", () => {
                const key = selectionKey(item);
                if (selectBox.checked) {
                    selectedKeys.add(key);
                } else {
                    selectedKeys.delete(key);
                }
                updateSelectAllState(pageItems);
                updateSelectionControls();
            });
            selectCell.appendChild(selectBox);

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

            let canUpload = false;
            let uploadOverwrite = false;
            if (item.local_exists && item.network_path) {
                if (!item.network_exists) {
                    canUpload = true;
                } else if (item.status === "different_size") {
                    canUpload = true;
                    uploadOverwrite = true;
                }
            }

            if (canUpload) {
                const uploadButton = document.createElement("button");
                uploadButton.className = "nl-ml-upload";
                uploadButton.textContent = "⬆";
                uploadButton.title = uploadOverwrite ? "Re-upload" : "Upload";
                uploadButton.addEventListener("click", () =>
                    startUpload([{ category: item.category, relpath: item.relpath }], uploadOverwrite)
                );
                netCell.appendChild(uploadButton);
            }

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

            const lastUsedCell = document.createElement("td");
            lastUsedCell.textContent = formatLastUsed(Number(item.last_used || 0));

            let canLocalize = false;
            let overwrite = false;
            if (item.network_exists && !item.local_exists) {
                canLocalize = true;
            } else if (item.network_exists && item.status === "different_size") {
                canLocalize = true;
                overwrite = true;
            }

            if (canLocalize) {
                const localizeButton = document.createElement("button");
                localizeButton.className = "nl-ml-localize";
                localizeButton.textContent = "⬇";
                localizeButton.title = overwrite ? "Re-localize" : "Localize";
                localizeButton.addEventListener("click", () =>
                    startLocalize([{ category: item.category, relpath: item.relpath }], overwrite)
                );
                localCell.appendChild(localizeButton);
            }

            row.append(selectCell, categoryCell, nameCell, localCell, netCell, sizeCell, lastUsedCell);
            body.appendChild(row);
        }

        requestAnimationFrame(() => {
            const desired = Math.ceil(root.scrollHeight + 20);
            resize(desired);
        });
        updateSelectionControls();
    }

    async function refresh() {
        if (!isVisible) return;
        setError("");
        if (!isBusy) {
            progressText.textContent = currentMode === "workflow" ? "Scanning workflow..." : "Scanning local models...";
        }
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
            if (currentMode === "local") {
                currentPage = 1;
                if (data.settings) {
                    applySettings(data.settings);
                }
            }
            renderRows(data.items || []);
            if (!isBusy) {
                progressText.textContent = "";
            }
        } catch (err) {
            setError(err.message || String(err));
            if (!isBusy) {
                progressText.textContent = "";
            }
        }
    }

    function formatGb(bytes) {
        if (!bytes) return "";
        const gb = bytes / (1024 ** 3);
        return gb >= 10 ? gb.toFixed(0) : gb.toFixed(1);
    }

    function formatLastUsed(timestampSeconds) {
        if (!timestampSeconds) return "-";
        const date = new Date(timestampSeconds * 1000);
        if (Number.isNaN(date.getTime())) return "-";
        return date.toLocaleDateString();
    }

    function bytesFromGb(value) {
        const num = Number(value);
        if (!Number.isFinite(num) || num <= 0) return 0;
        return Math.round(num * (1024 ** 3));
    }

    function applySettings(settings) {
        currentSettings = {
            auto_delete_enabled: Boolean(settings.auto_delete_enabled),
            max_cache_bytes: Number(settings.max_cache_bytes || 0),
        };
        autoToggle.checked = currentSettings.auto_delete_enabled;
        maxInput.value = formatGb(currentSettings.max_cache_bytes);
        pruneButton.style.display = currentSettings.auto_delete_enabled ? "none" : "inline-flex";
    }

    async function loadSettings() {
        try {
            const response = await api.fetchApi("/model_localizer/settings");
            const data = await readJsonOrText(response);
            if (!response.ok) {
                throw new Error(data?.error || data?._raw || response.statusText);
            }
            applySettings(data);
        } catch (err) {
            setError(err.message || String(err));
        }
    }

    async function saveSettings() {
        const maxCacheBytes = bytesFromGb(maxInput.value);
        try {
            const response = await api.fetchApi("/model_localizer/settings", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    auto_delete_enabled: autoToggle.checked,
                    max_cache_bytes: maxCacheBytes,
                }),
            });
            const data = await readJsonOrText(response);
            if (!response.ok) {
                throw new Error(data?.error || data?._raw || response.statusText);
            }
            applySettings(data);
        } catch (err) {
            setError(err.message || String(err));
        }
    }

    async function pruneNow() {
        setError("");
        setBusy(true);
        progressText.textContent = "Pruning cache...";
        try {
            const response = await api.fetchApi("/model_localizer/prune", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ max_cache_bytes: bytesFromGb(maxInput.value) }),
            });
            const data = await readJsonOrText(response);
            if (!response.ok) {
                throw new Error(data?.error || data?._raw || response.statusText);
            }
            await refresh();
        } catch (err) {
            setError(err.message || String(err));
        } finally {
            setBusy(false);
            progressText.textContent = "";
        }
    }

    async function toggleLog() {
        if (logWrap.style.display === "block") {
            logWrap.style.display = "none";
            return;
        }
        try {
            const response = await api.fetchApi("/model_localizer/prune_log");
            const data = await readJsonOrText(response);
            if (!response.ok) {
                throw new Error(data?.error || data?._raw || response.statusText);
            }
            logArea.value = data.text || "No log entries yet.";
            logWrap.style.display = "block";
        } catch (err) {
            setError(err.message || String(err));
        }
    }

    async function startLocalize(items, overwrite) {
        if (isBusy || currentJobId) {
            setError("Localization already running.");
            return;
        }
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

    async function startUpload(items, overwrite) {
        if (isBusy || currentJobId) {
            setError("Upload already running.");
            return;
        }
        setError("");
        setBusy(true);
        progressText.textContent = "Starting upload...";
        try {
            const response = await api.fetchApi("/model_localizer/upload", {
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

    async function resumeActiveJob() {
        try {
            const response = await api.fetchApi("/model_localizer/job");
            const data = await readJsonOrText(response);
            if (!response.ok) {
                throw new Error(data?.error || data?._raw || response.statusText);
            }
            if (data.job_id) {
                currentJobId = data.job_id;
                setBusy(true);
                pollJob();
            }
        } catch (err) {
            setError(err.message || String(err));
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

    async function deleteSelected(items) {
        setError("");
        setBusy(true);
        progressText.textContent = "Deleting selected copies...";
        try {
            const response = await api.fetchApi("/model_localizer/delete_local_batch", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ items }),
            });
            const data = await readJsonOrText(response);
            if (!response.ok) {
                throw new Error(data?.error || data?._raw || response.statusText);
            }
            if (data.errors && data.errors.length) {
                setError(`Deleted ${data.deleted?.length || 0} with ${data.errors.length} errors`);
            }
            await refresh();
            progressText.textContent = "";
        } catch (err) {
            setError(err.message || String(err));
        } finally {
            setBusy(false);
        }
    }

    function selectionKey(item) {
        return `${item.category}::${item.relpath}`;
    }

    function updateSelectAllState(pageItems) {
        if (!pageItems.length) {
            selectAllInput.checked = false;
            selectAllInput.indeterminate = false;
            return;
        }
        const selectedCount = pageItems.reduce(
            (count, item) => count + (selectedKeys.has(selectionKey(item)) ? 1 : 0),
            0
        );
        selectAllInput.checked = selectedCount === pageItems.length;
        selectAllInput.indeterminate = selectedCount > 0 && selectedCount < pageItems.length;
    }

    function getSelectedItems() {
        return latestData.filter((item) => selectedKeys.has(selectionKey(item)));
    }

    function updateSelectionControls() {
        const selectedItems = getSelectedItems();
        const localizeEligible = selectedItems.filter(
            (item) => item.network_exists && (!item.local_exists || item.status === "different_size")
        );
        const uploadEligible = selectedItems.filter(
            (item) =>
                item.local_exists &&
                item.network_path &&
                (!item.network_exists || item.status === "different_size")
        );
        const deleteEligible = selectedItems.filter((item) => item.local_exists);
        localizeSelectedButton.disabled = isBusy || localizeEligible.length === 0;
        uploadSelectedButton.disabled = isBusy || uploadEligible.length === 0;
        deleteSelectedButton.disabled = isBusy || deleteEligible.length === 0;
    }

    function currentPageItems() {
        const startIndex = (currentPage - 1) * pageSize;
        return latestData.slice(startIndex, startIndex + pageSize);
    }

    refreshButton.addEventListener("click", refresh);
    workflowButton.addEventListener("click", () => setMode("workflow"));
    localButton.addEventListener("click", () => setMode("local"));
    pageSizeInput.addEventListener("change", () => {
        const value = Number(pageSizeInput.value);
        if (Number.isFinite(value) && value > 0) {
            pageSize = value;
            currentPage = 1;
            renderRows(latestData);
        }
    });
    autoToggle.addEventListener("change", () => {
        pruneButton.style.display = autoToggle.checked ? "none" : "inline-flex";
        saveSettings();
    });
    maxInput.addEventListener("change", saveSettings);
    pruneButton.addEventListener("click", pruneNow);
    logButton.addEventListener("click", toggleLog);
    logClose.addEventListener("click", () => {
        logWrap.style.display = "none";
    });
    prevButton.addEventListener("click", () => {
        if (currentPage > 1) {
            currentPage -= 1;
            renderRows(latestData);
        }
    });
    nextButton.addEventListener("click", () => {
        const totalPages = Math.max(1, Math.ceil(latestData.length / pageSize));
        if (currentPage < totalPages) {
            currentPage += 1;
            renderRows(latestData);
        }
    });

    selectAllInput.addEventListener("change", () => {
        const pageItems = currentPageItems();
        if (!pageItems.length) return;
        if (selectAllInput.checked) {
            for (const item of pageItems) {
                selectedKeys.add(selectionKey(item));
            }
        } else {
            for (const item of pageItems) {
                selectedKeys.delete(selectionKey(item));
            }
        }
        renderRows(latestData);
    });

    localizeAllButton.addEventListener("click", () => {
        if (isBusy) return;
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

    uploadAllButton.addEventListener("click", () => {
        if (isBusy) return;
        const items = latestData.filter(
            (item) =>
                item.local_exists &&
                item.network_path &&
                (!item.network_exists || item.status === "different_size")
        );
        if (!items.length) {
            setError("No eligible models to upload");
            return;
        }
        const overwrite = items.some((item) => item.status === "different_size");
        const payloadItems = items.map((item) => ({ category: item.category, relpath: item.relpath }));
        startUpload(payloadItems, overwrite);
    });

    localizeSelectedButton.addEventListener("click", () => {
        if (isBusy) return;
        const selectedItems = getSelectedItems();
        const eligible = selectedItems.filter(
            (item) => item.network_exists && (!item.local_exists || item.status === "different_size")
        );
        if (!eligible.length) {
            setError("No selected models eligible to localize");
            return;
        }
        const overwrite = eligible.some((item) => item.status === "different_size");
        const payloadItems = eligible.map((item) => ({ category: item.category, relpath: item.relpath }));
        startLocalize(payloadItems, overwrite);
    });

    uploadSelectedButton.addEventListener("click", () => {
        if (isBusy) return;
        const selectedItems = getSelectedItems();
        const eligible = selectedItems.filter(
            (item) =>
                item.local_exists &&
                item.network_path &&
                (!item.network_exists || item.status === "different_size")
        );
        if (!eligible.length) {
            setError("No selected models eligible to upload");
            return;
        }
        const overwrite = eligible.some((item) => item.status === "different_size");
        const payloadItems = eligible.map((item) => ({ category: item.category, relpath: item.relpath }));
        startUpload(payloadItems, overwrite);
    });

    deleteSelectedButton.addEventListener("click", () => {
        if (isBusy) return;
        const selectedItems = getSelectedItems();
        const eligible = selectedItems.filter((item) => item.local_exists);
        if (!eligible.length) {
            setError("No selected local models to delete");
            return;
        }
        if (!confirm(`Delete local copies for ${eligible.length} selected models?`)) return;
        const payloadItems = eligible.map((item) => ({ category: item.category, relpath: item.relpath }));
        deleteSelected(payloadItems);
    });

    cancelButton.addEventListener("click", async () => {
        if (!currentJobId) return;
        try {
            await api.fetchApi(`/model_localizer/job/${currentJobId}/cancel`, { method: "POST" });
        } catch (err) {
            setError(err.message || String(err));
        }
    });

    if (autoRefresh) {
        registerGraphChange(() => scheduleAutoRefresh());
    }

    resumeActiveJob().finally(() => {
        setMode("workflow");
        loadSettings();
        scheduleAutoRefresh();
    });

    function setVisible(value) {
        isVisible = Boolean(value);
        if (isVisible) {
            scheduleAutoRefresh();
        }
    }

    return { root, refresh, setVisible };
}

function createGlobalPanel() {
    if (document.getElementById(PANEL_ID)) return;
    ensureStyles();
    const panel = document.createElement("div");
    panel.id = PANEL_ID;
    panel.className = "nl-ml-panel";

    const header = document.createElement("div");
    header.className = "nl-ml-panel-header";
    const title = document.createElement("div");
    title.className = "nl-ml-panel-title";
    title.textContent = "NL Model Manager";
    const hint = document.createElement("div");
    hint.className = "nl-ml-panel-hint";
    hint.textContent = "Drag to move";
    const closeButton = document.createElement("button");
    closeButton.className = "nl-ml-panel-close";
    closeButton.textContent = "Close";
    const headerLeft = document.createElement("div");
    headerLeft.style.display = "flex";
    headerLeft.style.alignItems = "center";
    headerLeft.append(title, hint);
    header.append(headerLeft, closeButton);

    const body = document.createElement("div");
    body.className = "nl-ml-panel-body";

    const ui = createModelLocalizerUI({ autoRefresh: true, initialVisible: false });
    body.appendChild(ui.root);

    panel.append(header, body);
    document.body.appendChild(panel);

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

    const toggle = document.createElement("button");
    toggle.id = PANEL_TOGGLE_ID;
    toggle.textContent = "NL Models";
    function mountToggle(row) {
        if (!row) return false;
        if (row.querySelector("[data-nl-models-wrapper='true']")) return true;

        const wrapper = document.createElement("div");
        wrapper.dataset.nlModelsWrapper = "true";
        wrapper.className =
            "pointer-events-auto flex h-12 shrink-0 items-center rounded-lg border border-interface-stroke bg-comfy-menu-bg px-2 shadow-interface";

        toggle.className =
            "flex items-center justify-center shrink-0 outline-hidden rounded-lg cursor-pointer p-0 size-8 text-xs !rounded-md border-none text-base-foreground transition-colors duration-200 ease-in-out bg-secondary-background hover:bg-secondary-background-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-background";
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
        toggle.className = "nl-ml-panel-toggle";
        document.body.appendChild(toggle);
    }

    const observer = new MutationObserver(() => {
        if (mountToggle(findTopBarRow())) {
            observer.disconnect();
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    function showPanel() {
        panel.style.display = "block";
        ui.setVisible(true);
        ui.refresh();
    }

    function hidePanel() {
        panel.style.display = "none";
        ui.setVisible(false);
    }

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

    toggle.addEventListener("click", () => {
        if (panel.style.display === "block") {
            hidePanel();
        } else {
            showPanel();
        }
    });
    closeButton.addEventListener("click", hidePanel);
    header.addEventListener("mousedown", beginDrag);
}

app.registerExtension({
    name: "nolabel.ModelLocalizer",
    async nodeCreated(node) {
        if (node.comfyClass !== "ModelLocalizer") return;
        ensureStyles();

        node.color = "#000000";
        node.bgcolor = "#000000";
        node.boxcolor = "#000000";

        const ui = createModelLocalizerUI({
            onResize: (desired) => {
                if (desired > node.size[1]) {
                    node.setSize([node.size[0], desired]);
                }
            },
        });

        const widget = node.addDOMWidget("model_localizer", "model_localizer", ui.root, { serialize: false });
        widget.serialize = false;
        widget.options.canvasOnly = false;

        node.setSize([Math.max(node.size[0], 940), Math.max(node.size[1], 420 * 0.8)]);
        ui.setVisible(true);
    },
    setup() {
        const init = () => {
            if (!document.body) {
                setTimeout(init, 50);
                return;
            }
            createGlobalPanel();
        };
        init();
    },
    init() {
        const init = () => {
            if (!document.body) {
                setTimeout(init, 50);
                return;
            }
            createGlobalPanel();
        };
        init();
    },
});
