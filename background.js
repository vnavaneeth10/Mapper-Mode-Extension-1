const MAX_RETRIES = 2;
const MAX_CONCURRENCY_CAP = 4;

let maxConcurrent = 2;
let queue = [];
let retryQueue = [];
let activeTasks = {};
let completedCount = 0;
let failedCount = 0;
let paused = false;
let taskIdCounter = Date.now(); // Unique task IDs

/* =====================================================
   Redirect Observer Engine
===================================================== */

let redirectInfoByTab = {};
let redirectObservers = {}; // tabId -> { lastUrl, timer }

/* =====================================================
   Persistence
===================================================== */

function persistState() {
  chrome.storage.local.set({
    queue,
    retryQueue,
    activeTasks,
    completedCount,
    failedCount,
    paused,
    maxConcurrent,
    taskIdCounter,
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
  maxConcurrent = Math.min(MAX_CONCURRENCY_CAP, data.maxConcurrent || 2);
  taskIdCounter = data.taskIdCounter || Date.now();

  if (!paused) schedule();
}

restoreState();

/* =====================================================
   Scheduler
===================================================== */

async function schedule() {
  if (paused) return;

  while (
    Object.keys(activeTasks).length < maxConcurrent &&
    (queue.length || retryQueue.length)
  ) {
    const task = queue.shift() || retryQueue.shift();
    await startTask(task);
  }

  persistState();
}

async function startTask(task) {
  try {
    const tab = await chrome.tabs.create({
      url: task.url,
      active: false,
    });

    task.tabId = tab.id;
    activeTasks[task.id] = task;

    // Initialize redirect observer
    startRedirectObserver(tab.id, task.url);
  } catch (err) {
    console.error(`Failed to create tab for task ${task.id}:`, err);
    handleFailure(task);
  }
}

function handleFailure(task) {
  task.retries = (task.retries || 0) + 1;
  if (task.retries <= MAX_RETRIES) {
    retryQueue.push(task);
  } else {
    failedCount++;
  }
  persistState();
  schedule();
}

/* =====================================================
   Redirect Observer Logic
===================================================== */

function startRedirectObserver(tabId, originalUrl) {
  redirectObservers[tabId] = {
    original: originalUrl,
    lastUrl: originalUrl,
    timer: null,
  };
}

function scheduleRedirectFinalize(tabId) {
  const observer = redirectObservers[tabId];
  if (!observer) return;

  clearTimeout(observer.timer);

  observer.timer = setTimeout(() => {
    redirectInfoByTab[tabId] = {
      original: observer.original,
      final: observer.lastUrl,
    };
  }, 2500); // final stabilization window
}

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (!redirectObservers[tabId]) return;
  if (!tab?.url) return;

  const observer = redirectObservers[tabId];

  if (tab.url !== observer.lastUrl) {
    observer.lastUrl = tab.url;
    scheduleRedirectFinalize(tabId);
  }

  // Inject content.js once page loads
  if (info.status === "complete") {
    chrome.scripting
      .executeScript({
        target: { tabId },
        files: ["content.js"],
      })
      .catch((err) => {
        // Silently fail on restricted pages (chrome://, about:, etc.)
        if (!err.message.includes("Cannot access")) {
          console.error(
            `Failed to inject content script in tab ${tabId}:`,
            err,
          );
        }
      });
  }
});

/* =====================================================
   Tab Removal Handler - CRITICAL FIX
===================================================== */

chrome.tabs.onRemoved.addListener((tabId) => {
  // Clean up redirect observers
  if (redirectObservers[tabId]) {
    clearTimeout(redirectObservers[tabId].timer);
    delete redirectObservers[tabId];
  }
  delete redirectInfoByTab[tabId];

  // Handle task failure if tab was closed externally
  const entry = Object.entries(activeTasks).find(([, t]) => t.tabId === tabId);

  if (entry) {
    console.warn(`Tab ${tabId} closed externally, marking task as failed`);
    const task = activeTasks[entry[0]];
    delete activeTasks[entry[0]];
    handleFailure(task);
  }
});

/* =====================================================
   Completion
===================================================== */

function completeTaskByTabId(tabId) {
  const entry = Object.entries(activeTasks).find(([, t]) => t.tabId === tabId);
  if (!entry) return;

  delete activeTasks[entry[0]];
  completedCount++;

  delete redirectInfoByTab[tabId];

  // Clean up observer
  if (redirectObservers[tabId]) {
    clearTimeout(redirectObservers[tabId].timer);
    delete redirectObservers[tabId];
  }

  // Close tab with error handling
  chrome.tabs.remove(tabId).catch((err) => {
    console.warn(`Tab ${tabId} already closed or removed:`, err);
  });

  persistState();
  schedule();
}

/* =====================================================
   Helper: Create Task with Validation
===================================================== */

function createTask(url) {
  // Validate URL
  try {
    new URL(url);
  } catch (err) {
    console.warn(`Invalid URL skipped: ${url}`);
    return null;
  }

  return {
    id: taskIdCounter++,
    url,
    retries: 0,
  };
}

/* =====================================================
   Helper: Clean Up All Active Tasks
===================================================== */

async function cleanupAllActiveTasks() {
  const tabIds = Object.values(activeTasks)
    .map((t) => t.tabId)
    .filter(Boolean);

  if (tabIds.length > 0) {
    try {
      await chrome.tabs.remove(tabIds);
    } catch (err) {
      console.warn("Some tabs could not be removed:", err);
    }
  }

  // Clear all observers
  Object.keys(redirectObservers).forEach((tabId) => {
    clearTimeout(redirectObservers[tabId]?.timer);
    delete redirectObservers[tabId];
  });

  activeTasks = {};
  redirectInfoByTab = {};
}

/* =====================================================
   Messages - FIXED with proper return values
===================================================== */

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.type) {
    case "TASK_DONE":
      if (sender.tab?.id) completeTaskByTabId(sender.tab.id);
      return false; // Synchronous, no response needed

    case "START_QUEUE":
      (async () => {
        try {
          // Clean up existing tasks first
          await cleanupAllActiveTasks();

          // Filter and create valid tasks
          const tasks = msg.urls.map((url) => createTask(url)).filter(Boolean);

          if (tasks.length === 0) {
            sendResponse({ success: false, error: "No valid URLs provided" });
            return;
          }

          queue = tasks;
          retryQueue = [];
          completedCount = 0;
          failedCount = 0;
          paused = false;

          persistState();
          schedule();

          sendResponse({ success: true, queued: tasks.length });
        } catch (err) {
          console.error("START_QUEUE error:", err);
          sendResponse({ success: false, error: err.message });
        }
      })();
      return true; // Async response

    case "CLEAR_QUEUE":
      (async () => {
        try {
          await cleanupAllActiveTasks();

          queue = [];
          retryQueue = [];
          completedCount = 0;
          failedCount = 0;
          paused = true;

          persistState();

          sendResponse({ success: true });
        } catch (err) {
          console.error("CLEAR_QUEUE error:", err);
          sendResponse({ success: false, error: err.message });
        }
      })();
      return true; // Async response

    case "SET_CONCURRENCY":
      maxConcurrent = Math.max(1, Math.min(MAX_CONCURRENCY_CAP, msg.value));
      persistState();
      schedule();
      sendResponse({ success: true, maxConcurrent });
      return true; // Keep channel open

    case "STATUS":
      sendResponse({
        pending: queue.length,
        active: Object.keys(activeTasks).length,
        completed: completedCount,
        failed: failedCount,
        paused,
        maxConcurrent,
      });
      return true; // Keep channel open

    case "GET_REDIRECT_INFO":
      if (sender.tab?.id && redirectInfoByTab[sender.tab.id]) {
        sendResponse(redirectInfoByTab[sender.tab.id]);
      } else {
        sendResponse(null);
      }
      return true; // Keep channel open
  }

  return false; // Close channel for unhandled messages
});
