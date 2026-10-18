/* Finance Toolbox offline helper. Keeps a copy of the app's own files so it opens with no internet.
   It never reads, stores or sends your budget numbers; those live in the browser's storage on your device.
   VERSION and FILES are filled in by tools/build_web.py. */
const VERSION = "ft-web-02d95f4ed8ac";
const FILES = [
"./",
"manifest.webmanifest",
"css/app.css",
"css/fonts.css",
"fonts/LICENSE-Figtree.txt",
"fonts/LICENSE-IBM-Plex-Mono.txt",
"fonts/LICENSE-Instrument-Serif.txt",
"fonts/figtree-latin-400-normal.woff2",
"fonts/figtree-latin-500-normal.woff2",
"fonts/figtree-latin-600-normal.woff2",
"fonts/figtree-latin-700-normal.woff2",
"fonts/ibm-plex-mono-latin-400-normal.woff2",
"fonts/ibm-plex-mono-latin-500-normal.woff2",
"fonts/instrument-serif-latin-400-normal.woff2",
"icons/apple-touch-icon.png",
"icons/favicon-32.png",
"icons/icon-192.png",
"icons/icon-512.png",
"icons/icon.svg",
"icons/maskable-512.png",
"js/app.js",
"js/boot.js",
"js/engine.js",
"js/excel.js",
"js/filestore.js",
"js/importer.js",
"js/lazy.js",
"js/pwa.js",
"js/store.js",
"js/taxdata.js",
"js/vendor/exceljs/LICENSE",
"js/vendor/exceljs/exceljs.min.js",
"js/vendor/pdfjs/LICENSE",
"js/vendor/pdfjs/README.txt",
"js/vendor/pdfjs/pdf.min.js",
"js/vendor/pdfjs/pdf.worker.min.js",
"index.html"
];
self.addEventListener("install", e => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES))); self.skipWaiting(); });
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return; /* the app makes no outside requests */
  /* app files: from the cache first (works offline), refreshed from the site in the background */
  e.respondWith(caches.open(VERSION).then(async c => {
    const key = req.mode === "navigate" ? "./" : req;
    const hit = await c.match(key, { ignoreSearch: true });
    const net = fetch(req).then(r => { if (r.ok && req.mode !== "navigate") c.put(req, r.clone()); return r; }).catch(() => null);
    if (hit) { e.waitUntil(net); return hit; }
    return (await net) || (await c.match("./")) || Response.error();
  }));
});
