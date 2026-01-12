const MAX_RETRIES = 2;
const MAX_CONCURRENCY_CAP = 4;

let maxConcurrent = 2;
let queue = [];
let retryQueue = [];
let activeTasks = {};
let completedCount = 0;
let failedCount = 0;
let paused = false;

/* ------------------ Redirect store (Pattern A) ------------------ */

const redirectInfoByTab = {};

/* ------------------ Persistence ------------------ */

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
  maxConcurrent = Math.min(MAX_CONCURRENCY_CAP, data.maxConcurrent || 2);

  if (!paused) schedule();
}

restoreState();

/* ------------------ Scheduler ------------------ */

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
      active: false
    });

    task.tabId = tab.id;
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

/* ------------------ Completion ------------------ */

function completeTaskByTabId(tabId) {
  const entry = Object.entries(activeTasks).find(
    ([, t]) => t.tabId === tabId
  );
  if (!entry) return;

  delete activeTasks[entry[0]];
  completedCount++;

  delete redirectInfoByTab[tabId];
  chrome.tabs.remove(tabId);
  persistState();
  schedule();
}

/* ------------------ Tab lifecycle ------------------ */

chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status !== "complete") return;

  const task = Object.values(activeTasks).find(t => t.tabId === tabId);
  if (!task) return;

  chrome.scripting.executeScript({
    target: { tabId },
    files: ["content.js"]
  });

  chrome.tabs.get(tabId, tab => {
    if (!tab?.url) return;

    if (tab.url !== task.url) {
      redirectInfoByTab[tabId] = {
        original: task.url,
        final: tab.url
      };
    }
  });
});

/* ------------------ Messages ------------------ */

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.type) {
    case "TASK_DONE":
      if (sender.tab?.id) {
        completeTaskByTabId(sender.tab.id);
      }
      break;

    case "START_QUEUE":
      queue = msg.urls.map((url, i) => ({
        id: i + 1,
        url,
        retries: 0
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
      activeTasks = {};
      completedCount = 0;
      failedCount = 0;
      paused = true;
      persistState();
      break;

    case "SET_CONCURRENCY":
      maxConcurrent = Math.max(
        1,
        Math.min(MAX_CONCURRENCY_CAP, msg.value)
      );
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

    case "GET_REDIRECT_INFO":
      if (sender.tab?.id && redirectInfoByTab[sender.tab.id]) {
        sendResponse(redirectInfoByTab[sender.tab.id]);
      } else {
        sendResponse(null);
      }
      break;
  }
});
