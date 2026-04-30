(() => {
  if (
    document.getElementById("cql-ribbon") ||
    document.getElementById("queue-mark-done")
  ) return;

  const AUTO_COLLAPSE_MS    = 3000;
  const LOAD_DELAY          = 400;
  const SLOW_LOAD_MS        = 3000;
  const LOADING_MAX_TIMEOUT = 30000;
  const STORAGE_KEY         = "cql-markdone-pos";
  const RIBBON_STATE_KEY    = "cql-ribbon-minimised";
  const INVALID_PATTERNS    = ["/sb0/","/sb1/","/redir_sku/","/bnd/","/brand/","/cat/"];

  const el = (id) => document.getElementById(id);

  let loadStart        = performance.now();
  let redirectHistory  = [location.href];
  let finalUrlObserved = location.href;
  let capturedPartNumber = null; // filled by tryExtractPartNumber

  /* ---------------- helpers ---------------- */
  function escapeHtml(str) {
    const div = document.createElement("div");
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
    } catch { return null; }
  }
  function isReload() {
    return performance.getEntriesByType("navigation")[0]?.type === "reload";
  }
  function looksInvalid(url) {
    if (!url.endsWith(".html") && !url.includes(".html?")) return true;
    return INVALID_PATTERNS.some((p) => url.includes(p));
  }
  function copy(text, btn) {
    navigator.clipboard.writeText(text);
    btn.textContent = "✓ Copied";
    setTimeout(() => (btn.textContent = "Copy"), 1200);
  }
  function confidenceScore({ urlMatch, skuMatch, piidMatch, valid }) {
    if (!valid) return 0;
    let s = 30;
    if (skuMatch)  s += 35;
    if (piidMatch) s += 25;
    if (urlMatch)  s += 10;
    return Math.min(100, s);
  }
  function scoreColor(score) {
    if (score >= 85) return "#198754";
    if (score >= 60) return "#ffc107";
    return "#dc3545";
  }

  /* =====================================================
     Part Number Extraction
  ===================================================== */
  function extractPartNumberNow() {
    const primaryPatterns = [
      /"manufacturingPartNumberDetails"\s*:\s*\{[^}]*?"partNumber"\s*:\s*"([^"]{1,80})"/,
      /\\"manufacturingPartNumberDetails\\"\s*:\s*\{\\"partNumber\\"\s*:\s*\\"([^"\\]{1,80})\\"/,
      /"partNumber"\s*:\s*"([A-Z0-9][A-Z0-9\-_\/\.]{1,50})"/,
      /\\"partNumber\\"\s*:\s*\\"([A-Z0-9][A-Z0-9\-_\/\.]{1,50})\\"/,
    ];
    for (const script of document.querySelectorAll("script:not([src])")) {
      const text = script.textContent;
      if (text.length < 50 || text.length > 2000000) continue;
      if (!text.includes("partNumber") && !text.includes("manufacturingPartNumber")) continue;
      for (const pattern of primaryPatterns) {
        const match = text.match(pattern);
        if (match?.[1]) {
          const value = match[1].trim();
          if (value.length >= 2 && !/^(true|false|null|undefined)$/i.test(value))
            return { value, source: "inline script" };
        }
      }
    }
    const specBlock = document.querySelector('[data-name="SpecificationsPartNumber"]');
    if (specBlock) {
      const text = specBlock.querySelector("dd")?.textContent?.trim();
      if (text && text.length < 80) return { value: text, source: "spec block" };
      const raw = specBlock.textContent?.replace(/Part\s*Number/i,"").trim();
      if (raw && raw.length < 80) return { value: raw, source: "spec block (text)" };
    }
    const bbNode = document.querySelector('[data-node-id^="BlockBuilderSpecificationsPartNumber"]');
    if (bbNode) {
      const text = (bbNode.querySelector("dd") || bbNode.nextElementSibling)?.textContent?.trim();
      if (text && text.length < 80) return { value: text, source: "BlockBuilder node" };
    }
    for (const dt of document.querySelectorAll("dt")) {
      if (/part\s*number/i.test(dt.textContent)) {
        const text = dt.nextElementSibling?.textContent?.trim();
        if (text && text.length < 80) return { value: text, source: "dt/dd label" };
      }
    }
    for (const block of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const data  = JSON.parse(block.textContent);
        const items = Array.isArray(data) ? data : [data];
        for (const item of items) {
          for (const node of (item["@graph"] || [item])) {
            if (node["@type"] === "Product") {
              if (node.mpn)       return { value: String(node.mpn),       source: "JSON-LD mpn" };
              if (node.sku)       return { value: String(node.sku),       source: "JSON-LD sku" };
              if (node.productID) return { value: String(node.productID), source: "JSON-LD productID" };
              if (node.model)     return { value: String(node.model),     source: "JSON-LD model" };
            }
          }
        }
      } catch { /* skip */ }
    }
    for (const sel of ['meta[property="product:mfr_part_no"]','meta[name="mpn"]','meta[itemprop="mpn"]']) {
      const tag = document.querySelector(sel);
      if (tag?.content?.trim()) return { value: tag.content.trim(), source: "meta tag" };
    }
    return null;
  }

  function tryExtractPartNumber() {
    return new Promise((resolve) => {
      const instant = extractPartNumberNow();
      if (instant) return resolve(instant);
      const GIVE_UP_MS = 12000;
      let settled = false;
      function done(result) {
        if (settled) return;
        settled = true;
        observer.disconnect();
        clearInterval(pollTimer);
        clearTimeout(giveUpTimer);
        resolve(result);
      }
      const observer = new MutationObserver(() => { const r = extractPartNumberNow(); if (r) done(r); });
      observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
      const pollTimer   = setInterval(() => { const r = extractPartNumberNow(); if (r) done(r); }, 800);
      const giveUpTimer = setTimeout(() => done(extractPartNumberNow()), GIVE_UP_MS);
    });
  }

  /* ---------------- loading indicator ---------------- */
  let loadingRibbon, loadingTimeout, loadingMaxTimeout;
  loadingTimeout = setTimeout(() => {
    if (el("cql-ribbon")) return;
    loadingRibbon = document.createElement("div");
    loadingRibbon.id = "cql-loading";
    Object.assign(loadingRibbon.style, {
      position:"fixed",top:"0",left:"0",width:"100%",padding:"14px",
      background:"#e0f2fe",color:"#075985",fontWeight:"700",
      zIndex:"2147483646",borderBottom:"1px solid #bae6fd",textAlign:"center",
    });
    loadingRibbon.textContent = "⏳ Loading page…";
    document.documentElement.appendChild(loadingRibbon);
    loadingMaxTimeout = setTimeout(() => clearLoading(), LOADING_MAX_TIMEOUT);
  }, LOAD_DELAY);

  function clearLoading() {
    clearTimeout(loadingTimeout);
    clearTimeout(loadingMaxTimeout);
    loadingRibbon?.remove();
  }
  window.addEventListener("load", () => setTimeout(clearLoading, 300));

  /* ---------------- MARK DONE button ---------------- */
  if (!el("queue-mark-done")) {
    const btn = document.createElement("button");
    btn.id = "queue-mark-done";
    btn.textContent = "✔️ Mark Done";
    Object.assign(btn.style, {
      position:"fixed",top:"180px",left:"16px",padding:"8px 14px",
      background:"#212529",color:"#fff",border:"none",borderRadius:"6px",
      fontWeight:"600",cursor:"grab",zIndex:"2147483647",
    });
    chrome.storage.local.get(STORAGE_KEY, (res) => {
      if (res[STORAGE_KEY]) {
        btn.style.top  = res[STORAGE_KEY].top  + "px";
        btn.style.left = res[STORAGE_KEY].left + "px";
      }
    });
    let drag = false, ox = 0, oy = 0;
    btn.onmousedown = (e) => {
      drag = false;
      const r = btn.getBoundingClientRect();
      ox = e.clientX - r.left; oy = e.clientY - r.top;
      const move = (ev) => {
        drag = true;
        btn.style.left = Math.max(0, Math.min(window.innerWidth  - btn.offsetWidth,  ev.clientX - ox)) + "px";
        btn.style.top  = Math.max(0, Math.min(window.innerHeight - btn.offsetHeight, ev.clientY - oy)) + "px";
      };
      const up = () => {
        document.removeEventListener("mousemove", move);
        document.removeEventListener("mouseup",   up);
        if (drag) {
          chrome.storage.local.set({ [STORAGE_KEY]: {
            top:  btn.getBoundingClientRect().top,
            left: btn.getBoundingClientRect().left,
          }});
        } else {
          // Send notes + part number along with TASK_DONE
          const notesEl = el("cql-notes-input");
          const notes   = notesEl ? notesEl.value.trim() : "";
          btn.textContent      = "⏳ Closing…";
          btn.style.background = "#2fb344";
          chrome.runtime.sendMessage({
            type: "TASK_DONE",
            data: { notes, partNumber: capturedPartNumber || "" },
          });
        }
      };
      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup",   up);
    };
    document.documentElement.appendChild(btn);
  }

  /* ── Ctrl+Shift+W → Mark Done (existing shortcut, keep working) ── */
  /* ── Ctrl+Shift+M → toggle minimise (new shortcut) ── */
  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey && e.shiftKey) {
      if (e.key === "W" || e.key === "w") {
        e.preventDefault();
        const notesEl = el("cql-notes-input");
        const notes   = notesEl ? notesEl.value.trim() : "";
        chrome.runtime.sendMessage({
          type: "TASK_DONE",
          data: { notes, partNumber: capturedPartNumber || "" },
        });
      }
      if (e.key === "M" || e.key === "m") {
        e.preventDefault();
        const ribbon  = el("cql-ribbon");
        const miniTab = el("cql-mini-tab");
        if (!ribbon || !miniTab) return;
        const isMinimised = ribbon.style.display === "none";
        setMinimisedState(!isMinimised, ribbon, miniTab);
      }
    }
  });

  /* ---------------- redirect observer ---------------- */
  ["pushState","replaceState"].forEach((method) => {
    const original = history[method];
    history[method] = function (...args) {
      const result = original.apply(this, args);
      if (location.href !== finalUrlObserved) {
        finalUrlObserved = location.href;
        redirectHistory.push(finalUrlObserved);
      }
      return result;
    };
  });
  window.addEventListener("hashchange", () => {
    if (location.href !== finalUrlObserved) { finalUrlObserved = location.href; redirectHistory.push(finalUrlObserved); }
  });
  window.addEventListener("popstate", () => {
    if (location.href !== finalUrlObserved) { finalUrlObserved = location.href; redirectHistory.push(finalUrlObserved); }
  });

  /* =====================================================
     Minimise/restore helper (shared by button + keyboard)
  ===================================================== */
  function setMinimisedState(minimised, ribbon, miniTab) {
    ribbon.style.display  = minimised ? "none" : "block";
    miniTab.style.display = minimised ? "flex"  : "none";
    chrome.storage.local.set({ [RIBBON_STATE_KEY]: minimised });
  }

  /* =====================================================
     RIBBON
  ===================================================== */
  function renderRibbon(original, final, status) {
    clearLoading();
    if (el("cql-ribbon")) return;

    const skuO = extractSKU(original);
    const skuF = extractSKU(final);
    const piidO = extractPIID(original);
    const piidF = extractPIID(final);

    const invalid       = looksInvalid(final);
    const reloaded      = isReload();
    const slowLoad      = performance.now() - loadStart > SLOW_LOAD_MS;
    const multiRedirect = redirectHistory.length > 1;
    const urlMatch      = original === final;
    const skuMatch      = skuO === skuF;
    const piidMatch     = piidO === piidF;
    const valid         = !invalid;
    const confidence    = confidenceScore({ urlMatch, skuMatch, piidMatch, valid });

    let bg         = "#e7f1ff";
    let statusText = "NO REDIRECTION";
    let statusDot  = "#198754";
    let reason     = "Final URL matches original input";
    if (!urlMatch)  { bg = "#fff3cd"; statusText = "REDIRECTED";                    statusDot = "#e6a817"; reason = "Final URL differs from original"; }
    if (invalid)    { bg = "#f8d7da"; statusText = "UNKNOWN: URL IS INVALID";       statusDot = "#dc3545"; reason = "Invalid URL pattern detected"; }
    if (!piidMatch) { bg = "#e2d9f3"; statusText = "UNKNOWN: VARIATION NOT SELECTED"; statusDot = "#6f42c1"; reason = "PIID mismatch between original and final URL"; }

    /* ── MINI TAB ── */
    const miniTab = document.createElement("div");
    miniTab.id = "cql-mini-tab";
    Object.assign(miniTab.style, {
      position:"fixed",top:"0",right:"0",display:"none",alignItems:"center",
      gap:"8px",padding:"0 14px",height:"36px",background:bg,
      borderBottom:"1px solid rgba(0,0,0,0.15)",borderLeft:"1px solid rgba(0,0,0,0.12)",
      borderRadius:"0 0 0 8px",zIndex:"2147483646",boxShadow:"0 2px 6px rgba(0,0,0,0.12)",
      fontSize:"12px",fontFamily:"system-ui,sans-serif",whiteSpace:"nowrap",
    });
    miniTab.innerHTML = `
      <span style="width:9px;height:9px;border-radius:50%;background:${statusDot};display:inline-block;flex-shrink:0"></span>
      <span style="font-weight:700;color:#212529">${escapeHtml(statusText)}</span>
      <button id="cql-restore" title="Restore ribbon  (Ctrl+Shift+M)"
        style="padding:2px 10px;font-size:11px;font-weight:600;border:1px solid
               rgba(0,0,0,0.2);border-radius:4px;background:#fff;cursor:pointer;margin-left:4px">
        ▲ Show
      </button>
    `;
    document.documentElement.appendChild(miniTab);

    /* ── FULL RIBBON ── */
    const ribbon = document.createElement("div");
    ribbon.id = "cql-ribbon";
    Object.assign(ribbon.style, {
      position:"fixed",top:"0",left:"0",width:"100%",padding:"12px 16px",
      background:bg,zIndex:"2147483646",fontSize:"13px",
      borderBottom:"1px solid rgba(0,0,0,0.15)",fontFamily:"system-ui,sans-serif",
    });

    ribbon.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;font-weight:700">
        <div>🔁 Page processed</div>
        <div style="display:flex;align-items:center;gap:8px">
          <button id="cql-minimise" title="Minimise ribbon  (Ctrl+Shift+M)"
            style="padding:2px 10px;font-size:11px;font-weight:600;border:1px solid
                   rgba(0,0,0,0.2);border-radius:4px;background:#fff;cursor:pointer">
            ▼ Minimise
          </button>
          <span id="close" style="cursor:pointer;font-weight:700;font-size:15px;line-height:1" title="Dismiss">✕</span>
        </div>
      </div>

      <div style="margin-top:4px;font-size:12px">
        Domain: <strong>${escapeHtml(location.hostname)}</strong>
      </div>

      <div style="margin-top:4px;display:flex;gap:6px;flex-wrap:wrap">
        ${reloaded     ? `<span style="background:#ffeeba;padding:2px 6px;border-radius:6px">RELOADED</span>` : ""}
        ${slowLoad     ? `<span style="background:#cff4fc;padding:2px 6px;border-radius:6px">SLOW LOAD</span>` : ""}
        ${multiRedirect? `<span style="background:#fff3cd;padding:2px 6px;border-radius:6px">MULTI REDIRECT</span>` : ""}
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

      <hr style="border:none;border-top:1px solid rgba(0,0,0,0.1);margin:8px 0">

      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <span style="font-size:12px;font-weight:700">Part #:</span>
        <span id="cql-part-value"
          style="font-size:12px;font-family:monospace;background:rgba(0,0,0,0.06);
                 padding:2px 8px;border-radius:4px;opacity:.5;font-style:italic">
          Searching…
        </span>
        <button id="cql-copy-part"
          style="padding:2px 8px;font-size:11px;font-weight:600;border:1px solid
                 rgba(0,0,0,0.2);border-radius:4px;background:#fff;cursor:pointer;
                 margin-left:auto;display:none">
          Copy
        </button>
      </div>

      <hr style="border:none;border-top:1px solid rgba(0,0,0,0.1);margin:8px 0">

      <div style="font-size:12px">
        <label for="cql-notes-input" style="font-weight:700;display:block;margin-bottom:4px">
          📝 Notes <span style="font-weight:400;opacity:.7">(optional — saved to Excel report)</span>
        </label>
        <textarea id="cql-notes-input"
          placeholder="e.g. wrong image, price mismatch, missing description…"
          style="width:100%;box-sizing:border-box;padding:6px 8px;font-size:12px;
                 font-family:system-ui,sans-serif;border:1px solid rgba(0,0,0,0.2);
                 border-radius:6px;resize:vertical;min-height:44px;max-height:120px;
                 background:rgba(255,255,255,0.8);outline:none;"></textarea>
      </div>

      <button id="toggle"
        style="margin-top:8px;border:none;background:none;color:#0d6efd;cursor:pointer">
        Hide details
      </button>

      <div id="details" style="margin-top:6px;font-size:12px">
        <div><strong>Original URL</strong><br>${escapeHtml(original)}<br><button id="co">Copy</button></div>
        <div style="margin-top:6px"><strong>Final URL</strong><br>${escapeHtml(final)}<br><button id="cf">Copy</button></div>
      </div>

      <div style="margin-top:8px;font-size:11px;opacity:.7">
        ⚠️ This extension is under active development. Manual verification is recommended.
      </div>

      <div style="text-align:right;margin-top:6px">
        <span id="dismiss" style="cursor:pointer;text-decoration:underline">Dismiss</span>
      </div>
    `;

    document.documentElement.appendChild(ribbon);

    /* ── minimise / restore ── */
    el("cql-minimise").onclick = () => setMinimisedState(true,  ribbon, miniTab);
    el("cql-restore").onclick  = () => setMinimisedState(false, ribbon, miniTab);

    /* ── dismiss ── */
    function dismissAll() {
      ribbon.remove();
      miniTab.remove();
      chrome.storage.local.remove(RIBBON_STATE_KEY);
    }
    el("close").onclick   = dismissAll;
    el("dismiss").onclick = dismissAll;

    /* ── details toggle ── */
    let detailsOpen = true;
    el("toggle").onclick = () => {
      detailsOpen = !detailsOpen;
      el("details").style.display = detailsOpen ? "block" : "none";
      el("toggle").textContent    = detailsOpen ? "Hide details" : "Show details";
    };
    setTimeout(() => {
      if (detailsOpen) {
        detailsOpen = false;
        el("details").style.display = "none";
        el("toggle").textContent    = "Show details";
      }
    }, AUTO_COLLAPSE_MS);

    /* ── apply persisted minimise state ── */
    chrome.storage.local.get(RIBBON_STATE_KEY, (res) => {
      if (res[RIBBON_STATE_KEY] === true) setMinimisedState(true, ribbon, miniTab);
    });

    el("co").onclick = (e) => copy(original, e.target);
    el("cf").onclick = (e) => copy(final,    e.target);

    /* ── part number async fill ── */
    tryExtractPartNumber().then((partInfo) => {
      const partValueEl = el("cql-part-value");
      const copyBtn     = el("cql-copy-part");
      if (!partValueEl) return;

      if (partInfo) {
        capturedPartNumber          = partInfo.value; // store for TASK_DONE
        partValueEl.style.opacity   = "1";
        partValueEl.style.fontStyle = "normal";
        partValueEl.textContent     = partInfo.value;
        partValueEl.title           = `Source: ${partInfo.source}`;

        copyBtn.style.display = "inline-block";
        copyBtn.onclick = () => {
          navigator.clipboard.writeText(partInfo.value).then(() => {
            copyBtn.textContent       = "✓ Copied!";
            copyBtn.style.background  = "#d1e7dd";
            copyBtn.style.borderColor = "#a3cfbb";
            setTimeout(() => {
              copyBtn.textContent       = "Copy";
              copyBtn.style.background  = "#fff";
              copyBtn.style.borderColor = "rgba(0,0,0,0.2)";
            }, 1800);
          });
        };
      } else {
        partValueEl.style.opacity = "1";
        partValueEl.textContent   = "Not found";
        partValueEl.title         = "Part number not detected. Check Ctrl+U → search 'manufacturingPartNumberDetails' manually.";
      }
    });
  }

  chrome.runtime.sendMessage({ type: "GET_REDIRECT_INFO" }, (info) => {
    if (chrome.runtime.lastError) {
      console.warn("Extension context invalidated:", chrome.runtime.lastError);
      renderRibbon(location.href, location.href, null);
      return;
    }
    renderRibbon(
      info?.original || location.href,
      info?.final    || location.href,
      info?.progress
    );
  });
})();