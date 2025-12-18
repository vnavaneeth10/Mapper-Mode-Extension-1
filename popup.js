const statusEl = document.getElementById("status");
const completedEl = document.getElementById("completed");
const activeEl = document.getElementById("active");
const pendingEl = document.getElementById("pending");
const failedEl = document.getElementById("failed");

const pauseBtn = document.getElementById("pause");
const resumeBtn = document.getElementById("resume");
const startBtn = document.getElementById("start");
const urlsInput = document.getElementById("urls");

function refresh() {
  chrome.runtime.sendMessage({ type: "STATUS" }, res => {
    if (!res) return;
    statusEl.textContent = res.paused ? "Paused" : "Running";
    completedEl.textContent = res.completed;
    activeEl.textContent = res.active;
    pendingEl.textContent = res.pending;
    failedEl.textContent = res.failed;
  });
}

startBtn.onclick = () => {
  const urls = urlsInput.value
    .split("\n")
    .map(u => u.trim())
    .filter(Boolean);

  if (!urls.length) return;

  chrome.runtime.sendMessage({
    type: "START_QUEUE",
    urls
  }, refresh);
};

pauseBtn.onclick = () =>
  chrome.runtime.sendMessage({ type: "PAUSE" }, refresh);

resumeBtn.onclick = () =>
  chrome.runtime.sendMessage({ type: "RESUME" }, refresh);

refresh();
setInterval(refresh, 1000);
