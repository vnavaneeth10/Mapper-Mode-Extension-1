const els = {
  status: document.getElementById("status"),
  completed: document.getElementById("completed"),
  active: document.getElementById("active"),
  pending: document.getElementById("pending"),
  failed: document.getElementById("failed"),
  urls: document.getElementById("urls"),
  concurrency: document.getElementById("concurrency"),
  start: document.getElementById("start"),
  clear: document.getElementById("clear")
};

/* ------------------ Status refresh ------------------ */

function refresh() {
  chrome.runtime.sendMessage({ type: "STATUS" }, r => {
    if (!r) return;

    els.status.textContent = r.paused ? "Paused" : "Running";
    els.completed.textContent = r.completed;
    els.active.textContent = r.active;
    els.pending.textContent = r.pending;
    els.failed.textContent = r.failed;
    els.concurrency.value = r.maxConcurrent;

    els.clear.disabled = r.pending === 0 && r.active === 0;
  });
}

/* ------------------ Actions ------------------ */

els.start.onclick = () => {
  const urls = els.urls.value
    .split("\n")
    .map(u => u.trim())
    .filter(Boolean);

  if (!urls.length) return;

  // 🔒 fire-and-forget (NO callback)
  chrome.runtime.sendMessage({ type: "START_QUEUE", urls });
};

els.clear.onclick = () => {
  // 🔒 fire-and-forget (NO callback)
  chrome.runtime.sendMessage({ type: "CLEAR_QUEUE" });
};

els.concurrency.onchange = () => {
  const value = Math.max(1, Math.min(4, Number(els.concurrency.value)));
  chrome.runtime.sendMessage({
    type: "SET_CONCURRENCY",
    value
  });
};

/* ------------------ Init ------------------ */

refresh();
setInterval(refresh, 1000);
