(() => {
  const BTN_ID = "queue-mark-done";
  const STORAGE_KEY = "mark-done-pos::global";
  const DRAG_THRESHOLD = 5;

  /* ------------------ Mark Done Button ------------------ */

  if (!document.getElementById(BTN_ID)) {
    const btn = document.createElement("button");
    btn.id = BTN_ID;
    btn.textContent = "✔️ Mark Done";

    Object.assign(btn.style, {
      position: "fixed",
      top: "160px",
      left: "16px",
      padding: "8px 12px",
      background: "#2f2f2f",
      color: "#fff",
      border: "none",
      borderRadius: "6px",
      cursor: "grab",
      zIndex: "2147483647",
      userSelect: "none",
      transition: "transform 0.15s ease, background 0.15s ease"
    });

    chrome.storage.local.get(STORAGE_KEY, res => {
      if (res[STORAGE_KEY]) {
        btn.style.top = `${res[STORAGE_KEY].top}px`;
        btn.style.left = `${res[STORAGE_KEY].left}px`;
      }
    });

    let startX, startY, offsetX, offsetY, dragged;

    btn.addEventListener("mousedown", e => {
      startX = e.clientX;
      startY = e.clientY;
      const r = btn.getBoundingClientRect();
      offsetX = startX - r.left;
      offsetY = startY - r.top;
      dragged = false;

      const move = e2 => {
        if (
          Math.abs(e2.clientX - startX) > DRAG_THRESHOLD ||
          Math.abs(e2.clientY - startY) > DRAG_THRESHOLD
        ) {
          dragged = true;
          btn.style.left = `${e2.clientX - offsetX}px`;
          btn.style.top = `${e2.clientY - offsetY}px`;
        }
      };

      const up = () => {
        document.removeEventListener("mousemove", move);
        document.removeEventListener("mouseup", up);

        if (dragged) {
          const r = btn.getBoundingClientRect();
          chrome.storage.local.set({
            [STORAGE_KEY]: { top: Math.round(r.top), left: Math.round(r.left) }
          });
        } else {
          btn.style.background = "#2fb344";
          btn.style.transform = "scale(0.95)";
          btn.textContent = "✓ Done";

          setTimeout(() => {
            chrome.runtime.sendMessage({ type: "TASK_DONE" });
          }, 120);
        }
      };

      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup", up);
    });

    document.documentElement.appendChild(btn);
  }

  /* ------------------ Redirect Ribbon ------------------ */

  function extractSku(url) {
    const match = url.match(/-([a-zA-Z0-9]+)\.html/);
    return match ? match[1] : null;
  }

  function getStatus(original, final) {
    const invalidPatterns = ["sb0", "sb1", "redir_sku", "bnd", "/brand/", "/cat/"];

    if (invalidPatterns.some(p => final.includes(p))) {
      return { key: "invalid", icon: "⚠️", text: "UNKNOWN : URL IS INVALID" };
    }

    const skuOriginal = extractSku(original);
    const skuFinal = extractSku(final);
    if (skuOriginal && skuFinal && skuOriginal !== skuFinal) {
      return { key: "sku", icon: "🔁", text: "UNKNOWN : SKU REDIRECTED" };
    }

    const o = new URL(original);
    const f = new URL(final);
    const po = o.searchParams.get("piid");
    const pf = f.searchParams.get("piid");

    if ((po && (!pf || pf === "null")) || (!po && pf)) {
      return { key: "variation", icon: "🧩", text: "UNKNOWN : VARIATION NOT SELECTED" };
    }

    return null;
  }

  function statusBadgeStyle(key) {
    switch (key) {
      case "invalid":
        return { bg: "#f8d7da", fg: "#842029", border: "#f5c2c7" };
      case "sku":
        return { bg: "#fff3cd", fg: "#664d03", border: "#ffecb5" };
      case "variation":
        return { bg: "#e2d9f3", fg: "#4b2e83", border: "#d6c7f0" };
      default:
        return null;
    }
  }

  function isReload() {
    const nav = performance.getEntriesByType("navigation")[0];
    return nav?.type === "reload";
  }

  function renderRibbon(original, final) {
    if (document.getElementById("queue-redirect-ribbon")) return;

    const status = getStatus(original, final);
    const domain = new URL(final).hostname;
    const reloadDetected = isReload();

    const ribbon = document.createElement("div");
    ribbon.id = "queue-redirect-ribbon";

    Object.assign(ribbon.style, {
      position: "fixed",
      top: "0",
      left: "0",
      width: "100%",
      background: "#f1f3f5",
      padding: "12px 16px",
      zIndex: "2147483646",
      borderBottom: "1px solid #ccc",
      fontSize: "13px",
      transform: "translateY(-100%)",
      opacity: "0",
      transition: "transform 0.35s ease, opacity 0.35s ease"
    });

    requestAnimationFrame(() => {
      ribbon.style.transform = "translateY(0)";
      ribbon.style.opacity = "1";
    });

    const header = document.createElement("div");
    header.style.display = "flex";
    header.style.alignItems = "center";
    header.style.justifyContent = "space-between";

    const left = document.createElement("div");
    left.style.display = "flex";
    left.style.alignItems = "center";
    left.style.gap = "8px";

    const title = document.createElement("strong");
    title.textContent = "ℹ️ Page loaded at a different URL";
    left.appendChild(title);

    if (reloadDetected) {
      const reloadBadge = document.createElement("span");
      reloadBadge.textContent = "Reload detected";
      Object.assign(reloadBadge.style, {
        fontSize: "11px",
        padding: "2px 6px",
        borderRadius: "999px",
        background: "#fff3cd",
        color: "#664d03",
        border: "1px solid #ffecb5",
        fontWeight: "600"
      });
      left.appendChild(reloadBadge);
    }

    const close = document.createElement("span");
    close.textContent = "✕";
    close.style.cursor = "pointer";
    close.onclick = () => ribbon.remove();

    header.append(left, close);

    const domainLine = document.createElement("div");
    domainLine.textContent = `Domain: ${domain}`;
    domainLine.style.marginTop = "4px";

    const statusBox = document.createElement("div");
    statusBox.style.marginTop = "6px";

    if (status) {
      const badgeStyle = statusBadgeStyle(status.key);
      const badge = document.createElement("div");
      badge.textContent = `${status.icon} ${status.text}`;
      Object.assign(badge.style, {
        display: "inline-block",
        fontWeight: "700",
        padding: "4px 8px",
        borderRadius: "6px",
        background: badgeStyle.bg,
        color: badgeStyle.fg,
        border: `1px solid ${badgeStyle.border}`
      });
      statusBox.appendChild(badge);
    }

    const toggle = document.createElement("button");
    toggle.textContent = "Hide details";
    toggle.style.marginTop = "6px";
    toggle.style.border = "none";
    toggle.style.background = "none";
    toggle.style.color = "#0b5ed7";
    toggle.style.cursor = "pointer";

    const details = document.createElement("div");
    details.style.fontSize = "12px";
    details.style.marginTop = "6px";

    details.innerHTML = `
      <div><strong>Original URL:</strong></div>
      <div style="word-break:break-all">${original}</div>
      <div style="margin-top:4px"><strong>Final URL:</strong></div>
      <div style="word-break:break-all">${final}</div>
    `;

    let expanded = true;
    toggle.onclick = () => {
      expanded = !expanded;
      details.style.display = expanded ? "block" : "none";
      toggle.textContent = expanded ? "Hide details" : "Show details";
    };

    setTimeout(() => {
      if (expanded) {
        expanded = false;
        details.style.display = "none";
        toggle.textContent = "Show details";
      }
    }, 6000);

    ribbon.append(header, domainLine, statusBox, toggle, details);
    document.documentElement.appendChild(ribbon);
  }

  chrome.runtime.onMessage.addListener(msg => {
    if (msg.type === "SHOW_REDIRECT_NOTICE") {
      renderRibbon(msg.original, msg.final);
    }
  });
})();

/* ------------------ Inline Close Confirmation ------------------ */

chrome.runtime.sendMessage({ type: "GET_PENDING_CONFIRM" }, pending => {
  if (!pending) return;

  if (document.getElementById("queue-close-confirm")) return;

  const bar = document.createElement("div");
  bar.id = "queue-close-confirm";

  Object.assign(bar.style, {
    position: "fixed",
    bottom: "16px",
    left: "50%",
    transform: "translateX(-50%)",
    background: "#212529",
    color: "#fff",
    padding: "12px 16px",
    borderRadius: "8px",
    zIndex: "2147483647",
    display: "flex",
    gap: "12px",
    alignItems: "center",
    fontSize: "13px"
  });

  bar.innerHTML = `
    <span>Task was closed without marking done.</span>
    <button data-a="done">Mark Done</button>
    <button data-a="reopen">Reopen</button>
    <button data-a="ignore">Ignore</button>
  `;

  bar.querySelectorAll("button").forEach(btn => {
    Object.assign(btn.style, {
      border: "none",
      padding: "6px 10px",
      borderRadius: "6px",
      cursor: "pointer"
    });
  });

  bar.onclick = e => {
    const action = e.target.dataset.a;
    if (!action) return;

    chrome.runtime.sendMessage({
      type: "CONFIRM_CLOSE_ACTION",
      action
    });

    bar.remove();
  };

  document.documentElement.appendChild(bar);
});
