const MAX_CONCURRENT = 2;
const MAX_RETRIES = 2;

let queue = [];
let retryQueue = [];
let activeTasks = {};
let completedCount = 0;
let failedCount = 0;
let paused = false;
let initialized = false;
let scheduling = false;

// prevents duplicate injections
const injectedTabs = new Set();

/* ---------- Persistence ---------- */

function persistState() {
  chrome.storage.local.set({
    queue,
    retryQueue,
    activeTasks,
    completedCount,
    failedCount,
    paused
  });
}

/* ---------- Restore + Crash Recovery ---------- */

async function restoreState() {
  const data = await chrome.storage.local.get([
    "queue",
    "retryQueue",
    "activeTasks",
    "completedCount",
    "failedCount",
    "paused"
  ]);

  queue = data.queue || [];
  retryQueue = data.retryQueue || [];
  completedCount = data.completedCount || 0;
  failedCount = data.failedCount || 0;
  paused = data.paused || false;

  const storedActive = data.activeTasks || {};
  activeTasks = {};

  const tabs = await chrome.tabs.query({ windowType: "normal" });
  const liveTabIds = new Set(tabs.map(t => t.id));

  for (const task of Object.values(storedActive)) {
    if (task.tabId && liveTabIds.has(task.tabId)) {
      activeTasks[task.id] = task;
    } else {
      if (task.startedAt) {
        task.totalTimeMs += Date.now() - task.startedAt;
        task.startedAt = null;
      }
      task.tabId = null;
      handleFailure(task);
    }
  }

  initialized = true;
  if (!paused) schedule();
}

restoreState();

/* ---------- Scheduler ---------- */

async function schedule() {
  if (!initialized || paused || scheduling) return;

  scheduling = true;
  try {
    while (
      Object.keys(activeTasks).length < MAX_CONCURRENT &&
      (queue.length > 0 || retryQueue.length > 0)
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
  const placeholder = `pending-${task.id}`;
  activeTasks[placeholder] = task;

  try {
    const tab = await chrome.tabs.create({
      url: task.url,
      active: false
    });

    delete activeTasks[placeholder];
    task.tabId = tab.id;
    task.startedAt = Date.now();
    activeTasks[task.id] = task;
  } catch {
    delete activeTasks[placeholder];
    handleFailure(task);
  }
}

function handleFailure(task) {
  if (task.startedAt) {
    task.totalTimeMs += Date.now() - task.startedAt;
    task.startedAt = null;
  }

  task.retries = (task.retries || 0) + 1;

  if (task.retries <= MAX_RETRIES) {
    retryQueue.push(task);
  } else {
    failedCount++;
  }
}

/* ---------- Completion ---------- */

function completeTaskByTab(tabId) {
  const task = Object.values(activeTasks).find(t => t.tabId === tabId);
  if (!task) return;

  task.totalTimeMs += Date.now() - task.startedAt;
  task.startedAt = null;

  delete activeTasks[task.id];
  injectedTabs.delete(tabId);
  completedCount++;

  chrome.tabs.remove(tabId);
  persistState();
  schedule();
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.type) {
    case "TASK_DONE":
      if (sender.tab?.id) completeTaskByTab(sender.tab.id);
      break;

    case "START_QUEUE":
      if (Object.keys(activeTasks).length > 0) {
        sendResponse({ error: "Tasks already running" });
        return true;
      }

      queue = msg.urls.map((url, i) => ({
        id: i + 1,
        url,
        retries: 0,
        startedAt: null,
        totalTimeMs: 0,
        tabId: null
      }));

      retryQueue = [];
      activeTasks = {};
      completedCount = 0;
      failedCount = 0;
      paused = false;

      persistState();
      schedule();
      sendResponse({ status: "started" });
      break;

    case "PAUSE":
      paused = true;
      persistState();
      sendResponse({ status: "paused" });
      break;

    case "RESUME":
      paused = false;
      persistState();
      schedule();
      sendResponse({ status: "resumed" });
      break;

    case "STATUS":
      sendResponse({
        pending: queue.length,
        retrying: retryQueue.length,
        active: Object.keys(activeTasks).filter(k => !k.startsWith("pending")).length,
        completed: completedCount,
        failed: failedCount,
        paused
      });
      break;
  }
  return true;
});

/* ---------- Keyboard Shortcut ---------- */

chrome.commands.onCommand.addListener(command => {
  if (command !== "mark-done") return;

  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    if (tabs[0]) completeTaskByTab(tabs[0].id);
  });
});

/* ---------- Inject Button ---------- */

chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status !== "complete") return;
  if (injectedTabs.has(tabId)) return;

  const isActive = Object.values(activeTasks).some(t => t.tabId === tabId);
  if (!isActive) return;

  injectedTabs.add(tabId);

  chrome.scripting.executeScript({
    target: { tabId },
    files: ["content.js"]
  });
});
