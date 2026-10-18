/* Finance Toolbox web app: installs the offline helper (service worker) so the app opens without internet.
   The service worker only stores the app's own files. Your numbers stay in this browser's storage on this device. */
(function () {
  "use strict";
  if (!("serviceWorker" in navigator) || !/^https?:$/.test(location.protocol)) return;
  addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").then(reg => {
      const tell = () => {
        if (!window.FTApp || !navigator.serviceWorker.controller) return;
        window.FTApp.toast({ kind: "info", title: "Update ready", detail: "A new version of the app has been downloaded.", action: { label: "Reload", run: () => location.reload() } });
      };
      reg.addEventListener("updatefound", () => { const w = reg.installing; if (w) w.addEventListener("statechange", () => { if (w.state === "installed") tell(); }); });
      setInterval(() => reg.update().catch(() => {}), 6 * 60 * 60 * 1000);
    }).catch(() => {});
  });
})();
