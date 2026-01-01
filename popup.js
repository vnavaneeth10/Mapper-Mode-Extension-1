const els = {
  status: document.getElementById("status"),
  completed: document.getElementById("completed"),
  active: document.getElementById("active"),
  pending: document.getElementById("pending"),
  failed: document.getElementById("failed"),
  urls: document.getElementById("urls"),
  concurrency: document.getElementById("concurrency"),
  autoDone: document.getElementById("autoDone"),
  start: document.getElementById("start"),
  clear: document.getElementById("clear")
};

const toast = document.getElementById("toast");

/* ---------- Toast helpers ---------- */

function closeToastImmediately() {
  toast.className = "toast hidden";
  toast.innerHTML = "";
}

function showConfirmToast() {
  toast.className = "toast show";
  toast.innerHTML = `
    Clear all pending tasks?
    <div class="toast-actions">
      <button id="toast-clear" class="confirm">Clear</button>
      <button id="toast-cancel" class="cancel">Cancel</button>
    </div>
  `;

  document.getElementById("toast-cancel").onclick = () => {
    closeToastImmediately();
  };

  document.getElementById("toast-clear").onclick = () => {
    // 🔒 Close UI FIRST
    closeToastImmediately();

    // Then perform action
    chrome.runtime.sendMessage({ type: "CLEAR_QUEUE" }, () => {
      showSuccessToast();
      refresh();
    });
  };
}

function showSuccessToast() {
  toast.className = "toast show success";
  toast.textContent = "Queue cleared";

  setTimeout(() => {
    closeToastImmediately();
  }, 1800);
}

/* ---------- Restore settings ---------- */

chrome.storage.local.get(
  ["maxConcurrent", "autoDoneOnClose"],
  res => {
    els.concurrency.value = res.maxConcurrent || 2;
    els.autoDone.checked = !!res.autoDoneOnClose;
  }
);

/* ---------- Status ---------- */

function refresh() {
  chrome.runtime.sendMessage({ type: "STATUS" }, r => {
    if (!r) return;

    els.status.textContent = r.paused ? "Paused" : "Running";
    els.completed.textContent = r.completed;
    els.active.textContent = r.active;
    els.pending.textContent = r.pending;
    els.failed.textContent = r.failed;

    els.concurrency.value = r.maxConcurrent;
    els.autoDone.checked = r.autoDoneOnClose;

    // Disable Clear when nothing to clear
    els.clear.disabled = !(r.pending > 0 || r.active > 0);
  });
}

/* ---------- Actions ---------- */

els.start.onclick = () => {
  const urls = els.urls.value
    .split("\n")
    .map(u => u.trim())
    .filter(Boolean);

  if (!urls.length) return;

  chrome.runtime.sendMessage({ type: "START_QUEUE", urls }, refresh);
};

els.clear.onclick = () => {
  if (els.clear.disabled) return;
  showConfirmToast();
};

els.concurrency.onchange = () => {
  const value = Math.max(1, Math.min(6, Number(els.concurrency.value)));
  chrome.runtime.sendMessage({ type: "SET_CONCURRENCY", value });
};

els.autoDone.onchange = () => {
  chrome.runtime.sendMessage({
    type: "SET_AUTO_DONE",
    value: els.autoDone.checked
  });
};

/* ---------- Init ---------- */

refresh();
setInterval(refresh, 1000);
