let maxConcurrent = 2;
const MAX_RETRIES = 2;

let queue = [];
let retryQueue = [];
let activeTasks = {};
let completedCount = 0;
let failedCount = 0;
let paused = false;
let scheduling = false;

/* ---------- Persistence ---------- */

function persistState() {
  chrome.storage.local.set({
    queue,
    retryQueue,
    activeTasks,
    completedCount,
    failedCount,
    paused,
    maxConcurrent
  });
}

async function restoreState() {
  const data = await chrome.storage.local.get(null);
  queue = data.queue || [];
  retryQueue = data.retryQueue || [];
  activeTasks = data.activeTasks || {};
  completedCount = data.completedCount || 0;
  failedCount = data.failedCount || 0;
  paused = data.paused || false;
  maxConcurrent = Math.min(Math.max(data.maxConcurrent || 2, 1), 5);
  if (!paused) schedule();
}

restoreState();

/* ---------- Scheduler ---------- */

async function schedule() {
  if (paused || scheduling) return;
  scheduling = true;
  try {
    while (
      Object.keys(activeTasks).length < maxConcurrent &&
      (queue.length || retryQueue.length)
    ) {
      const task = queue.shift() || retryQueue.shift();
      await startTask(task);
    }
  } finally {
    scheduling = false;
    persistState();
  }
}

/* ---------- Task Lifecycle ---------- */

async function startTask(task) {
  try {
    const tab = await chrome.tabs.create({
      url: task.url,
      active: false
    });
    task.tabId = tab.id;
    task.redirectChecked = false;
    activeTasks[task.id] = task;
  } catch {
    handleFailure(task);
  }
}

function handleFailure(task) {
  task.retries = (task.retries || 0) + 1;
  if (task.retries <= MAX_RETRIES) retryQueue.push(task);
  else failedCount++;
}

/* ---------- Completion ---------- */

function completeTaskByTab(tabId) {
  const entry = Object.entries(activeTasks).find(
    ([, t]) => t.tabId === tabId
  );
  if (!entry) return;

  delete activeTasks[entry[0]];
  completedCount++;
  chrome.tabs.remove(tabId);
  persistState();
  schedule();
}

/* ---------- Messages ---------- */

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.type) {
    case "TASK_DONE":
      if (sender.tab?.id) completeTaskByTab(sender.tab.id);
      break;

    case "START_QUEUE":
      queue = msg.urls.map((url, i) => ({
        id: i + 1,
        url,
        retries: 0,
        tabId: null,
        redirectChecked: false
      }));
      retryQueue = [];
      activeTasks = {};
      completedCount = 0;
      failedCount = 0;
      paused = false;
      persistState();
      schedule();
      break;

    case "CLEAR_QUEUE":
      queue = [];
      retryQueue = [];
      paused = true;
      persistState();
      break;

    case "SET_CONCURRENCY":
      maxConcurrent = Math.min(Math.max(msg.value, 1), 5);
      persistState();
      schedule();
      break;

    case "PAUSE":
      paused = true;
      persistState();
      break;

    case "RESUME":
      paused = false;
      persistState();
      schedule();
      break;

    case "STATUS":
      sendResponse({
        pending: queue.length,
        active: Object.keys(activeTasks).length,
        completed: completedCount,
        failed: failedCount,
        paused,
        maxConcurrent
      });
      break;
  }
  return true;
});

/* ---------- Shortcut ---------- */

chrome.commands.onCommand.addListener(cmd => {
  if (cmd !== "mark-done") return;
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    if (tabs[0]) completeTaskByTab(tabs[0].id);
  });
});

/* ---------- Redirect Check ---------- */

chrome.tabs.onUpdated.addListener(async (tabId, info) => {
  if (info.status !== "complete") return;
  const task = Object.values(activeTasks).find(t => t.tabId === tabId);
  if (!task || task.redirectChecked) return;

  task.redirectChecked = true;
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content.js"]
  });

  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab.url && tab.url !== task.url) {
      chrome.tabs.sendMessage(tabId, {
        type: "SHOW_REDIRECT_NOTICE",
        original: task.url,
        final: tab.url
      });
    }
  } catch {}
});
