const MAX_CONCURRENT = 2;
const MAX_RETRIES = 2;

let queue = [];
let retryQueue = [];
let activeTasks = {}; // taskId -> task
let completedCount = 0;
let failedCount = 0;
let paused = false;
let initialized = false;

// prevents parallel schedulers
let scheduling = false;

/* =======================
   Persistence
======================= */

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

/* =======================
   Restore + crash-safe recovery
======================= */

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

  // check which tabs actually still exist
  const tabs = await chrome.tabs.query({});
  const liveTabIds = new Set(tabs.map(t => t.id));

  for (const task of Object.values(storedActive)) {
    if (task.tabId && liveTabIds.has(task.tabId)) {
      // task is genuinely still active
      activeTasks[task.id] = task;
    } else {
      // real crash / closed tab
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

/* =======================
   Scheduler (FIXED)
======================= */

async function schedule() {
  if (!initialized || paused || scheduling) return;

  scheduling = true;

  try {
    while (
      Object.keys(activeTasks).length < MAX_CONCURRENT &&
      (queue.length > 0 || retryQueue.length > 0)
    ) {
      const task = queue.shift() || retryQueue.shift();
      await startTask(task); // 🔴 CRITICAL FIX
    }
  } finally {
    scheduling = false;
    persistState();
  }
}

/* =======================
   Task lifecycle
======================= */

async function startTask(task) {
  // reserve slot synchronously
  const placeholderId = `pending-${task.id}`;
  activeTasks[placeholderId] = task;

  try {
    const tab = await chrome.tabs.create({
      url: task.url,
      active: false
    });

    delete activeTasks[placeholderId];

    task.tabId = tab.id;
    task.startedAt = Date.now();
    activeTasks[task.id] = task;
  } catch (err) {
    delete activeTasks[placeholderId];
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

/* =======================
   Explicit completion
======================= */

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.type) {
    case "TASK_DONE": {
      const tabId = sender.tab?.id;
      if (!tabId) return;

      const task = Object.values(activeTasks).find(t => t.tabId === tabId);
      if (!task) return;

      task.totalTimeMs += Date.now() - task.startedAt;
      task.startedAt = null;

      delete activeTasks[task.id];
      completedCount++;

      chrome.tabs.remove(tabId);
      persistState();
      schedule();
      break;
    }

    case "START_QUEUE": {
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
    }

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

/* =======================
   Inject "Mark Done" button
======================= */

chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status !== "complete") return;

  const isActiveTask = Object.values(activeTasks)
    .some(t => t.tabId === tabId);

  if (!isActiveTask) return;

  chrome.scripting.executeScript({
    target: { tabId },
    files: ["content.js"]
  });
});
