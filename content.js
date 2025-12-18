(() => {
  const ID = "queue-mark-done";
  if (document.getElementById(ID)) return;

  const btn = document.createElement("button");
  btn.id = ID;
  btn.textContent = "✓ Mark Done";

  btn.style.cssText = `
    position: fixed;
    top: 16px;
    left: 16px;
    padding: 8px 12px;
    font-size: 13px;
    background: rgba(17, 17, 17, 0.85);
    color: #fff;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    z-index: 2147483647;
  `;

  btn.onclick = () => {
    chrome.runtime.sendMessage({ type: "TASK_DONE" });
  };

  btn.onmouseenter = () => btn.style.opacity = "1";
  btn.onmouseleave = () => btn.style.opacity = "0.85";

  window.addEventListener("beforeunload", (e) => {
    e.preventDefault();
    e.returnValue = "";
  });

  document.documentElement.appendChild(btn);
})();
