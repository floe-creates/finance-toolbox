/* Free demo build only (tools/build_web.py --demo). Loaded before the app.
   Every visit starts fresh with example numbers, nothing is kept, and the save/restore tools are hidden.
   Change BUY_URL to your Etsy listing link. */
(function () {
  "use strict";
  var BUY_URL = "https://www.etsy.com/listing/4598098334";
  /* the demo saves under its own names, so on a shared web address (GitHub Pages) it can never
     read, change or erase the real app's numbers; it clears only its own copy on every visit */
  window.FT_STORAGE = { key: "financeToolbox.demo", db: "financeToolbox-demo-data" };
  try { localStorage.removeItem("financeToolbox.demo"); } catch (e) {}
  try { indexedDB.deleteDatabase("financeToolbox-demo-data"); } catch (e) {}
  /* no "Save to a file" in the demo (it could otherwise reuse a file the real app is linked to) */
  try { window.showSaveFilePicker = undefined; window.showOpenFilePicker = undefined; } catch (e) {}
  window.FT_DEMO = true;
  var css = document.createElement("style");
  css.textContent =
    ".demo-bar{position:sticky;top:0;z-index:50;display:flex;gap:10px 16px;align-items:center;justify-content:center;flex-wrap:wrap;padding:9px 16px;" +
    "background:linear-gradient(90deg,#5b4bd6,#2a78b8);color:#fff;font:600 14px/1.3 Figtree,Arial,sans-serif;text-align:center}" +
    ".demo-bar a{color:#5b4bd6;background:#fff;border-radius:999px;padding:6px 14px;text-decoration:none;font-weight:700;white-space:nowrap}" +
    ".demo-bar span{opacity:.9;font-weight:500}" +
    "@media (max-width:600px){.demo-bar{font-size:13px;padding:7px 12px;gap:6px 10px}.demo-bar span{display:none}.demo-bar a{padding:4px 12px}}" +
    "#fileBox,#filePill,label[for=importFile],label[for=xlsxFile],#xlsxExport,#navExcel,#deviceBox{display:none!important}";
  document.head.appendChild(css);
  document.addEventListener("DOMContentLoaded", function () {
    var bar = document.createElement("div"); bar.className = "demo-bar"; bar.setAttribute("role", "note");
    bar.innerHTML = "Free demo · nothing is saved <span>Try everything with example numbers or your own.</span>" +
      '<a href="' + BUY_URL + '" target="_blank" rel="noopener">Get the full app</a>';
    document.body.insertBefore(bar, document.body.firstChild);
  });
})();
