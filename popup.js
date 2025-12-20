const els = {
  status: document.getElementById("status"),
  completed: document.getElementById("completed"),
  active: document.getElementById("active"),
  pending: document.getElementById("pending"),
  failed: document.getElementById("failed")
};

const startBtn = document.getElementById("start");
const pauseBtn = document.getElementById("pause");
const resumeBtn = document.getElementById("resume");
const urlsInput = document.getElementById("urls");

function refresh() {
  chrome.runtime.sendMessage({ type: "STATUS" }, r => {
    if (!r) return;
    els.status.textContent = r.paused ? "Paused" : "Running";
    els.completed.textContent = r.completed;
    els.active.textContent = r.active;
    els.pending.textContent = r.pending;
    els.failed.textContent = r.failed;
  });
}

startBtn.onclick = () => {
  const urls = urlsInput.value
    .split("\n")
    .map(u => u.trim())
    .filter(Boolean);

  if (!urls.length) return;

  chrome.runtime.sendMessage(
    { type: "START_QUEUE", urls },
    refresh
  );
};

pauseBtn.onclick = () =>
  chrome.runtime.sendMessage({ type: "PAUSE" }, refresh);

resumeBtn.onclick = () =>
  chrome.runtime.sendMessage({ type: "RESUME" }, refresh);

refresh();
setTimeout(refresh, 1000);
