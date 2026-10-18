/* Finance Toolbox: loads the big helpers (PDF reader, Excel writer) only when they're needed.
   In the single-file version they are packed inside the page; in the folder version they load from js/vendor. */
(function (root) {
  "use strict";
  const PATHS = { pdf: "js/vendor/pdfjs/pdf.min.js", pdfWorker: "js/vendor/pdfjs/pdf.worker.min.js", excel: "js/vendor/exceljs/exceljs.min.js" };
  const urls = {}, loading = {};
  /* a packed library lives in <script type="text/plain" id="lib-NAME"> as base64 */
  function url(name) {
    if (urls[name]) return urls[name];
    const el = document.getElementById("lib-" + name);
    if (el) {
      const bin = atob(el.textContent.trim()), bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      urls[name] = URL.createObjectURL(new Blob([bytes], { type: "text/javascript" }));
    } else urls[name] = PATHS[name];
    return urls[name];
  }
  function load(name, globalName, what) {
    if (root[globalName]) return Promise.resolve(root[globalName]);
    if (!loading[name]) loading[name] = new Promise((res, rej) => {
      const s = document.createElement("script"); s.src = url(name);
      s.onload = () => root[globalName] ? res(root[globalName]) : rej(new Error("The " + what + " couldn't start."));
      s.onerror = () => { delete loading[name]; rej(new Error("The " + what + " couldn't load. Make sure the whole app folder was unzipped.")); };
      document.head.appendChild(s);
    });
    return loading[name];
  }
  root.FTLazy = { url, load };
})(window);
