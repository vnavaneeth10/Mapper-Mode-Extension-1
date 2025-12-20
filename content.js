(() => {
  // Injects a manual completion button only into tabs explicitly opened by the extension
  if (window.__QUEUE_MARK_DONE_INJECTED__) return;
  window.__QUEUE_MARK_DONE_INJECTED__ = true;

  const ID = "queue-mark-done";
  const hostname = location.hostname;
  const STORAGE_KEY = `button-pos::${hostname}`;

  const btn = document.createElement("button");
  btn.id = ID;
  btn.textContent = "✓ Mark Done";

  let isDragging = false;
  let offsetX = 0;
  let offsetY = 0;

  btn.style.cssText = `
    position: fixed;
    top: 16px;
    left: 16px;
    padding: 8px 12px;
    font-size: 13px;
    background: rgba(17,17,17,0.85);
    color: #fff;
    border: none;
    border-radius: 6px;
    cursor: grab;
    z-index: 2147483647;
    user-select: none;
  `;

  chrome.storage.local.get(STORAGE_KEY, res => {
    if (res[STORAGE_KEY]) {
      btn.style.top = `${res[STORAGE_KEY].top}px`;
      btn.style.left = `${res[STORAGE_KEY].left}px`;
    }
  });

  btn.addEventListener("mousedown", e => {
    if (e.button !== 0) return;
    isDragging = true;
    btn.style.cursor = "grabbing";

    const rect = btn.getBoundingClientRect();
    offsetX = e.clientX - rect.left;
    offsetY = e.clientY - rect.top;
    e.preventDefault();
  });

  document.addEventListener("mousemove", e => {
    if (!isDragging) return;
    btn.style.left = `${Math.max(0, e.clientX - offsetX)}px`;
    btn.style.top = `${Math.max(0, e.clientY - offsetY)}px`;
  });

  document.addEventListener("mouseup", () => {
    if (!isDragging) return;
    isDragging = false;
    btn.style.cursor = "grab";

    const rect = btn.getBoundingClientRect();
    chrome.storage.local.set({
      [STORAGE_KEY]: {
        top: Math.round(rect.top),
        left: Math.round(rect.left)
      }
    });
  });

  btn.addEventListener("click", () => {
    if (!isDragging) {
      chrome.runtime.sendMessage({ type: "TASK_DONE" });
    }
  });

  document.documentElement.appendChild(btn);
})();
