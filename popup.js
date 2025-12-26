document.addEventListener("DOMContentLoaded", () => {
  const $ = (id) => document.getElementById(id);

  function refresh() {
    chrome.runtime.sendMessage({ type: "STATUS" }, (r) => {
      if (!r) return;
      $("status").textContent = r.paused ? "Paused" : "Running";
      $("active").textContent = r.active;
      $("pending").textContent = r.pending;
      $("completed").textContent = r.completed;
      $("failed").textContent = r.failed;
      $("concurrency").value = r.maxConcurrent;
    });
  }

  $("start").onclick = () => {
    const urls = $("urls")
      .value.split("\n")
      .map((u) => u.trim())
      .filter(Boolean);
    if (urls.length)
      chrome.runtime.sendMessage({ type: "START_QUEUE", urls }, refresh);
  };

  $("pause").onclick = () =>
    chrome.runtime.sendMessage({ type: "PAUSE" }, refresh);

  $("resume").onclick = () =>
    chrome.runtime.sendMessage({ type: "RESUME" }, refresh);

  $("clear").onclick = () => {
    if (confirm("Clear all pending URLs? Open tabs will remain open."))
      chrome.runtime.sendMessage({ type: "CLEAR_QUEUE" }, refresh);
  };

  $("concurrency").onchange = () =>
    chrome.runtime.sendMessage({
      type: "SET_CONCURRENCY",
      value: Number($("concurrency").value),
    });

  refresh();
});
