(() => {
  // Prevent multiple injections
  if (document.getElementById('cql-ribbon') || document.getElementById('queue-mark-done')) {
    return;
  }

  const AUTO_COLLAPSE_MS = 3000;
  const LOAD_DELAY = 400;
  const SLOW_LOAD_MS = 3000;
  const LOADING_MAX_TIMEOUT = 30000; // 30 seconds max for loading indicator
  const STORAGE_KEY = "cql-markdone-pos";
  const INVALID_PATTERNS = ["/sb0/", "/sb1/", "/redir_sku/", "/bnd/", "/brand/", "/cat/"];

  const el = id => document.getElementById(id);

  let loadStart = performance.now();
  let redirectHistory = [location.href];
  let finalUrlObserved = location.href;

  /* ---------------- helpers ---------------- */

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function extractSKU(url) {
    const m = url.match(/-([a-zA-Z0-9]+)\.html/);
    return m ? m[1] : null;
  }

  function extractPIID(url) {
    try {
      const v = new URL(url).searchParams.get("piid");
      return v ? v.split("%2C").sort().join(",") : null;
    } catch {
      return null;
    }
  }

  function isReload() {
    const nav = performance.getEntriesByType("navigation")[0];
    return nav?.type === "reload";
  }

  function looksInvalid(url) {
    if (!url.endsWith(".html") && !url.includes(".html?")) return true;
    return INVALID_PATTERNS.some(p => url.includes(p));
  }

  function copy(text, btn) {
    navigator.clipboard.writeText(text);
    btn.textContent = "✓ Copied";
    setTimeout(() => (btn.textContent = "Copy"), 1200);
  }

  function confidenceScore({ urlMatch, skuMatch, piidMatch, valid }) {
    let score = 0;
    
    // Invalid URL = 0 confidence
    if (!valid) return 0;
    
    score += 30; // Base for valid URL
    
    // SKU match is critical for product pages
    if (skuMatch) score += 35;
    
    // PIID match confirms variant
    if (piidMatch) score += 25;
    
    // URL match is less important (canonical redirects are valid)
    if (urlMatch) score += 10;
    
    return Math.min(100, score);
  }

  function scoreColor(score) {
    if (score >= 85) return "#198754";
    if (score >= 60) return "#ffc107";
    return "#dc3545";
  }

  /* ---------------- loading indicator ---------------- */

  let loadingRibbon;
  let loadingTimeout;
  let loadingMaxTimeout;
  
  loadingTimeout = setTimeout(() => {
    if (el("cql-ribbon")) return;
    
    loadingRibbon = document.createElement("div");
    loadingRibbon.id = "cql-loading";
    Object.assign(loadingRibbon.style, {
      position: "fixed",
      top: "0",
      left: "0",
      width: "100%",
      padding: "14px",
      background: "#e0f2fe",
      color: "#075985",
      fontWeight: "700",
      zIndex: "2147483646",
      borderBottom: "1px solid #bae6fd",
      textAlign: "center"
    });
    loadingRibbon.textContent = "⏳ Loading page…";
    document.documentElement.appendChild(loadingRibbon);
    
    // Safety: remove after max timeout
    loadingMaxTimeout = setTimeout(() => {
      clearLoading();
    }, LOADING_MAX_TIMEOUT);
  }, LOAD_DELAY);

  function clearLoading() {
    clearTimeout(loadingTimeout);
    clearTimeout(loadingMaxTimeout);
    loadingRibbon?.remove();
  }

  window.addEventListener("load", () => setTimeout(clearLoading, 300));

  /* ---------------- MARK DONE (persisted) ---------------- */

  if (!el("queue-mark-done")) {
    const btn = document.createElement("button");
    btn.id = "queue-mark-done";
    btn.textContent = "✔️ Mark Done";

    Object.assign(btn.style, {
      position: "fixed",
      top: "180px",
      left: "16px",
      padding: "8px 14px",
      background: "#212529",
      color: "#fff",
      border: "none",
      borderRadius: "6px",
      fontWeight: "600",
      cursor: "grab",
      zIndex: "2147483647"
    });

    chrome.storage.local.get(STORAGE_KEY, res => {
      if (res[STORAGE_KEY]) {
        btn.style.top = res[STORAGE_KEY].top + "px";
        btn.style.left = res[STORAGE_KEY].left + "px";
      }
    });

    let drag = false, ox = 0, oy = 0;

    btn.onmousedown = e => {
      drag = false;
      const r = btn.getBoundingClientRect();
      ox = e.clientX - r.left;
      oy = e.clientY - r.top;

      const move = ev => {
        drag = true;
        // Bound the button within viewport
        const newLeft = Math.max(0, Math.min(window.innerWidth - btn.offsetWidth, ev.clientX - ox));
        const newTop = Math.max(0, Math.min(window.innerHeight - btn.offsetHeight, ev.clientY - oy));
        btn.style.left = newLeft + "px";
        btn.style.top = newTop + "px";
      };

      const up = () => {
        document.removeEventListener("mousemove", move);
        document.removeEventListener("mouseup", up);

        if (drag) {
          chrome.storage.local.set({
            [STORAGE_KEY]: {
              top: btn.getBoundingClientRect().top,
              left: btn.getBoundingClientRect().left
            }
          });
        } else {
          btn.textContent = "⏳ Closing…";
          btn.style.background = "#2fb344";
          chrome.runtime.sendMessage({ type: "TASK_DONE" });
        }
      };

      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup", up);
    };

    document.documentElement.appendChild(btn);
  }

  /* ---------------- redirect observer - FIXED with History API ---------------- */

  // Modern approach for SPA navigation
  ['pushState', 'replaceState'].forEach(method => {
    const original = history[method];
    history[method] = function(...args) {
      const result = original.apply(this, args);
      if (location.href !== finalUrlObserved) {
        finalUrlObserved = location.href;
        redirectHistory.push(finalUrlObserved);
      }
      return result;
    };
  });

  // Catch hashchange and popstate
  window.addEventListener('hashchange', () => {
    if (location.href !== finalUrlObserved) {
      finalUrlObserved = location.href;
      redirectHistory.push(finalUrlObserved);
    }
  });

  window.addEventListener('popstate', () => {
    if (location.href !== finalUrlObserved) {
      finalUrlObserved = location.href;
      redirectHistory.push(finalUrlObserved);
    }
  });

  /* ---------------- RIBBON ---------------- */

  function renderRibbon(original, final, status) {
    clearLoading();
    if (el("cql-ribbon")) return;

    const skuO = extractSKU(original);
    const skuF = extractSKU(final);
    const piidO = extractPIID(original);
    const piidF = extractPIID(final);

    const invalid = looksInvalid(final);
    const reloaded = isReload();
    const slowLoad = performance.now() - loadStart > SLOW_LOAD_MS;
    const multiRedirect = redirectHistory.length > 1;

    const urlMatch = original === final;
    const skuMatch = skuO === skuF;
    const piidMatch = piidO === piidF;
    const valid = !invalid;

    const confidence = confidenceScore({ urlMatch, skuMatch, piidMatch, valid });

    let bg = "#e7f1ff";
    let statusText = "NO REDIRECTION";
    let reason = "Final URL matches original input";

    if (!urlMatch) {
      bg = "#fff3cd";
      statusText = "REDIRECTED";
      reason = "Final URL differs from original";
    }

    if (invalid) {
      bg = "#f8d7da";
      statusText = "UNKNOWN : URL IS INVALID";
      reason = "Invalid URL pattern detected";
    }

    if (!piidMatch) {
      bg = "#e2d9f3";
      statusText = "UNKNOWN : VARIATION NOT SELECTED";
      reason = "PIID mismatch between original and final URL";
    }

    const ribbon = document.createElement("div");
    ribbon.id = "cql-ribbon";

    Object.assign(ribbon.style, {
      position: "fixed",
      top: "0",
      left: "0",
      width: "100%",
      padding: "12px 16px",
      background: bg,
      zIndex: "2147483646",
      fontSize: "13px",
      borderBottom: "1px solid rgba(0,0,0,0.15)"
    });

    // Using escapeHtml to prevent XSS
    ribbon.innerHTML = `
      <div style="display:flex;justify-content:space-between;font-weight:700">
        <div>🔁 Page processed</div>
        <div>${status || ""}</div>
      </div>

      <div style="margin-top:4px;font-size:12px">
        Domain: <strong>${escapeHtml(location.hostname)}</strong>
      </div>

      <div style="margin-top:4px;display:flex;gap:6px;flex-wrap:wrap">
        ${reloaded ? `<span style="background:#ffeeba;padding:2px 6px;border-radius:6px">RELOADED</span>` : ""}
        ${slowLoad ? `<span style="background:#cff4fc;padding:2px 6px;border-radius:6px">SLOW LOAD</span>` : ""}
        ${multiRedirect ? `<span style="background:#fff3cd;padding:2px 6px;border-radius:6px">MULTI REDIRECT</span>` : ""}
        <span style="background:#dee2e6;padding:2px 6px;border-radius:6px">BETA</span>
      </div>

      <div style="margin-top:8px;font-weight:700">${statusText}</div>
      <div style="font-size:12px;opacity:.8">${reason}</div>

      <div style="margin-top:8px;display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <div><strong>SKU</strong><br>O: ${escapeHtml(skuO || "-")}<br>F: ${escapeHtml(skuF || "-")}</div>
        <div><strong>PIID</strong><br>O: ${escapeHtml(piidO || "-")}<br>F: ${escapeHtml(piidF || "-")}</div>
      </div>

      <div style="margin-top:6px;font-size:12px">
        Confidence: <strong style="color:${scoreColor(confidence)}">${confidence}%</strong>
      </div>

      <button id="toggle" style="margin-top:8px;border:none;background:none;color:#0d6efd;cursor:pointer">Hide details</button>

      <div id="details" style="margin-top:6px;font-size:12px">
        <div><strong>Original URL</strong><br>${escapeHtml(original)}<br><button id="co">Copy</button></div>
        <div style="margin-top:6px"><strong>Final URL</strong><br>${escapeHtml(final)}<br><button id="cf">Copy</button></div>
      </div>

      <div style="margin-top:8px;font-size:11px;opacity:.7">
        ⚠️ This extension is under active development. Manual verification is recommended.
      </div>

      <div style="text-align:right;margin-top:6px">
        <span id="dismiss" style="cursor:pointer;text-decoration:underline">Dismiss</span>
        &nbsp;&nbsp;
        <span id="close" style="cursor:pointer;font-weight:700">✕</span>
      </div>
    `;

    document.documentElement.appendChild(ribbon);

    let open = true;
    el("toggle").onclick = () => {
      open = !open;
      el("details").style.display = open ? "block" : "none";
      el("toggle").textContent = open ? "Hide details" : "Show details";
    };

    setTimeout(() => {
      if (open) {
        open = false;
        el("details").style.display = "none";
        el("toggle").textContent = "Show details";
      }
    }, AUTO_COLLAPSE_MS);

    el("co").onclick = e => copy(original, e.target);
    el("cf").onclick = e => copy(final, e.target);
    el("close").onclick = () => ribbon.remove();
    el("dismiss").onclick = () => ribbon.remove();
  }

  // Request redirect info with error handling
  chrome.runtime.sendMessage({ type: "GET_REDIRECT_INFO" }, info => {
    if (chrome.runtime.lastError) {
      console.warn('Extension context invalidated:', chrome.runtime.lastError);
      // Fallback: render with current URL
      renderRibbon(location.href, location.href, null);
      return;
    }
    renderRibbon(info?.original || location.href, info?.final || location.href, info?.progress);
  });
})();