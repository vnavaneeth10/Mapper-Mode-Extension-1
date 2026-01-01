const MAX_RETRIES = 2;
let maxConcurrent = 2;

let queue = [];
let retryQueue = [];
let activeTasks = {};
let completedCount = 0;
let failedCount = 0;
let paused = false;

let intentionalClose = new Set();
let pendingCloseConfirm = null;
let autoDoneOnClose = false;

/* ------------------ Persistence ------------------ */

function persistState() {
  chrome.storage.local.set({
    queue,
    retryQueue,
    activeTasks,
    completedCount,
    failedCount,
    paused,
    maxConcurrent,
    autoDoneOnClose,
    pendingCloseConfirm
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
  maxConcurrent = data.maxConcurrent || 2;
  autoDoneOnClose = data.autoDoneOnClose || false;
  pendingCloseConfirm = data.pendingCloseConfirm || null;

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

function completeTask(taskId, tabId) {
  if (tabId) intentionalClose.add(tabId);
  delete activeTasks[taskId];
  completedCount++;
  paused = false;
  persistState();
  schedule();
}

/* ------------------ Tab Close Detection ------------------ */

chrome.tabs.onRemoved.addListener(tabId => {
  if (intentionalClose.has(tabId)) {
    intentionalClose.delete(tabId);
    return;
  }

  const entry = Object.entries(activeTasks).find(
    ([, t]) => t.tabId === tabId
  );
  if (!entry) return;

  const [taskId, task] = entry;

  if (autoDoneOnClose) {
    completeTask(taskId);
    return;
  }

  paused = true;
  pendingCloseConfirm = {
    taskId,
    url: task.url
  };

  persistState();
});

/* ------------------ Inline Confirmation Messaging ------------------ */

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.type) {
    case "TASK_DONE":
      if (sender.tab?.id) {
        const entry = Object.entries(activeTasks).find(
          ([, t]) => t.tabId === sender.tab.id
        );
        if (entry) completeTask(entry[0], sender.tab.id);
      }
      break;

    case "CONFIRM_CLOSE_ACTION": {
      const { action } = msg;
      const pending = pendingCloseConfirm;
      if (!pending) break;

      if (action === "done") {
        completeTask(pending.taskId);
      }

      if (action === "reopen") {
        chrome.tabs.create({ url: pending.url });
        paused = false;
      }

      if (action === "ignore") {
        // keep paused
      }

      pendingCloseConfirm = null;
      persistState();
      break;
    }

    case "GET_PENDING_CONFIRM":
      sendResponse(pendingCloseConfirm);
      break;

    case "SET_AUTO_DONE":
      autoDoneOnClose = !!msg.value;
      persistState();
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
      pendingCloseConfirm = null;
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
        maxConcurrent,
        autoDoneOnClose
      });
      break;
  }
  return true;
});
