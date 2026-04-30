const MAX_RETRIES = 2;
const MAX_CONCURRENCY_CAP = 4;

let maxConcurrent = 2;
let queue = [];
let retryQueue = [];
let activeTasks = {};
let completedCount = 0;
let failedCount = 0;
let paused = false;
let taskIdCounter = Date.now();
let queueCompletionNotified = false; // prevent double-firing

/* =====================================================
   Session Log
===================================================== */
let sessionLog = [];

function addLogEntry(entry) {
  const now = new Date();
  sessionLog.push({
    timestamp: now.toISOString(),
    date: now.toLocaleDateString("en-GB"),
    time: now.toLocaleTimeString("en-GB"),
    ...entry,
  });
  persistState();
}

/* =====================================================
   Redirect Observer Engine
===================================================== */
let redirectInfoByTab = {};
let redirectObservers = {};

/* =====================================================
   Persistence
===================================================== */
function persistState() {
  chrome.storage.local.set({
    queue, retryQueue, activeTasks,
    completedCount, failedCount, paused,
    maxConcurrent, taskIdCounter, sessionLog,
  });
}

async function restoreState() {
  const data = await chrome.storage.local.get(null);
  queue         = data.queue         || [];
  retryQueue    = data.retryQueue    || [];
  activeTasks   = data.activeTasks   || {};
  completedCount = data.completedCount || 0;
  failedCount   = data.failedCount   || 0;
  paused        = data.paused        || false;
  maxConcurrent = Math.min(MAX_CONCURRENCY_CAP, data.maxConcurrent || 2);
  taskIdCounter = data.taskIdCounter || Date.now();

  const today  = new Date().toLocaleDateString("en-GB");
  const stored = data.sessionLog || [];
  sessionLog   = stored.filter((e) => e.date === today);

  if (!paused) schedule();
}

restoreState();

/* =====================================================
   Queue-complete notification
===================================================== */
function maybeNotifyComplete() {
  if (queueCompletionNotified) return;
  if (queue.length > 0 || retryQueue.length > 0) return;
  if (Object.keys(activeTasks).length > 0) return;
  if (completedCount === 0 && failedCount === 0) return;

  queueCompletionNotified = true;

  const redirected = sessionLog.filter(
    (e) => e.status === "REDIRECTED" || e.status?.startsWith("UNKNOWN")
  ).length;

  chrome.notifications.create("cql-queue-complete", {
    type:     "basic",
    iconUrl:  "icons/icon48.png",
    title:    "✅ Queue Complete — Controlled Queue Loader",
    message:  `${completedCount} processed · ${failedCount} failed · ${redirected} redirected / flagged`,
    buttons:  [{ title: "Download Excel Report" }],
    priority: 2,
  });
}

// Handle notification button click → open popup so user can download
chrome.notifications.onButtonClicked.addListener((notifId, btnIndex) => {
  if (notifId === "cql-queue-complete" && btnIndex === 0) {
    chrome.action.openPopup().catch(() => {
      // openPopup() can fail if no focused window — fallback: just clear
    });
  }
  chrome.notifications.clear(notifId);
});

chrome.notifications.onClicked.addListener((notifId) => {
  if (notifId === "cql-queue-complete") {
    chrome.action.openPopup().catch(() => {});
    chrome.notifications.clear(notifId);
  }
});

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
  maybeNotifyComplete();
}

async function startTask(task) {
  try {
    const tab = await chrome.tabs.create({ url: task.url, active: false });
    task.tabId = tab.id;
    activeTasks[task.id] = task;
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
    addLogEntry({
      originalUrl: task.url, finalUrl: task.url,
      status: "FAILED", redirected: "No",
      skuOriginal: extractSKU(task.url) || "-", skuFinal: "-",
      piidOriginal: extractPIID(task.url) || "-", piidFinal: "-",
      confidence: 0,
      notes: `Failed after ${task.retries} retries`,
    });
  }
  persistState();
  schedule();
}

/* =====================================================
   URL Helpers
===================================================== */
function extractSKU(url) {
  const m = url.match(/-([a-zA-Z0-9]+)\.html/);
  return m ? m[1] : null;
}
function extractPIID(url) {
  try {
    const v = new URL(url).searchParams.get("piid");
    return v ? v.split("%2C").sort().join(",") : null;
  } catch { return null; }
}

const INVALID_PATTERNS = ["/sb0/","/sb1/","/redir_sku/","/bnd/","/brand/","/cat/"];
function looksInvalid(url) {
  if (!url.endsWith(".html") && !url.includes(".html?")) return true;
  return INVALID_PATTERNS.some((p) => url.includes(p));
}
function confidenceScore({ urlMatch, skuMatch, piidMatch, valid }) {
  if (!valid) return 0;
  let score = 30;
  if (skuMatch)  score += 35;
  if (piidMatch) score += 25;
  if (urlMatch)  score += 10;
  return Math.min(100, score);
}
function deriveStatus(original, final) {
  const invalid   = looksInvalid(final);
  const urlMatch  = original === final;
  const skuO      = extractSKU(original);
  const skuF      = extractSKU(final);
  const piidO     = extractPIID(original);
  const piidF     = extractPIID(final);
  const skuMatch  = skuO === skuF;
  const piidMatch = piidO === piidF;
  const valid     = !invalid;
  const confidence = confidenceScore({ urlMatch, skuMatch, piidMatch, valid });

  let status = "NO REDIRECTION";
  if (!urlMatch)  status = "REDIRECTED";
  if (invalid)    status = "UNKNOWN: URL IS INVALID";
  if (!piidMatch) status = "UNKNOWN: VARIATION NOT SELECTED";

  return {
    status,
    skuOriginal:  skuO  || "-", skuFinal:  skuF  || "-",
    piidOriginal: piidO || "-", piidFinal: piidF || "-",
    confidence,
    redirected: urlMatch ? "No" : "Yes",
  };
}

/* =====================================================
   Redirect Observer
===================================================== */
function startRedirectObserver(tabId, originalUrl) {
  redirectObservers[tabId] = { original: originalUrl, lastUrl: originalUrl, timer: null };
}
function scheduleRedirectFinalize(tabId) {
  const observer = redirectObservers[tabId];
  if (!observer) return;
  clearTimeout(observer.timer);
  observer.timer = setTimeout(() => {
    redirectInfoByTab[tabId] = { original: observer.original, final: observer.lastUrl };
  }, 2500);
}

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (!redirectObservers[tabId] || !tab?.url) return;
  const observer = redirectObservers[tabId];
  if (tab.url !== observer.lastUrl) {
    observer.lastUrl = tab.url;
    scheduleRedirectFinalize(tabId);
  }
  if (info.status === "complete") {
    chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] })
      .catch((err) => {
        if (!err.message.includes("Cannot access"))
          console.error(`Failed to inject content script in tab ${tabId}:`, err);
      });
  }
});

/* =====================================================
   Tab Removal
===================================================== */
chrome.tabs.onRemoved.addListener((tabId) => {
  if (redirectObservers[tabId]) {
    clearTimeout(redirectObservers[tabId].timer);
    delete redirectObservers[tabId];
  }
  delete redirectInfoByTab[tabId];

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
function completeTaskByTabId(tabId, reportData) {
  const entry = Object.entries(activeTasks).find(([, t]) => t.tabId === tabId);
  if (!entry) return;

  const task = activeTasks[entry[0]];
  delete activeTasks[entry[0]];
  completedCount++;

  const info     = redirectInfoByTab[tabId];
  const original = info?.original || task.url;
  const final    = info?.final    || task.url;
  const derived  = deriveStatus(original, final);

  addLogEntry({
    originalUrl: original, finalUrl: final,
    ...derived,
    // notes now come from the content script (typed by user in ribbon)
    notes: reportData?.notes || "",
    // part number passed from content script
    partNumber: reportData?.partNumber || "",
  });

  delete redirectInfoByTab[tabId];
  if (redirectObservers[tabId]) {
    clearTimeout(redirectObservers[tabId].timer);
    delete redirectObservers[tabId];
  }

  chrome.tabs.remove(tabId).catch((err) => {
    console.warn(`Tab ${tabId} already closed or removed:`, err);
  });

  persistState();
  schedule();
}

/* =====================================================
   Helper: Create Task
===================================================== */
function createTask(url) {
  try { new URL(url); } catch {
    console.warn(`Invalid URL skipped: ${url}`);
    return null;
  }
  return { id: taskIdCounter++, url, retries: 0 };
}

/* =====================================================
   Helper: Clean Up Active Tasks
===================================================== */
async function cleanupAllActiveTasks() {
  const tabIds = Object.values(activeTasks).map((t) => t.tabId).filter(Boolean);
  if (tabIds.length > 0) {
    try { await chrome.tabs.remove(tabIds); }
    catch (err) { console.warn("Some tabs could not be removed:", err); }
  }
  Object.keys(redirectObservers).forEach((tabId) => {
    clearTimeout(redirectObservers[tabId]?.timer);
    delete redirectObservers[tabId];
  });
  activeTasks    = {};
  redirectInfoByTab = {};
}

/* =====================================================
   Messages
===================================================== */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.type) {

    case "TASK_DONE":
      if (sender.tab?.id) completeTaskByTabId(sender.tab.id, msg.data || {});
      return false;

    case "START_QUEUE":
      (async () => {
        try {
          await cleanupAllActiveTasks();
          const tasks = msg.urls.map((url) => createTask(url)).filter(Boolean);
          if (tasks.length === 0) { sendResponse({ success: false, error: "No valid URLs provided" }); return; }
          queue          = tasks;
          retryQueue     = [];
          completedCount = 0;
          failedCount    = 0;
          paused         = false;
          queueCompletionNotified = false; // reset so notification fires again
          persistState();
          schedule();
          sendResponse({ success: true, queued: tasks.length });
        } catch (err) {
          console.error("START_QUEUE error:", err);
          sendResponse({ success: false, error: err.message });
        }
      })();
      return true;

    case "CLEAR_QUEUE":
      (async () => {
        try {
          await cleanupAllActiveTasks();
          queue          = [];
          retryQueue     = [];
          completedCount = 0;
          failedCount    = 0;
          paused         = true;
          queueCompletionNotified = false;
          persistState();
          sendResponse({ success: true });
        } catch (err) {
          console.error("CLEAR_QUEUE error:", err);
          sendResponse({ success: false, error: err.message });
        }
      })();
      return true;

    case "SET_CONCURRENCY":
      maxConcurrent = Math.max(1, Math.min(MAX_CONCURRENCY_CAP, msg.value));
      persistState();
      schedule();
      sendResponse({ success: true, maxConcurrent });
      return true;

    case "STATUS":
      sendResponse({
        pending: queue.length,
        active:  Object.keys(activeTasks).length,
        completed: completedCount,
        failed:  failedCount,
        paused,
        maxConcurrent,
        logCount: sessionLog.length,
      });
      return true;

    case "GET_REDIRECT_INFO":
      sendResponse(sender.tab?.id && redirectInfoByTab[sender.tab.id]
        ? redirectInfoByTab[sender.tab.id]
        : null);
      return true;

    case "GET_SESSION_LOG":
      sendResponse({ log: sessionLog });
      return true;

    case "CLEAR_SESSION_LOG":
      sessionLog = [];
      persistState();
      sendResponse({ success: true });
      return true;
  }
  return false;
});