/* Save your data to a real file on your computer (for example Desktop/finance-toolbox/finance-toolbox-data.json).
   Uses the browser's File System Access feature (Chrome, Edge, Brave, Opera, Arc on a computer).
   The file is the main copy: every change is written to it within a second. The browser also keeps a
   working copy so the app opens instantly; whichever copy is newer wins when the app starts.
   The browser remembers which file you chose (in IndexedDB) and asks permission again when needed. */
(function () {
  "use strict";
  const Store = window.FTStore;
  const supported = typeof window.showSaveFilePicker === "function" && typeof window.showOpenFilePicker === "function";
  const TYPES = [{ description: "Finance Toolbox data", accept: { "application/json": [".json"] } }];
  let handle = null, perm = "none", lastSaved = 0, lastError = "", writing = Promise.resolve(), timer = null, H = { toast: () => {}, fillForms: () => {} };

  /* ---------- remember the chosen file between visits (IndexedDB can store file handles) ---------- */
  function idb() {
    return new Promise((res, rej) => {
      const r = indexedDB.open("financeToolbox", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("handles");
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
  }
  async function idbGet(key) { const db = await idb(); return new Promise(res => { const q = db.transaction("handles").objectStore("handles").get(key); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); }); }
  async function idbSet(key, val) { const db = await idb(); return new Promise(res => { const tx = db.transaction("handles", "readwrite"); val == null ? tx.objectStore("handles").delete(key) : tx.objectStore("handles").put(val, key); tx.oncomplete = () => res(); tx.onerror = () => res(); }); }

  /* ---------- reading and writing ---------- */
  function fileData(st) {
    const copy = JSON.parse(JSON.stringify(st));
    delete copy.sync; /* Google sign-in details stay with this browser */
    return JSON.stringify(Object.assign({ app: "Finance Toolbox", savedAt: new Date().toISOString() }, copy), null, 2);
  }
  async function readFile(h) {
    const f = await h.getFile();
    const text = (await f.text()).trim();
    if (!text) return null; /* a brand-new empty file */
    let raw;
    try { raw = JSON.parse(text); } catch (e) { throw new Error("“" + h.name + "” isn't a Finance Toolbox data file."); }
    if (!raw || (raw.app !== "Finance Toolbox" && !raw.income)) throw new Error("“" + h.name + "” isn't a Finance Toolbox data file.");
    return Store.clean(raw);
  }
  function write(st) {
    const h = handle; if (!h || perm !== "granted") return writing;
    const data = fileData(st);
    writing = writing.then(async () => {
      const w = await h.createWritable();
      await w.write(data); await w.close();
      lastSaved = Date.now(); lastError = "";
    }).catch(e => {
      lastError = e && e.name === "NotFoundError" ? "The file was moved or deleted. Choose it again or save a new one." : e && e.name === "NotAllowedError" ? "Permission to the file was taken away. Allow access again." : "Couldn't save to the file: " + (e && e.message || e);
      if (e && e.name === "NotAllowedError") perm = "prompt";
      H.toast({ kind: "error", title: "Not saved to your file", detail: lastError });
    }).then(status);
    return writing;
  }

  /* Load the file, or write the browser copy to it, whichever is newer */
  async function reconcile(opts = {}) {
    const local = Store.get();
    const fromFile = await readFile(handle);
    if (!fromFile || opts.preferLocal || (local.updatedAt > fromFile.updatedAt && !local.isExample)) {
      await write(local);
      if (fromFile && opts.announce !== false && local.updatedAt > fromFile.updatedAt) H.toast({ kind: "saved", title: "File updated", detail: "Changes made in this browser were saved to " + handle.name + "." });
    } else if (fromFile.updatedAt !== local.updatedAt || opts.preferFile) {
      fromFile.sync = local.sync;
      Store.replace(fromFile, "file-load");
      H.fillForms();
      if (opts.announce !== false) H.toast({ kind: "saved", title: "Loaded " + handle.name, detail: fromFile.items.length + " bills and income items, plus your pay and take-home settings." });
    }
    lastSaved = Date.now();
  }

  /* ---------- actions (each runs from a button press, which the browser requires) ---------- */
  async function saveNew() {
    try {
      const h = await window.showSaveFilePicker({ suggestedName: "finance-toolbox-data.json", types: TYPES, id: "finance-toolbox" });
      handle = h; perm = "granted"; await idbSet("dataFile", h);
      await write(Store.get());
      H.toast({ kind: "saved", title: "Saving to " + h.name, detail: "Every change is now written to this file automatically." });
    } catch (e) { if (e && e.name !== "AbortError") H.toast({ kind: "error", title: "Couldn't create the file", detail: e.message }); }
    status(); refresh();
  }
  async function openExisting() {
    try {
      const [h] = await window.showOpenFilePicker({ types: TYPES, multiple: false, id: "finance-toolbox" });
      if ((await h.requestPermission({ mode: "readwrite" })) !== "granted") throw new Error("Saving needs permission to edit the file.");
      const data = await readFile(h);
      handle = h; perm = "granted"; await idbSet("dataFile", h);
      if (data) {
        const prev = Store.get(); data.sync = prev.sync; Store.replace(data, "file-load"); H.fillForms();
        H.toast({ kind: "saved", title: "Opened " + h.name, detail: "Changes will be saved back to this file.", action: { label: "Undo", run: () => { Store.replace(prev); H.fillForms(); } } });
      } else { await write(Store.get()); H.toast({ kind: "saved", title: "Saving to " + h.name, detail: "The file was empty, so your current numbers were saved into it." }); }
    } catch (e) { if (e && e.name !== "AbortError") H.toast({ kind: "error", title: "Couldn't open the file", detail: e.message }); }
    status(); refresh();
  }
  async function allow() {
    if (!handle) return;
    try {
      perm = await handle.requestPermission({ mode: "readwrite" });
      if (perm === "granted") { lastError = ""; await reconcile(); }
    } catch (e) { lastError = e.name === "NotFoundError" ? "The file was moved or deleted. Choose it again or save a new one." : e.message; }
    status(); refresh();
  }
  async function forget() {
    handle = null; perm = "none"; lastError = ""; await idbSet("dataFile", null);
    H.toast({ kind: "info", title: "Stopped saving to the file", detail: "The file is still on your computer. Your data stays in this browser." });
    status(); refresh();
  }

  /* ---------- status pill and settings panel ---------- */
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const time = ts => ts ? new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";
  function status() {
    const pill = document.getElementById("filePill"), text = document.getElementById("fileText");
    if (!pill) return;
    let kind = "", t = "Save to a file";
    if (handle && perm === "granted" && !lastError) { kind = "live"; t = "Saved to " + handle.name; }
    else if (handle && lastError) { kind = "err"; t = "File needs attention"; }
    else if (handle) { kind = "err"; t = "Allow access to " + handle.name; }
    else if (!supported) { t = "Saved in this browser"; }
    pill.className = "pill " + kind; text.textContent = t;
  }
  let host = null;
  function refresh() { if (host && document.getElementById("drawer").open) renderPanel(host, H); }
  function renderPanel(el, helpers) {
    host = el; H = helpers || H;
    const icon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/></svg>';
    if (!supported) {
      el.innerHTML = '<h3>Data file on your computer</h3><p class="help">This browser doesn’t let websites save to files on your computer, so your data is kept inside the browser. To save to a file automatically, open the app in <b>Chrome</b> or <b>Edge</b> on a computer. Here you can still keep a file copy with <b>Download backup</b> below, and load it again with <b>Restore from backup</b>.</p>';
      return;
    }
    if (!handle) {
      el.innerHTML = '<h3>Data file on your computer</h3><p class="help">Keep your numbers in a file you choose, like a <b>finance-toolbox-data.json</b> in your Documents or Desktop folder. Every change is saved to it automatically, and you can back it up, copy it, or open it in another browser.</p>' +
        '<div class="row-btns"><button class="btn primary" type="button" id="fsNew">Save to a new file</button><button class="btn" type="button" id="fsOpen">Open a saved file</button></div>';
      el.querySelector("#fsNew").onclick = saveNew; el.querySelector("#fsOpen").onclick = openExisting;
      return;
    }
    const ok = perm === "granted" && !lastError;
    el.innerHTML = '<h3>Data file on your computer</h3>' +
      '<div class="sheet-card file-card">' + icon + '<div style="min-width:0;flex:1"><div class="t">' + esc(handle.name) + '</div><div class="hint">' +
      (ok ? "Saving automatically" + (lastSaved ? " · last saved " + time(lastSaved) : "") : lastError ? esc(lastError) : "The browser needs your OK to keep saving to this file.") + '</div></div></div>' +
      '<div class="row-btns">' + (ok ? "" : lastError && /moved|deleted/.test(lastError) ? '<button class="btn primary" type="button" id="fsNew">Save to a new file</button>' : '<button class="btn primary" type="button" id="fsAllow">Allow access</button>') +
      '<button class="btn" type="button" id="fsOpen">Open a different file</button><button class="btn" type="button" id="fsForget">Stop using this file</button></div>' +
      '<p class="help">Tip: Chrome may ask again after you close it. Choose “Allow on every visit” when it offers so it stops asking.</p>';
    const b = id => el.querySelector(id);
    if (b("#fsAllow")) b("#fsAllow").onclick = allow;
    if (b("#fsNew")) b("#fsNew").onclick = saveNew;
    b("#fsOpen").onclick = openExisting; b("#fsForget").onclick = forget;
  }

  /* ---------- start-up and change tracking ---------- */
  async function init(helpers) {
    H = helpers || H;
    if (!supported) { status(); return; }
    try {
      handle = await idbGet("dataFile");
      if (handle) {
        perm = await handle.queryPermission({ mode: "readwrite" });
        if (perm === "granted") await reconcile({ announce: false });
      }
    } catch (e) { lastError = e && e.name === "NotFoundError" ? "The file was moved or deleted. Choose it again or save a new one." : String(e && e.message || e); }
    status();
  }
  function onChange(reason) {
    if (!handle || perm !== "granted" || reason === "file-load" || reason === "sync-meta") { status(); return; }
    clearTimeout(timer); timer = setTimeout(() => write(Store.get()), 500);
  }
  /* Save right away if the page is being closed */
  addEventListener("pagehide", () => { if (timer) { clearTimeout(timer); timer = null; write(Store.get()); } });

  window.FTFile = { supported, init, renderPanel, onChange, status, allow, saveNew };
})();
