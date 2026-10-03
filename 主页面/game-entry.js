/* Game entry — auto-generated */
window.GameEntry = {
  startGame: function () {
    console.log("[GameEntry] -> play/");
    window.location.href = "../play/index.html";
  },
  loadGame: function () {
    if (window.GameEntry.toast) window.GameEntry.toast("存档功能开发中");
  },
  exitGame: function () {
    try {
      if (window.Android && typeof window.Android.exitApp === "function") {
        window.Android.exitApp(); return;
      }
      if (window.AndroidBridge && typeof window.AndroidBridge.exitApp === "function") {
        window.AndroidBridge.exitApp(); return;
      }
    } catch (e) {}
    try { window.close(); } catch (e) {}
    setTimeout(function () {
      document.documentElement.innerHTML =
        '<div style="position:fixed;top:0;left:0;right:0;bottom:0;background:#000;color:#666;' +
        'display:flex;align-items:center;justify-content:center;' +
        'font-family:-apple-system,sans-serif;font-size:16px;letter-spacing:6px;">' +
        '已退出</div>';
    }, 120);
  },
  toast: function (msg) {
    var t = document.getElementById("toast");
    if (!t) { console.log("[toast]", msg); return; }
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(t._timer);
    t._timer = setTimeout(function () { t.classList.remove("show"); }, 2400);
  }
};