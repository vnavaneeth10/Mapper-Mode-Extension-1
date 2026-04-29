(() => {
  // Prevent multiple injections
  if (
    document.getElementById("cql-ribbon") ||
    document.getElementById("queue-mark-done")
  ) {
    return;
  }

  const AUTO_COLLAPSE_MS = 3000;
  const LOAD_DELAY = 400;
  const SLOW_LOAD_MS = 3000;
  const LOADING_MAX_TIMEOUT = 30000; // 30 seconds max for loading indicator
  const STORAGE_KEY = "cql-markdone-pos";
  const INVALID_PATTERNS = [
    "/sb0/",
    "/sb1/",
    "/redir_sku/",
    "/bnd/",
    "/brand/",
    "/cat/",
  ];

  const el = (id) => document.getElementById(id);

  let loadStart = performance.now();
  let redirectHistory = [location.href];
  let finalUrlObserved = location.href;

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
    return INVALID_PATTERNS.some((p) => url.includes(p));
  }

  function copy(text, btn) {
    navigator.clipboard.writeText(text);
    btn.textContent = "✓ Copied";
    setTimeout(() => (btn.textContent = "Copy"), 1200);
  }

  function confidenceScore({ urlMatch, skuMatch, piidMatch, valid }) {
    let score = 0;
    if (!valid) return 0;
    score += 30;
    if (skuMatch) score += 35;
    if (piidMatch) score += 25;
    if (urlMatch) score += 10;
    return Math.min(100, score);
  }

  function scoreColor(score) {
    if (score >= 85) return "#198754";
    if (score >= 60) return "#ffc107";
    return "#dc3545";
  }

  /* =====================================================
     Part Number Extraction — DOM only, zero network
  ===================================================== */

  function extractPartNumber() {
    // Strategy 1: JSON-LD structured data (most reliable, Wayfair uses Product schema)
    const jsonLdBlocks = document.querySelectorAll(
      'script[type="application/ld+json"]'
    );
    for (const block of jsonLdBlocks) {
      try {
        const data = JSON.parse(block.textContent);
        const items = Array.isArray(data) ? data : [data];
        for (const item of items) {
          // Handle @graph arrays
          const nodes = item["@graph"] ? item["@graph"] : [item];
          for (const node of nodes) {
            if (node["@type"] === "Product") {
              // mpn (Manufacturer Part Number) is the primary target
              if (node.mpn) return { value: String(node.mpn), source: "JSON-LD mpn" };
              if (node.sku) return { value: String(node.sku), source: "JSON-LD sku" };
              if (node.productID) return { value: String(node.productID), source: "JSON-LD productID" };
              if (node.model) return { value: String(node.model), source: "JSON-LD model" };
            }
          }
        }
      } catch {
        // malformed JSON-LD, skip
      }
    }

    // Strategy 2: Wayfair-specific global JS object (window.__STORE__ / window.wf_*)
    try {
      // Wayfair sometimes embeds product data in a script tag as a JS assignment
      const allScripts = document.querySelectorAll("script:not([src])");
      const partPatterns = [
        /["']manufacturer_part_number["']\s*:\s*["']([^"']+)["']/i,
        /["']manufacturerPartNumber["']\s*:\s*["']([^"']+)["']/i,
        /["']model_number["']\s*:\s*["']([^"']+)["']/i,
        /["']modelNumber["']\s*:\s*["']([^"']+)["']/i,
        /["']part_number["']\s*:\s*["']([^"']+)["']/i,
        /["']partNumber["']\s*:\s*["']([^"']+)["']/i,
        /["']mpn["']\s*:\s*["']([^"']+)["']/i,
      ];

      for (const script of allScripts) {
        const text = script.textContent;
        // Skip tiny scripts and SheetJS/xlsx blobs
        if (text.length < 20 || text.length > 500000) continue;
        for (const pattern of partPatterns) {
          const match = text.match(pattern);
          if (match && match[1] && match[1].length < 60) {
            return { value: match[1].trim(), source: "inline script" };
          }
        }
      }
    } catch {
      // ignore
    }

    // Strategy 3: Meta tags
    const metaSelectors = [
      'meta[property="product:mfr_part_no"]',
      'meta[name="mpn"]',
      'meta[itemprop="mpn"]',
      'meta[itemprop="sku"]',
      'meta[itemprop="model"]',
      'meta[name="model"]',
    ];
    for (const sel of metaSelectors) {
      const tag = document.querySelector(sel);
      if (tag?.content?.trim()) {
        return { value: tag.content.trim(), source: "meta tag" };
      }
    }

    // Strategy 4: Visible DOM — common Wayfair patterns
    const domSelectors = [
      '[data-hb-id*="PartNumber"]',
      '[data-testid*="part-number"]',
      '[data-testid*="model-number"]',
      '[class*="PartNumber"]',
      '[class*="partNumber"]',
      '[class*="ModelNumber"]',
      '[itemprop="mpn"]',
      '[itemprop="sku"]',
    ];
    for (const sel of domSelectors) {
      const node = document.querySelector(sel);
      if (node?.textContent?.trim()) {
        const text = node.textContent.trim().replace(/^(Part\s*#|Model\s*#|MPN|SKU)\s*[:•]?\s*/i, "");
        if (text && text.length < 60) {
          return { value: text, source: "DOM element" };
        }
      }
    }

    // Strategy 5: Label-text scan — "Part Number: XXXXX" anywhere on the page
    const labelPattern = /(?:Part\s*(?:No\.?|Number|#)|Model\s*(?:No\.?|Number)|Manufacturer\s*Part\s*Number|MPN)\s*[:•]\s*([A-Z0-9\-_\/\.]{3,40})/i;
    const bodyText = document.body.innerText || "";
    const labelMatch = bodyText.match(labelPattern);
    if (labelMatch) {
      return { value: labelMatch[1].trim(), source: "page text" };
    }

    return null;
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
      textAlign: "center",
    });
    loadingRibbon.textContent = "⏳ Loading page…";
    document.documentElement.appendChild(loadingRibbon);

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
      zIndex: "2147483647",
    });

    chrome.storage.local.get(STORAGE_KEY, (res) => {
      if (res[STORAGE_KEY]) {
        btn.style.top = res[STORAGE_KEY].top + "px";
        btn.style.left = res[STORAGE_KEY].left + "px";
      }
    });

    let drag = false,
      ox = 0,
      oy = 0;

    btn.onmousedown = (e) => {
      drag = false;
      const r = btn.getBoundingClientRect();
      ox = e.clientX - r.left;
      oy = e.clientY - r.top;

      const move = (ev) => {
        drag = true;
        const newLeft = Math.max(
          0,
          Math.min(window.innerWidth - btn.offsetWidth, ev.clientX - ox)
        );
        const newTop = Math.max(
          0,
          Math.min(window.innerHeight - btn.offsetHeight, ev.clientY - oy)
        );
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
              left: btn.getBoundingClientRect().left,
            },
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

  /* ---------------- redirect observer ---------------- */

  ["pushState", "replaceState"].forEach((method) => {
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
    if (location.href !== finalUrlObserved) {
      finalUrlObserved = location.href;
      redirectHistory.push(finalUrlObserved);
    }
  });

  window.addEventListener("popstate", () => {
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

    // Extract part number from DOM — runs at ribbon-render time (page is fully loaded)
    const partInfo = extractPartNumber();
    const partDisplay = partInfo
      ? escapeHtml(partInfo.value)
      : '<span style="opacity:.5;font-style:italic">Not found</span>';
    const partSource = partInfo
      ? `<span style="opacity:.6;font-size:10px"> via ${escapeHtml(partInfo.source)}</span>`
      : "";

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
      borderBottom: "1px solid rgba(0,0,0,0.15)",
    });

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

      <hr style="border:none;border-top:1px solid rgba(0,0,0,0.1);margin:8px 0">

      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <span style="font-size:12px;font-weight:700">Part #:</span>
        <span id="cql-part-value" style="font-size:12px;font-family:monospace;background:rgba(0,0,0,0.06);padding:2px 6px;border-radius:4px;user-select:all">${partDisplay}</span>
        ${partSource}
        ${partInfo ? `<button id="cql-copy-part" style="padding:2px 8px;font-size:11px;font-weight:600;border:1px solid rgba(0,0,0,0.2);border-radius:4px;background:#fff;cursor:pointer;margin-left:auto">Copy</button>` : ""}
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

    el("co").onclick = (e) => copy(original, e.target);
    el("cf").onclick = (e) => copy(final, e.target);
    el("close").onclick = () => ribbon.remove();
    el("dismiss").onclick = () => ribbon.remove();

    // Part number copy button
    if (partInfo) {
      el("cql-copy-part").onclick = (e) => {
        navigator.clipboard.writeText(partInfo.value).then(() => {
          e.target.textContent = "✓ Copied!";
          e.target.style.background = "#d1e7dd";
          e.target.style.borderColor = "#a3cfbb";
          setTimeout(() => {
            e.target.textContent = "Copy";
            e.target.style.background = "#fff";
            e.target.style.borderColor = "rgba(0,0,0,0.2)";
          }, 1800);
        });
      };
    }
  }

  // Request redirect info with error handling
  chrome.runtime.sendMessage({ type: "GET_REDIRECT_INFO" }, (info) => {
    if (chrome.runtime.lastError) {
      console.warn("Extension context invalidated:", chrome.runtime.lastError);
      renderRibbon(location.href, location.href, null);
      return;
    }
    renderRibbon(
      info?.original || location.href,
      info?.final || location.href,
      info?.progress
    );
  });
})();