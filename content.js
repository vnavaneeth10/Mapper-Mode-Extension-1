(() => {
  /* =====================================================
     CONSTANTS
  ===================================================== */

  const LOAD_DELAY = 400;
  const BLANK_DELAY = 1200;
  const AUTO_COLLAPSE_MS = 6000;

  const WAYFAIR_INVALID_PATTERNS = [
    "/sb0/",
    "/sb1/",
    "/redir_sku/",
    "/bnd/",
    "/brand/",
    "/cat/"
  ];

  /* =====================================================
     HELPERS
  ===================================================== */

  function el(id) {
    return document.getElementById(id);
  }

  function remove(id) {
    el(id)?.remove();
  }

  function pageLooksBlank() {
    return (
      document.body &&
      document.body.innerText.trim().length === 0 &&
      document.images.length === 0
    );
  }

  function isWayfair(url) {
    try {
      return new URL(url).hostname.includes("wayfair.");
    } catch {
      return false;
    }
  }

  function extractPIID(url) {
    try {
      return new URL(url).searchParams.get("piid");
    } catch {
      return null;
    }
  }

  function extractSlug(url) {
    const match = url.match(/\/pdp\/.*?\/(.*?)(?:\.html|$)/);
    return match ? match[1] : null;
  }

  function isInvalidWayfairURL(finalUrl) {
    return (
      !finalUrl.endsWith(".html") ||
      WAYFAIR_INVALID_PATTERNS.some(p => finalUrl.includes(p))
    );
  }

  function copyText(text, indicatorEl) {
    navigator.clipboard.writeText(text).then(() => {
      indicatorEl.textContent = "✓ Copied";
      setTimeout(() => (indicatorEl.textContent = "Copy"), 1200);
    });
  }

  /* =====================================================
     LOADING UI (unchanged)
  ===================================================== */

  let loadingShown = false;
  let centerShown = false;

  function showTopLoadingRibbon() {
    if (loadingShown || el("queue-redirect-ribbon")) return;
    loadingShown = true;

    const r = document.createElement("div");
    r.id = "queue-loading-ribbon";

    Object.assign(r.style, {
      position: "fixed",
      top: "0",
      left: "0",
      width: "100%",
      padding: "14px 16px",
      background: "#e0f2fe",
      color: "#075985",
      fontSize: "16px",
      fontWeight: "600",
      zIndex: "2147483644",
      borderBottom: "1px solid #bae6fd"
    });

    r.textContent = "⏳ Loading page… please wait";
    document.documentElement.appendChild(r);
  }

  function showCenterOverlay() {
    if (centerShown || el("queue-redirect-ribbon")) return;
    centerShown = true;

    const o = document.createElement("div");
    o.id = "queue-loading-center";

    Object.assign(o.style, {
      position: "fixed",
      top: "50%",
      left: "50%",
      transform: "translate(-50%, -50%)",
      padding: "18px 26px",
      fontSize: "16px",
      fontWeight: "600",
      background: "#f8fafc",
      color: "#0f172a",
      borderRadius: "12px",
      zIndex: "2147483645",
      boxShadow: "0 10px 28px rgba(0,0,0,0.18)",
      pointerEvents: "none"
    });

    o.textContent = "Loading content…";
    document.documentElement.appendChild(o);
  }

  function clearLoadingUI() {
    remove("queue-loading-ribbon");
    remove("queue-loading-center");
  }

  setTimeout(showTopLoadingRibbon, LOAD_DELAY);
  setTimeout(() => {
    if (pageLooksBlank()) showCenterOverlay();
  }, BLANK_DELAY);

  window.addEventListener("load", () => {
    setTimeout(clearLoadingUI, 600);
  });

  /* =====================================================
     MARK DONE – RESPONSIVE (from Phase 3.1)
  ===================================================== */

  if (!el("queue-mark-done")) {
    const btn = document.createElement("button");
    btn.id = "queue-mark-done";
    btn.textContent = "✔️ Mark Done";

    let clicked = false;

    Object.assign(btn.style, {
      position: "fixed",
      top: "180px",
      left: "16px",
      padding: "8px 14px",
      background: "#2f2f2f",
      color: "#fff",
      border: "none",
      borderRadius: "6px",
      cursor: "pointer",
      zIndex: "2147483647",
      fontWeight: "600"
    });

    btn.onclick = () => {
      if (clicked) return;
      clicked = true;

      btn.textContent = "⏳ Closing tab…";
      btn.style.background = "#2fb344";
      btn.style.opacity = "0.9";

      chrome.runtime.sendMessage({ type: "TASK_DONE" });
    };

    document.documentElement.appendChild(btn);
  }

  /* =====================================================
     WAYFAIR STATUS RESOLUTION (unchanged logic)
  ===================================================== */

  function evaluateWayfair(original, final) {
    if (!isWayfair(final)) {
      return { icon: "ℹ️", text: "No redirection detected", bg: "#e7f1ff", fg: "#084298" };
    }

    if (isInvalidWayfairURL(final)) {
      return { icon: "⛔", text: "UNKNOWN : URL IS INVALID", bg: "#f8d7da", fg: "#842029" };
    }

    const po = extractPIID(original);
    const pf = extractPIID(final);

    if (
      pf === "null" ||
      (po && !pf) ||
      (!po && pf) ||
      (po && pf && po !== pf)
    ) {
      return { icon: "🧩", text: "UNKNOWN : VARIATION NOT SELECTED", bg: "#e2d9f3", fg: "#4b2e83" };
    }

    const so = extractSlug(original);
    const sf = extractSlug(final);

    if (so && sf && so !== sf) {
      return { icon: "🔁", text: "SKU REDIRECTED", bg: "#fff3cd", fg: "#664d03" };
    }

    return { icon: "✅", text: "NO REDIRECTION DETECTED", bg: "#e7f1ff", fg: "#084298" };
  }

  /* =====================================================
     REDIRECT RIBBON – PHASE 3.2
  ===================================================== */

  function renderRedirectRibbon(original, final) {
    clearLoadingUI();
    if (el("queue-redirect-ribbon")) return;

    const status = evaluateWayfair(original, final);
    const domain = new URL(final).hostname;

    const ribbon = document.createElement("div");
    ribbon.id = "queue-redirect-ribbon";

    Object.assign(ribbon.style, {
      position: "fixed",
      top: "0",
      left: "0",
      width: "100%",
      padding: "12px 16px",
      background: status.bg,
      color: status.fg,
      borderBottom: "1px solid rgba(0,0,0,0.1)",
      zIndex: "2147483646",
      fontSize: "13px",
      boxSizing: "border-box"
    });

    ribbon.innerHTML = `
      <div style="display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px">
        <div style="display:flex;align-items:center;gap:8px;font-weight:700">
          <span>${status.icon}</span>
          <span>${status.text}</span>
        </div>
        <div style="display:flex;gap:10px;font-size:12px">
          <span id="qr-dismiss" style="cursor:pointer;text-decoration:underline">Dismiss for this task</span>
          <span id="qr-close" style="cursor:pointer;font-weight:700">✕</span>
        </div>
      </div>

      <div style="margin-top:4px;font-size:12px;opacity:.85">
        Domain: ${domain}
      </div>

      <button id="qr-toggle"
        style="margin-top:6px;border:none;background:none;color:#0d6efd;
               cursor:pointer;font-size:12px;padding:0">
        Hide details
      </button>

      <div id="qr-details"
           style="margin-top:6px;font-size:12px;word-break:break-all">
        <div><strong>${status.icon} Status</strong></div>
        <div style="margin-bottom:6px">${status.text}</div>

        <div><strong>Original URL</strong></div>
        <div>${original}</div>
        <button id="copy-original" style="margin-top:2px;font-size:11px">Copy</button>

        <div style="margin-top:6px"><strong>Final URL</strong></div>
        <div>${final}</div>
        <button id="copy-final" style="margin-top:2px;font-size:11px">Copy</button>
      </div>
    `;

    document.documentElement.appendChild(ribbon);

    let expanded = true;

    el("qr-toggle").onclick = () => {
      expanded = !expanded;
      el("qr-details").style.display = expanded ? "block" : "none";
      el("qr-toggle").textContent = expanded ? "Hide details" : "Show details";
    };

    setTimeout(() => {
      if (expanded) {
        expanded = false;
        el("qr-details").style.display = "none";
        el("qr-toggle").textContent = "Show details";
      }
    }, AUTO_COLLAPSE_MS);

    el("qr-close").onclick = () => ribbon.remove();
    el("qr-dismiss").onclick = () => ribbon.remove();

    el("copy-original").onclick = e => copyText(original, e.target);
    el("copy-final").onclick = e => copyText(final, e.target);
  }

  /* =====================================================
     PULL REDIRECT INFO (Pattern A)
  ===================================================== */

  chrome.runtime.sendMessage({ type: "GET_REDIRECT_INFO" }, info => {
    if (info) {
      renderRedirectRibbon(info.original, info.final);
    }
  });
})();
