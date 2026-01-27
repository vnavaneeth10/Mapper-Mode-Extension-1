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

    // Only update concurrency if user is not currently editing it
    if (document.activeElement !== els.concurrency) {
      els.concurrency.value = r.maxConcurrent;
    }

    els.clear.disabled = r.pending === 0 && r.active === 0;
  });
}

/* ------------------ Smart Refresh (stop when hidden) ------------------ */

function startRefreshing() {
  refresh();
  refreshInterval = setInterval(refresh, 1000);
}

function stopRefreshing() {
  clearInterval(refreshInterval);
}

// Only refresh when popup is visible
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

  // Disable button during operation
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
      els.urls.value = ""; // Clear input on success
    } else {
      showToast(response?.error || "Failed to start queue", "error");
    }

    // Re-enable button
    setTimeout(() => {
      els.start.disabled = false;
      els.start.textContent = "Start";
      refresh(); // Immediate refresh
    }, 500);
  });
};

els.clear.onclick = () => {
  // Disable button during operation
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

    // Re-enable button
    setTimeout(() => {
      els.clear.disabled = false;
      els.clear.textContent = "Clear queue";
      refresh(); // Immediate refresh
    }, 500);
  });
};

let concurrencyTimeout;

els.concurrency.onchange = () => {
  const value = Math.max(1, Math.min(4, Number(els.concurrency.value)));

  // Clear any pending timeout
  clearTimeout(concurrencyTimeout);

  // Debounce to avoid conflicts with refresh
  concurrencyTimeout = setTimeout(() => {
    chrome.runtime.sendMessage(
      {
        type: "SET_CONCURRENCY",
        value,
      },
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
  }, 300); // 300ms debounce
};

/* ------------------ Init ------------------ */

startRefreshing();
