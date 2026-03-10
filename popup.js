const els = {
  status: document.getElementById("status"),
  completed: document.getElementById("completed"),
  active: document.getElementById("active"),
  pending: document.getElementById("pending"),
  failed: document.getElementById("failed"),
  urls: document.getElementById("urls"),
  concurrency: document.getElementById("concurrency"),
  start: document.getElementById("start"),
  clear: document.getElementById("clear"),
  toast: document.getElementById("toast"),
  downloadReport: document.getElementById("downloadReport"),
  clearLog: document.getElementById("clearLog"),
  logCount: document.getElementById("logCount"),
};

let refreshInterval;

/* ------------------ Toast System ------------------ */

function showToast(message, type = "info") {
  els.toast.textContent = message;
  els.toast.className = `toast ${type}`;

  setTimeout(() => {
    els.toast.className = "toast hidden";
  }, 3000);
}

/* ------------------ Status refresh ------------------ */

function refresh() {
  chrome.runtime.sendMessage({ type: "STATUS" }, (r) => {
    if (chrome.runtime.lastError) {
      console.error("Failed to get status:", chrome.runtime.lastError);
      return;
    }

    if (!r) return;

    els.status.textContent = r.paused ? "Paused" : "Running";
    els.completed.textContent = r.completed;
    els.active.textContent = r.active;
    els.pending.textContent = r.pending;
    els.failed.textContent = r.failed;

    if (document.activeElement !== els.concurrency) {
      els.concurrency.value = r.maxConcurrent;
    }

    els.clear.disabled = r.pending === 0 && r.active === 0;

    // Update log count badge
    const count = r.logCount || 0;
    els.logCount.textContent = `${count} entr${count === 1 ? "y" : "ies"}`;
    els.downloadReport.disabled = count === 0;
    els.clearLog.disabled = count === 0;
  });
}

/* ------------------ Smart Refresh ------------------ */

function startRefreshing() {
  refresh();
  refreshInterval = setInterval(refresh, 1000);
}

function stopRefreshing() {
  clearInterval(refreshInterval);
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    stopRefreshing();
  } else {
    startRefreshing();
  }
});

/* ------------------ Actions ------------------ */

els.start.onclick = () => {
  const urls = els.urls.value
    .split("\n")
    .map((u) => u.trim())
    .filter(Boolean);

  if (!urls.length) {
    showToast("Please enter at least one URL", "error");
    return;
  }

  els.start.disabled = true;
  els.start.textContent = "Starting...";

  chrome.runtime.sendMessage({ type: "START_QUEUE", urls }, (response) => {
    if (chrome.runtime.lastError) {
      showToast(
        "Failed to start queue: " + chrome.runtime.lastError.message,
        "error",
      );
      els.start.disabled = false;
      els.start.textContent = "Start";
      return;
    }

    if (response && response.success) {
      showToast(`Started queue with ${response.queued} URLs`, "success");
      els.urls.value = "";
    } else {
      showToast(response?.error || "Failed to start queue", "error");
    }

    setTimeout(() => {
      els.start.disabled = false;
      els.start.textContent = "Start";
      refresh();
    }, 500);
  });
};

els.clear.onclick = () => {
  els.clear.disabled = true;
  els.clear.textContent = "Clearing...";

  chrome.runtime.sendMessage({ type: "CLEAR_QUEUE" }, (response) => {
    if (chrome.runtime.lastError) {
      showToast(
        "Failed to clear queue: " + chrome.runtime.lastError.message,
        "error",
      );
      els.clear.disabled = false;
      els.clear.textContent = "Clear queue";
      return;
    }

    if (response && response.success) {
      showToast("Queue cleared successfully", "success");
    } else {
      showToast("Failed to clear queue", "error");
    }

    setTimeout(() => {
      els.clear.disabled = false;
      els.clear.textContent = "Clear queue";
      refresh();
    }, 500);
  });
};

let concurrencyTimeout;

els.concurrency.onchange = () => {
  const value = Math.max(1, Math.min(4, Number(els.concurrency.value)));

  clearTimeout(concurrencyTimeout);

  concurrencyTimeout = setTimeout(() => {
    chrome.runtime.sendMessage(
      { type: "SET_CONCURRENCY", value },
      (response) => {
        if (chrome.runtime.lastError) {
          showToast("Failed to update concurrency", "error");
          return;
        }

        if (response && response.success) {
          showToast(`Concurrency set to ${response.maxConcurrent}`, "success");
          refresh();
        }
      },
    );
  }, 300);
};

/* ------------------ Excel Export ------------------ */

els.downloadReport.onclick = () => {
  els.downloadReport.disabled = true;
  els.downloadReport.textContent = "Preparing...";

  chrome.runtime.sendMessage({ type: "GET_SESSION_LOG" }, (response) => {
    if (chrome.runtime.lastError || !response) {
      showToast("Failed to fetch session log", "error");
      els.downloadReport.disabled = false;
      els.downloadReport.textContent = "⬇ Download Excel Report";
      return;
    }

    const log = response.log || [];

    if (log.length === 0) {
      showToast("No entries to export yet", "error");
      els.downloadReport.disabled = false;
      els.downloadReport.textContent = "⬇ Download Excel Report";
      return;
    }

    try {
      generateExcel(log);
      showToast(`Exported ${log.length} entries`, "success");
    } catch (err) {
      console.error("Excel generation failed:", err);
      showToast("Export failed: " + err.message, "error");
    }

    setTimeout(() => {
      els.downloadReport.disabled = false;
      els.downloadReport.textContent = "⬇ Download Excel Report";
      refresh();
    }, 800);
  });
};

els.clearLog.onclick = () => {
  if (!confirm("Clear today's session log? This cannot be undone.")) return;

  chrome.runtime.sendMessage({ type: "CLEAR_SESSION_LOG" }, (response) => {
    if (chrome.runtime.lastError || !response?.success) {
      showToast("Failed to clear log", "error");
      return;
    }
    showToast("Session log cleared", "success");
    refresh();
  });
};

/* ------------------ Excel Generation (SheetJS) ------------------ */

function generateExcel(log) {
  const today = new Date();
  const dateStr = today
    .toLocaleDateString("en-GB")
    .replace(/\//g, "-"); // DD-MM-YYYY

  // ---- Summary sheet data ----
  const statusCounts = {};
  let totalConfidence = 0;

  log.forEach((e) => {
    statusCounts[e.status] = (statusCounts[e.status] || 0) + 1;
    totalConfidence += e.confidence || 0;
  });

  const avgConfidence =
    log.length > 0 ? Math.round(totalConfidence / log.length) : 0;

  const summaryData = [
    ["CQL Session Report", ""],
    ["Generated", `${today.toLocaleDateString("en-GB")} ${today.toLocaleTimeString("en-GB")}`],
    ["", ""],
    ["Total URLs Processed", log.length],
    ["Average Confidence", `${avgConfidence}%`],
    ["", ""],
    ["Status Breakdown", "Count"],
    ...Object.entries(statusCounts).map(([status, count]) => [status, count]),
  ];

  // ---- Detail sheet data ----
  const headers = [
    "#",
    "Date",
    "Time",
    "Original URL",
    "Final URL",
    "Redirected",
    "Status",
    "SKU (Original)",
    "SKU (Final)",
    "SKU Match",
    "PIID (Original)",
    "PIID (Final)",
    "PIID Match",
    "Confidence (%)",
    "Notes",
  ];

  const rows = log.map((entry, i) => {
    const skuMatch =
      entry.skuOriginal !== "-" && entry.skuOriginal === entry.skuFinal
        ? "✓ Match"
        : entry.skuOriginal === "-"
        ? "-"
        : "✗ Mismatch";

    const piidMatch =
      entry.piidOriginal !== "-" && entry.piidOriginal === entry.piidFinal
        ? "✓ Match"
        : entry.piidOriginal === "-"
        ? "-"
        : "✗ Mismatch";

    return [
      i + 1,
      entry.date,
      entry.time,
      entry.originalUrl,
      entry.finalUrl,
      entry.redirected,
      entry.status,
      entry.skuOriginal,
      entry.skuFinal,
      skuMatch,
      entry.piidOriginal,
      entry.piidFinal,
      piidMatch,
      entry.confidence,
      entry.notes || "",
    ];
  });

  const detailData = [headers, ...rows];

  // ---- Build workbook ----
  const wb = XLSX.utils.book_new();

  // Summary sheet
  const wsSummary = XLSX.utils.aoa_to_sheet(summaryData);
  wsSummary["!cols"] = [{ wch: 30 }, { wch: 40 }];
  XLSX.utils.book_append_sheet(wb, wsSummary, "Summary");

  // Detail sheet
  const wsDetail = XLSX.utils.aoa_to_sheet(detailData);
  wsDetail["!cols"] = [
    { wch: 4 },   // #
    { wch: 12 },  // Date
    { wch: 10 },  // Time
    { wch: 55 },  // Original URL
    { wch: 55 },  // Final URL
    { wch: 10 },  // Redirected
    { wch: 30 },  // Status
    { wch: 18 },  // SKU Original
    { wch: 18 },  // SKU Final
    { wch: 12 },  // SKU Match
    { wch: 18 },  // PIID Original
    { wch: 18 },  // PIID Final
    { wch: 12 },  // PIID Match
    { wch: 14 },  // Confidence
    { wch: 30 },  // Notes
  ];
  XLSX.utils.book_append_sheet(wb, wsDetail, "URL Detail");

  // ---- Trigger download ----
  const filename = `CQL_Report_${dateStr}.xlsx`;
  XLSX.writeFile(wb, filename);
}

/* ------------------ Init ------------------ */

startRefreshing();