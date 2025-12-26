(() => {
  if (window.__QUEUE_UI__) return;
  window.__QUEUE_UI__ = true;

  function whenReady(cb) {
    if (document.readyState !== "loading") cb();
    else document.addEventListener("DOMContentLoaded", cb, { once: true });
  }

  whenReady(() => {
    /* ---------- Mark Done Button ---------- */

    const btn = document.createElement("button");
    btn.textContent = "✔️ Mark Done";

    Object.assign(btn.style, {
      position: "fixed",
      top: "16px",
      left: "16px",
      padding: "8px 12px",
      background: "#ffffff",
      color: "#111",
      border: "1px solid #ccc",
      borderRadius: "6px",
      fontSize: "13px",
      cursor: "grab",
      zIndex: "2147483647",
      userSelect: "none",
    });

    let dragging = false,
      ox = 0,
      oy = 0;

    btn.addEventListener("mousedown", (e) => {
      dragging = false;
      ox = e.clientX - btn.offsetLeft;
      oy = e.clientY - btn.offsetTop;

      const move = (e2) => {
        dragging = true;
        btn.style.left = `${e2.clientX - ox}px`;
        btn.style.top = `${e2.clientY - oy}px`;
      };

      const up = () => {
        document.removeEventListener("mousemove", move);
        document.removeEventListener("mouseup", up);
      };

      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup", up);
    });

    btn.addEventListener("click", () => {
      if (!dragging) chrome.runtime.sendMessage({ type: "TASK_DONE" });
    });

    (document.body || document.documentElement)?.appendChild(btn);

    /* ---------- Redirect Ribbon ---------- */

    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.type !== "SHOW_REDIRECT_NOTICE") return;
      if (document.getElementById("queue-redirect")) return;

      const r = document.createElement("div");
      r.id = "queue-redirect";

      Object.assign(r.style, {
        position: "fixed",
        top: "0",
        left: "0",
        width: "100%",
        background: "#c97a1c",
        color: "#fff",
        padding: "10px 16px",
        fontSize: "13px",
        zIndex: "2147483646",
      });

      const text = document.createElement("div");
      text.textContent =
        "Notice: This page loaded at a different URL than the one you provided.";

      const toggle = document.createElement("button");
      toggle.textContent = "Show details";
      Object.assign(toggle.style, {
        background: "none",
        border: "none",
        color: "#fff",
        textDecoration: "underline",
        cursor: "pointer",
      });

      const details = document.createElement("div");
      details.style.display = "none";
      details.style.fontSize = "12px";
      details.style.marginTop = "6px";
      details.textContent = `Original: ${msg.original}\nFinal: ${msg.final}`;

      toggle.onclick = () => {
        const open = details.style.display === "block";
        details.style.display = open ? "none" : "block";
        toggle.textContent = open ? "Show details" : "Hide details";
      };

      r.append(text, toggle, details);
      (document.body || document.documentElement)?.appendChild(r);
    });
  });
})();
