/* App state: defaults, validation, saving in this browser, backup files. */
(function (root) {
  "use strict";
  const KEY = (root.FT_STORAGE && root.FT_STORAGE.key) || "financeToolbox.v1"; /* the free demo sets its own key so it never touches real data */
  const E = root.FTEngine;
  const listeners = new Set();
  let state = null, storageOk = true;

  const todayIso = () => { const t = new Date(); return t.getFullYear() + "-" + String(t.getMonth() + 1).padStart(2, "0") + "-" + String(t.getDate()).padStart(2, "0"); };
  const shift = (iso, days) => E.fromDay(E.toDay(iso) + days);
  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

  /* Example numbers shown on first open, clearly labeled as examples in the UI. */
  function exampleState() {
    const t = todayIso(), p = E.parts(E.toDay(t));
    const nextFri = shift(t, (5 - p.dow + 7) % 7 || 7);
    const monthDay = d => { const y = p.y, m = p.m + (p.d >= d ? 1 : 0); return E.fromDay(Math.round(Date.UTC(y, m, d) / 86400000)); };
    const nextSat = shift(t, (6 - p.dow + 7) % 7 || 7);
    return {
      version: 1, isExample: true, updatedAt: Date.now(),
      income: { amount: 26, per: "Hour", payType: "Hourly", year: p.y, hoursPerWeek: 40, daysPerWeek: 5, paidHolidays: 8, paidPto: 10, unpaidDays: 0, overtimeAfter: 40, overtimeMultiplier: 1.5, payFrequency: "Bi-Week", knownPayday: nextFri },
      projection: { startDate: t, months: 6, startingBalance: 1500 },
      items: [
        { id: uid(), name: "Rent", type: "Bill", amount: 1250, frequency: "Monthly", first: monthDay(1), end: "" },
        { id: uid(), name: "Groceries", type: "Bill", amount: 110, frequency: "Weekly", first: nextSat, end: "" },
        { id: uid(), name: "Car payment", type: "Bill", amount: 340, frequency: "Monthly", first: monthDay(15), end: "" },
        { id: uid(), name: "Phone", type: "Bill", amount: 65, frequency: "Monthly", first: monthDay(12), end: "" },
        { id: uid(), name: "Car insurance", type: "Bill", amount: 720, frequency: "Yearly", first: monthDay(20), end: "" },
        { id: uid(), name: "Side gig", type: "Income", amount: 250, frequency: "Monthly", first: monthDay(25), end: "" }
      ],
      deductions: Object.assign(E.defaultDeductions(), { enabled: true, items: [
        { id: uid(), name: "401(k)", unit: "%", value: 5, treatment: "pretax" },
        { id: uid(), name: "Health insurance", unit: "$", value: 85, treatment: "pretax-all" }
      ] }),
      savings: E.defaultSavings(),
      accounts: [{ id: "main", name: "Main checking" }],
      sync: {}
    };
  }
  function blankState() {
    const s = exampleState();
    s.isExample = false; s.items = []; s.projection.startingBalance = 0; s.deductions = E.defaultDeductions(); s.savings = E.defaultSavings(); s.accounts = [{ id: "main", name: "Main checking" }];
    /* clear the income too: no pay amount, no time off, no imported deposit */
    Object.assign(s.income, { amount: 0, per: "Year", payType: "Salaried", paidHolidays: 0, paidPto: 0, unpaidDays: 0,
      overtimeAfter: 40, overtimeMultiplier: 1.5, payMode: "calc", depositAmount: 0, paysFrom: "" });
    return s;
  }

  /* ---------- validation (used for saved data, backups and sheet imports) ---------- */
  const PER = ["Hour", "Day", "Week", "Bi-Week", "Semi-Month", "Month", "Quarter", "Year"];
  const PAYFREQ = ["Week", "Bi-Week", "Semi-Month", "Month"];
  const isIso = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ""));
  const n = (v, d, lo = -1e12, hi = 1e12) => { const x = Number(v); return Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d; };
  function clean(raw) {
    const d = exampleState();
    if (!raw || typeof raw !== "object") throw new Error("This file doesn't contain Finance Toolbox data.");
    const i = raw.income || {}, p = raw.projection || {};
    const out = {
      version: 1, isExample: !!raw.isExample, updatedAt: n(raw.updatedAt, Date.now(), 0, Infinity),
      income: {
        amount: n(i.amount, d.income.amount, 0), per: PER.includes(i.per) ? i.per : d.income.per,
        payType: i.payType === "Salaried" ? "Salaried" : "Hourly", year: Math.round(n(i.year, d.income.year, 1970, 2100)),
        hoursPerWeek: n(i.hoursPerWeek, 40, 0, 168), daysPerWeek: n(i.daysPerWeek, 5, 0, 7),
        paidHolidays: n(i.paidHolidays, 0, 0, 366), paidPto: n(i.paidPto, 0, 0, 366), unpaidDays: n(i.unpaidDays, 0, 0, 366),
        overtimeAfter: n(i.overtimeAfter, 40, 0, 168), overtimeMultiplier: n(i.overtimeMultiplier, 1.5, 1, 5),
        payFrequency: PAYFREQ.includes(i.payFrequency) ? i.payFrequency : "Bi-Week",
        knownPayday: isIso(i.knownPayday) ? i.knownPayday : d.income.knownPayday,
        payMode: i.payMode === "deposit" ? "deposit" : "calc", depositAmount: n(i.depositAmount, 0, 0, 1e7),
        paysFrom: isIso(i.paysFrom) ? i.paysFrom : "",
        depositTo: typeof i.depositTo === "string" ? i.depositTo.slice(0, 40) : "main"
      },
      accounts: cleanAccounts(raw.accounts),
      projection: {
        startDate: isIso(p.startDate) ? p.startDate : d.projection.startDate,
        months: Math.round(n(p.months, 6, 1, 24)), startingBalance: n(p.startingBalance, 0)
      },
      items: (Array.isArray(raw.items) ? raw.items : []).slice(0, 1000).filter(x => x && String(x.name || "").trim()).map(x => ({
        id: String(x.id || uid()).slice(0, 40), name: String(x.name).trim().slice(0, 60),
        type: x.type === "Income" ? "Income" : x.type === "Transfer" ? "Transfer" : "Bill", amount: n(x.amount, 0, 0),
        account: typeof x.account === "string" && x.account ? x.account.slice(0, 40) : "main", to: typeof x.to === "string" ? x.to.slice(0, 40) : "",
        frequency: E.FREQUENCIES.includes(x.frequency) ? x.frequency : "Monthly",
        first: isIso(x.first) ? x.first : todayIso(), end: isIso(x.end) ? x.end : "",
        category: E.CATEGORIES.includes(x.category) || E.INCOME_CATEGORIES.includes(x.category) ? x.category : ""
      })),
      deductions: cleanDeductions(raw.deductions),
      savings: cleanSavings(raw.savings),
      sync: raw.sync && typeof raw.sync === "object" ? {
        mode: raw.sync.mode === "template" ? "template" : raw.sync.mode === "app" ? "app" : undefined,
        spreadsheetId: typeof raw.sync.spreadsheetId === "string" ? raw.sync.spreadsheetId : undefined,
        spreadsheetUrl: typeof raw.sync.spreadsheetUrl === "string" ? raw.sync.spreadsheetUrl : undefined,
        title: typeof raw.sync.title === "string" ? raw.sync.title : undefined,
        lastSyncAt: n(raw.sync.lastSyncAt, 0, 0, Infinity), sheetModified: typeof raw.sync.sheetModified === "string" ? raw.sync.sheetModified : undefined
      } : {}
    };
    /* everything must point at an account that exists */
    const ids = out.accounts.map(a => a.id);
    if (!ids.includes(out.income.depositTo)) out.income.depositTo = "main";
    out.items.forEach(x => { if (!ids.includes(x.account)) x.account = "main"; if (x.type === "Transfer" && (!ids.includes(x.to) || x.to === x.account)) { x.type = "Bill"; x.to = ""; } if (x.type !== "Transfer") x.to = ""; });
    return out;
  }
  function cleanAccounts(r) {
    const list = [{ id: "main", name: "Main checking" }], seen = { main: true };
    (Array.isArray(r) ? r : []).forEach(a => {
      if (!a || typeof a !== "object") return;
      const name = String(a.name || "").trim().slice(0, 30);
      const number = String(a.number || "").replace(/\D/g, "").slice(-4);
      if (a.id === "main") { if (name) list[0].name = name; if (number) list[0].number = number; return; }
      const id = String(a.id || "").slice(0, 40);
      if (!id || seen[id] || list.length >= E.MAX_ACCOUNTS) return;
      seen[id] = true; list.push(Object.assign({ id, name: name || "Checking " + (list.length + 1), start: n(a.start, 0) }, number ? { number } : {}));
    });
    return list;
  }

  function cleanSavings(r) {
    const d = E.defaultSavings(); if (!r || typeof r !== "object") return d;
    const inc = {}; if (r.invInclude && typeof r.invInclude === "object") Object.keys(r.invInclude).slice(0, 100).forEach(k => inc[String(k).slice(0, 40)] = !!r.invInclude[k]);
    return { start: n(r.start, 0, 0, 1e9), roi: n(r.roi, d.roi, -50, 50), invStart: n(r.invStart, 0, 0, 1e9), invRoi: n(r.invRoi, d.invRoi, -50, 50),
      horizon: Object.prototype.hasOwnProperty.call(E.HORIZONS, r.horizon) ? r.horizon : d.horizon, invInclude: inc };
  }
  const MODES = ["auto", "percent", "amount", "off"];
  function cleanDeductions(r) {
    const d = E.defaultDeductions();
    if (!r || typeof r !== "object") return d;
    const f = r.federal || {}, st = r.state || {};
    return {
      enabled: !!r.enabled, filingStatus: E.FILING.includes(r.filingStatus) ? r.filingStatus : "Single",
      federal: { mode: MODES.includes(f.mode) ? f.mode : "auto", value: n(f.value, 0, 0, 1e7), extra: n(f.extra, 0, 0, 1e7), credits: n(f.credits, 0, 0, 1e7) },
      socialSecurity: r.socialSecurity !== false, medicare: r.medicare !== false,
      state: { mode: MODES.includes(st.mode) ? st.mode : "auto", code: window.FTTax && window.FTTax.STATES[st.code] ? st.code : "", value: n(st.value, 0, 0, 1e7), localPercent: n(st.localPercent, 0, 0, 15) },
      items: (Array.isArray(r.items) ? r.items : []).slice(0, 30).filter(x => x && String(x.name || "").trim()).map(x => ({
        id: String(x.id || uid()).slice(0, 40), name: String(x.name).trim().slice(0, 40), unit: x.unit === "%" ? "%" : "$",
        value: n(x.value, 0, 0, x.unit === "%" ? 100 : 1e7), treatment: E.TREATMENTS.includes(x.treatment) ? x.treatment : "posttax"
      }))
    };
  }
  function load() {
    try { const raw = localStorage.getItem(KEY); state = raw ? clean(JSON.parse(raw)) : exampleState(); }
    catch (e) { state = exampleState(); }
    try { localStorage.setItem(KEY + ".probe", "1"); localStorage.removeItem(KEY + ".probe"); } catch (e) { storageOk = false; }
    return state;
  }
  /* Everything is saved on this device only, in two places: localStorage (instant) and an IndexedDB copy.
     If the browser clears one of them, the other brings your numbers back. Nothing is ever sent online. */
  let idbOk = null, persisted = null;
  const DB = (root.FT_STORAGE && root.FT_STORAGE.db) || "financeToolbox-data", STORE = "kv"; /* its own database: filestore.js uses "financeToolbox" for the saved-file link */
  function idb() {
    return new Promise((res, rej) => {
      try {
        if (!root.indexedDB) return rej(new Error("no IndexedDB"));
        const rq = indexedDB.open(DB, 1);
        rq.onupgradeneeded = () => rq.result.createObjectStore(STORE);
        rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error); rq.onblocked = () => rej(new Error("blocked"));
      } catch (e) { rej(e); }
    });
  }
  function idbDo(mode, fn) {
    return idb().then(db => new Promise((res, rej) => {
      const tx = db.transaction(STORE, mode), st = tx.objectStore(STORE), rq = fn(st);
      tx.oncomplete = () => { db.close(); res(rq && rq.result); }; tx.onerror = tx.onabort = () => { db.close(); rej(tx.error); };
    }));
  }
  let mirrorT = null;
  function mirror() {
    clearTimeout(mirrorT);
    mirrorT = setTimeout(() => {
      const copy = JSON.stringify(state);
      idbDo("readwrite", st => st.put(copy, KEY)).then(() => { idbOk = true; }, () => { idbOk = false; });
    }, 250);
  }
  function persist() { try { localStorage.setItem(KEY, JSON.stringify(state)); storageOk = true; } catch (e) { storageOk = false; } mirror(); }
  /* Ask the browser to keep this site's storage even when the device is low on space.
     Installed apps (Add to Home Screen / Install) are usually granted this automatically. */
  function protect() {
    try {
      if (!navigator.storage || !navigator.storage.persist) { persisted = null; return Promise.resolve(null); }
      return navigator.storage.persisted().then(p => p || navigator.storage.persist()).then(p => (persisted = !!p), () => (persisted = null));
    } catch (e) { return Promise.resolve(null); }
  }
  /* just read whether protection is already on (never shows a prompt) */
  function checkProtect() {
    try { if (!navigator.storage || !navigator.storage.persisted) return Promise.resolve(null); return navigator.storage.persisted().then(p => (persisted = !!p), () => null); }
    catch (e) { return Promise.resolve(null); }
  }
  /* After start-up: if localStorage came back empty (or older than the IndexedDB copy), restore from IndexedDB.
     Resolves true when it restored something. */
  function recover() {
    const hadLocal = (() => { try { return !!localStorage.getItem(KEY); } catch (e) { return false; } })();
    return idbDo("readonly", st => st.get(KEY)).then(raw => {
      idbOk = true;
      if (!raw) { if (hadLocal && !state.isExample) mirror(); return false; }
      let saved; try { saved = clean(JSON.parse(raw)); } catch (e) { return false; }
      const newer = !hadLocal || (saved.updatedAt || 0) > (state.updatedAt || 0) + 1000;
      if (!newer || saved.isExample) { if (!state.isExample) mirror(); return false; }
      state = saved; try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
      emit("restore"); return true;
    }, () => { idbOk = false; return false; });
  }
  function clearDevice() { try { localStorage.removeItem(KEY); } catch (e) {} return idbDo("readwrite", st => st.delete(KEY)).catch(() => {}); }
  function emit(reason) { listeners.forEach(fn => { try { fn(state, reason); } catch (e) { console.error(e); } }); }

  /* Every user edit goes through update(): it stamps the time, saves, and re-renders. */
  function update(mutator, reason = "edit", opts = {}) {
    const draft = JSON.parse(JSON.stringify(state));
    mutator(draft);
    if (!opts.keepExample) draft.isExample = false;
    if (!opts.silent) draft.updatedAt = Date.now();
    state = clean(draft);
    persist(); emit(reason);
    return state;
  }
  function replace(next, reason = "replace") { state = clean(next); persist(); emit(reason); return state; }
  function setSync(patch) { state.sync = Object.assign({}, state.sync, patch); persist(); emit("sync-meta"); }

  root.FTStore = {
    load, update, replace, setSync, clean, exampleState, blankState, uid, todayIso,
    get: () => state, onChange: fn => (listeners.add(fn), () => listeners.delete(fn)),
    storageOk: () => storageOk,
    recover, protect, checkProtect, clearDevice,
    deviceStatus: () => ({ local: storageOk, copy: idbOk, persisted })
  };
})(window);
