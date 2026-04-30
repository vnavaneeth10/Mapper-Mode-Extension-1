const els = {
  status:         document.getElementById("status"),
  completed:      document.getElementById("completed"),
  active:         document.getElementById("active"),
  pending:        document.getElementById("pending"),
  failed:         document.getElementById("failed"),
  urls:           document.getElementById("urls"),
  concurrency:    document.getElementById("concurrency"),
  start:          document.getElementById("start"),
  clear:          document.getElementById("clear"),
  toast:          document.getElementById("toast"),
  downloadReport: document.getElementById("downloadReport"),
  clearLog:       document.getElementById("clearLog"),
  logCount:       document.getElementById("logCount"),
  // import
  importBtn:      document.getElementById("importBtn"),
  importFile:     document.getElementById("importFile"),
  importPicker:   document.getElementById("importPicker"),
  importColSelect:document.getElementById("importColSelect"),
  importConfirm:  document.getElementById("importConfirm"),
  importCancel:   document.getElementById("importCancel"),
};

let refreshInterval;
let parsedImportRows = []; // holds all rows from last import

/* ── Toast ──────────────────────────────────────────── */
function showToast(message, type = "info") {
  els.toast.textContent = message;
  els.toast.className   = `toast ${type}`;
  setTimeout(() => { els.toast.className = "toast hidden"; }, 3000);
}

/* ── Status refresh ─────────────────────────────────── */
function refresh() {
  chrome.runtime.sendMessage({ type: "STATUS" }, (r) => {
    if (chrome.runtime.lastError || !r) return;
    els.status.textContent    = r.paused ? "Paused" : "Running";
    els.completed.textContent = r.completed;
    els.active.textContent    = r.active;
    els.pending.textContent   = r.pending;
    els.failed.textContent    = r.failed;
    if (document.activeElement !== els.concurrency)
      els.concurrency.value = r.maxConcurrent;
    els.clear.disabled = r.pending === 0 && r.active === 0;
    const count = r.logCount || 0;
    els.logCount.textContent    = `${count} entr${count === 1 ? "y" : "ies"}`;
    els.downloadReport.disabled = count === 0;
    els.clearLog.disabled       = count === 0;
  });
}

function startRefreshing() { refresh(); refreshInterval = setInterval(refresh, 1000); }
function stopRefreshing()  { clearInterval(refreshInterval); }

document.addEventListener("visibilitychange", () => {
  if (document.hidden) stopRefreshing(); else startRefreshing();
});

/* ── Start / Clear ──────────────────────────────────── */
els.start.onclick = () => {
  const urls = els.urls.value.split("\n").map((u) => u.trim()).filter(Boolean);
  if (!urls.length) { showToast("Please enter at least one URL", "error"); return; }
  els.start.disabled  = true;
  els.start.textContent = "Starting...";
  chrome.runtime.sendMessage({ type: "START_QUEUE", urls }, (response) => {
    if (chrome.runtime.lastError) {
      showToast("Failed to start queue: " + chrome.runtime.lastError.message, "error");
    } else if (response?.success) {
      showToast(`Started queue with ${response.queued} URLs`, "success");
      els.urls.value = "";
    } else {
      showToast(response?.error || "Failed to start queue", "error");
    }
    setTimeout(() => { els.start.disabled = false; els.start.textContent = "Start"; refresh(); }, 500);
  });
};

els.clear.onclick = () => {
  els.clear.disabled     = true;
  els.clear.textContent  = "Clearing...";
  chrome.runtime.sendMessage({ type: "CLEAR_QUEUE" }, (response) => {
    if (chrome.runtime.lastError) {
      showToast("Failed to clear queue: " + chrome.runtime.lastError.message, "error");
    } else if (response?.success) {
      showToast("Queue cleared successfully", "success");
    } else {
      showToast("Failed to clear queue", "error");
    }
    setTimeout(() => { els.clear.disabled = false; els.clear.textContent = "Clear queue"; refresh(); }, 500);
  });
};

/* ── Concurrency ────────────────────────────────────── */
let concurrencyTimeout;
els.concurrency.onchange = () => {
  const value = Math.max(1, Math.min(4, Number(els.concurrency.value)));
  clearTimeout(concurrencyTimeout);
  concurrencyTimeout = setTimeout(() => {
    chrome.runtime.sendMessage({ type: "SET_CONCURRENCY", value }, (response) => {
      if (chrome.runtime.lastError) { showToast("Failed to update concurrency", "error"); return; }
      if (response?.success) { showToast(`Concurrency set to ${response.maxConcurrent}`, "success"); refresh(); }
    });
  }, 300);
};

/* =====================================================
   Bulk Import — CSV / Excel
===================================================== */

els.importBtn.onclick = () => els.importFile.click();

els.importFile.onchange = () => {
  const file = els.importFile.files[0];
  if (!file) return;
  els.importFile.value = ""; // reset so same file can be re-imported

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const wb    = XLSX.read(e.target.result, { type: "binary" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows  = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

      if (!rows || rows.length < 2) {
        showToast("File appears empty or has no data rows", "error");
        return;
      }

      // Header row — try to detect URL column automatically
      const headers = rows[0].map(String);
      parsedImportRows = rows.slice(1);

      // Auto-detect: prefer a column whose header contains "url"
      const autoIdx = headers.findIndex((h) => /url/i.test(h));

      // If there is only one column, or we found a clear "url" header — load directly
      if (headers.length === 1 || (autoIdx !== -1 && headers.length <= 3)) {
        const colIdx = autoIdx !== -1 ? autoIdx : 0;
        loadUrlsFromColumn(colIdx, file.name);
        return;
      }

      // Multiple columns — show picker
      els.importColSelect.innerHTML = headers
        .map((h, i) => `<option value="${i}"${i === autoIdx ? " selected" : ""}>${h || `Column ${i + 1}`}</option>`)
        .join("");

      els.importPicker.style.display = "block";
      showToast(`${parsedImportRows.length} rows loaded from ${file.name} — pick the URL column`, "info");

    } catch (err) {
      console.error("Import parse error:", err);
      showToast("Failed to parse file: " + err.message, "error");
    }
  };
  reader.readAsBinaryString(file);
};

els.importConfirm.onclick = () => {
  const colIdx = Number(els.importColSelect.value);
  loadUrlsFromColumn(colIdx, "imported file");
  els.importPicker.style.display = "none";
};

els.importCancel.onclick = () => {
  els.importPicker.style.display = "none";
  parsedImportRows = [];
};

function loadUrlsFromColumn(colIdx, sourceName) {
  const urls = parsedImportRows
    .map((row) => String(row[colIdx] || "").trim())
    .filter((u) => u.startsWith("http"));

  if (urls.length === 0) {
    showToast("No valid URLs found in that column", "error");
    return;
  }

  // Append to existing textarea content (don't overwrite if user already has URLs)
  const existing = els.urls.value.trim();
  els.urls.value = existing ? existing + "\n" + urls.join("\n") : urls.join("\n");
  parsedImportRows = [];
  showToast(`${urls.length} URLs imported from ${sourceName}`, "success");
}

/* =====================================================
   Excel Export
===================================================== */
els.downloadReport.onclick = () => {
  els.downloadReport.disabled     = true;
  els.downloadReport.textContent  = "Preparing...";

  chrome.runtime.sendMessage({ type: "GET_SESSION_LOG" }, (response) => {
    if (chrome.runtime.lastError || !response) {
      showToast("Failed to fetch session log", "error");
    } else {
      const log = response.log || [];
      if (log.length === 0) {
        showToast("No entries to export yet", "error");
      } else {
        try {
          generateExcel(log);
          showToast(`Exported ${log.length} entries`, "success");
        } catch (err) {
          console.error("Excel generation failed:", err);
          showToast("Export failed: " + err.message, "error");
        }
      }
    }
    setTimeout(() => {
      els.downloadReport.disabled    = false;
      els.downloadReport.textContent = "⬇ Download Excel Report";
      refresh();
    }, 800);
  });
};

els.clearLog.onclick = () => {
  if (!confirm("Clear today's session log? This cannot be undone.")) return;
  chrome.runtime.sendMessage({ type: "CLEAR_SESSION_LOG" }, (response) => {
    if (chrome.runtime.lastError || !response?.success) { showToast("Failed to clear log", "error"); return; }
    showToast("Session log cleared", "success");
    refresh();
  });
};

function generateExcel(log) {
  const today   = new Date();
  const dateStr = today.toLocaleDateString("en-GB").replace(/\//g, "-");

  // Summary
  const statusCounts = {};
  let totalConfidence = 0;
  log.forEach((e) => {
    statusCounts[e.status] = (statusCounts[e.status] || 0) + 1;
    totalConfidence += e.confidence || 0;
  });
  const avgConfidence = log.length > 0 ? Math.round(totalConfidence / log.length) : 0;

  const summaryData = [
    ["CQL Session Report", ""],
    ["Generated", `${today.toLocaleDateString("en-GB")} ${today.toLocaleTimeString("en-GB")}`],
    ["", ""],
    ["Total URLs Processed", log.length],
    ["Average Confidence",   `${avgConfidence}%`],
    ["", ""],
    ["Status Breakdown", "Count"],
    ...Object.entries(statusCounts).map(([s, c]) => [s, c]),
  ];

  // Detail — now includes Part Number and Notes columns
  const headers = [
    "#","Date","Time","Original URL","Final URL","Redirected","Status",
    "SKU (Original)","SKU (Final)","SKU Match",
    "PIID (Original)","PIID (Final)","PIID Match",
    "Confidence (%)","Part Number","Notes",
  ];

  const rows = log.map((entry, i) => {
    const skuMatch  = entry.skuOriginal  !== "-" && entry.skuOriginal  === entry.skuFinal  ? "✓ Match" : entry.skuOriginal  === "-" ? "-" : "✗ Mismatch";
    const piidMatch = entry.piidOriginal !== "-" && entry.piidOriginal === entry.piidFinal ? "✓ Match" : entry.piidOriginal === "-" ? "-" : "✗ Mismatch";
    return [
      i + 1, entry.date, entry.time,
      entry.originalUrl, entry.finalUrl, entry.redirected, entry.status,
      entry.skuOriginal,  entry.skuFinal,  skuMatch,
      entry.piidOriginal, entry.piidFinal, piidMatch,
      entry.confidence,
      entry.partNumber || "",   // ← new column
      entry.notes      || "",
    ];
  });

  const wb = XLSX.utils.book_new();

  const wsSummary = XLSX.utils.aoa_to_sheet(summaryData);
  wsSummary["!cols"] = [{ wch: 30 }, { wch: 40 }];
  XLSX.utils.book_append_sheet(wb, wsSummary, "Summary");

  const wsDetail = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  wsDetail["!cols"] = [
    { wch: 4  }, { wch: 12 }, { wch: 10 },
    { wch: 55 }, { wch: 55 }, { wch: 10 }, { wch: 30 },
    { wch: 18 }, { wch: 18 }, { wch: 12 },
    { wch: 18 }, { wch: 18 }, { wch: 12 },
    { wch: 14 }, { wch: 20 }, { wch: 35 },  // Part Number + Notes wider
  ];
  XLSX.utils.book_append_sheet(wb, wsDetail, "URL Detail");

  XLSX.writeFile(wb, `CQL_Report_${dateStr}.xlsx`);
}

/* ── Init ───────────────────────────────────────────── */
startRefreshing();