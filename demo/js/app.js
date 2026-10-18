/* Finance Toolbox app: renders the dashboard from the engine and handles every edit. */
(function () {
  "use strict";
  const E = window.FTEngine, Store = window.FTStore, Sheets = window.FTSheets;
  const $ = id => document.getElementById(id);
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const MON = MONTHS.map(m => m.slice(0, 3));
  const DOW = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  let savedUi = {}; try { savedUi = JSON.parse(localStorage.getItem("ft.ui") || "{}") || {}; } catch (e) {}
  const V = { proj: null, byIso: {}, months: [], mIdx: null, sel: null, balAnimated: false, monAnimated: false,
    range: [30, 91, 182, 0].includes(savedUi.range) ? savedUi.range : 91, donut: "this", cfIdx: null, sum: savedUi.sum === "percent" ? "percent" : "totals", view: "dashboard", acct: typeof savedUi.acct === "string" ? savedUi.acct : "all" };
  const saveUi = () => { try { localStorage.setItem("ft.ui", JSON.stringify({ range: V.range, sum: V.sum, acct: V.acct })); } catch (e) {} };

  /* ---------- formatting ---------- */
  function fmt(n, o = {}) {
    const cents = o.cents !== false;
    const s = Math.abs(n).toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });
    return (n < 0 ? "-" : (o.sign && n > 0 ? "+" : "")) + s;
  }
  function short(n) { const a = Math.abs(n), s = n < 0 ? "-" : ""; if (a >= 1e6) return s + "$" + (a / 1e6).toFixed(1).replace(/\.0$/, "") + "M"; if (a >= 1e3) return s + "$" + (a / 1e3).toFixed(a >= 1e4 ? 0 : 1).replace(/\.0$/, "") + "k"; return s + "$" + Math.round(a); }
  const P = iso => E.parts(E.toDay(iso));
  function niceDate(iso, dow, year) { const p = P(iso); return (dow ? DOW[p.dow] + ", " : "") + MON[p.m] + " " + p.d + (year ? ", " + p.y : ""); }
  const todayIso = () => Store.todayIso();
  const monthKey = iso => { const p = P(iso); return p.y * 12 + p.m; };

  /* ---------- notifications ----------
     toast("text") or toast({ kind, title, detail, impact, action:{label,run}, duration })
     kind: added | saved | deleted | income | sync | error | info */
  const ICONS = {
    added: '<path d="M12 5v14M5 12h14"/>',
    saved: '<path d="M5 12.5l4.2 4.2L19 7"/>',
    deleted: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>',
    sync: '<path d="M20 12a8 8 0 0 1-14.3 4.9M4 12A8 8 0 0 1 18.3 7.1"/><path d="M18 3v4.5h-4.5M6 21v-4.5h4.5"/>',
    error: '<path d="M12 8v5M12 16.5v.5"/><path d="M10.3 3.9L2.4 17.6A2 2 0 0 0 4.1 20.6h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.5v.5"/>'
  };
  function toast(input, action) {
    const o = typeof input === "string" ? { title: input, action } : Object.assign({}, input);
    const kind = ICONS[o.kind] ? o.kind : (o.action ? "info" : "saved");
    const tone = o.tone || ({ deleted: "neutral", error: "error", sync: "accent", info: "accent" }[kind] || "accent");
    const duration = o.duration || (o.action ? 6500 : kind === "error" ? 7000 : 3600);
    const box = $("toasts");
    while (box.children.length >= 3) box.firstElementChild.remove();
    const el = document.createElement("div");
    el.className = "toast tone-" + tone;
    el.setAttribute("role", kind === "error" ? "alert" : "status");
    el.style.setProperty("--dur", duration + "ms");
    el.innerHTML =
      '<span class="t-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' + ICONS[kind] + '</svg></span>' +
      '<div class="t-body"><div class="t-title">' + esc(o.title) + '</div>' +
      (o.detail ? '<div class="t-detail">' + esc(o.detail) + '</div>' : "") +
      '</div>' +
      '<div class="t-actions">' + (o.action ? '<button type="button" class="t-undo">' + esc(o.action.label) + '</button>' : "") +
      '<button type="button" class="t-close" aria-label="Dismiss"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>' +
      (o.impact ? '<div class="t-impact num">' + o.impact + '</div>' : "") +
      '<span class="t-timer" aria-hidden="true"></span>';
    box.appendChild(el);
    /* an open modal dialog makes everything outside it unclickable, so notifications live inside it while it's open */
    placeToasts();
    /* re-show the popover so notifications sit above any open dialog */
    if (box.showPopover) { try { if (box.matches(":popover-open")) box.hidePopover(); box.showPopover(); } catch (e) {} }
    let left = duration, started = Date.now(), timer = null, closed = false;
    const close = () => {
      if (closed) return; closed = true; clearTimeout(timer); el.classList.add("out");
      setTimeout(() => { el.remove(); if (!box.children.length && box.hidePopover) try { box.hidePopover(); } catch (e) {} }, 280);
    };
    const run = () => { started = Date.now(); el.classList.remove("paused"); timer = setTimeout(close, left); };
    const pause = () => { clearTimeout(timer); left -= Date.now() - started; el.classList.add("paused"); };
    el.addEventListener("pointerenter", pause); el.addEventListener("pointerleave", run);
    el.addEventListener("focusin", pause); el.addEventListener("focusout", run);
    el.querySelector(".t-close").onclick = close;
    if (o.action) el.querySelector(".t-undo").onclick = () => { o.action.run(); close(); };
    run();
  }
  function placeToasts() {
    const box = $("toasts"), host = [...document.querySelectorAll("dialog[open]")].pop() || document.body;
    if (box.parentNode === host) return;
    host.appendChild(box);
    if (box.children.length && box.showPopover) { try { if (!box.matches(":popover-open")) box.showPopover(); } catch (e) {} }
  }
  document.querySelectorAll("dialog").forEach(d => d.addEventListener("close", () => setTimeout(placeToasts, 0)));
  /* "Ending balance $16,364 ▼ $270" with the change colored */
  function impactLine(before, after) {
    const d = after - before;
    if (Math.abs(d) < 0.005) return "";
    return '<span>Ending balance</span> <b>' + esc(fmt(after, { cents: false })) + '</b> <span class="t-delta ' + (d > 0 ? "up" : "down") + '">' + (d > 0 ? "&#9650; " : "&#9660; ") + esc(fmt(Math.abs(d), { cents: false })) + '</span>';
  }
  const FREQ_WORD = { "One-time": "one time", "Weekly": "weekly", "Bi-Weekly": "every 2 weeks", "Monthly": "monthly", "Yearly": "yearly" };
  function nextOn(id) {
    const t = todayIso(), lists = V.proj ? [V.proj].concat(V.projAll && V.projAll.byAccount || []) : [];
    for (const pr of lists) { const d = pr.days.find(x => x.iso >= t && x.events.some(e => e.id === id)); if (d) return niceDate(d.iso, true); }
    return "";
  }
  /* ---------- checking accounts ---------- */
  const accts = () => E.accountsOf(Store.get());
  const multi = () => accts().length > 1;
  const acctName = id => (accts().find(a => a.id === id) || accts()[0]).name;
  function itemDetail(it) {
    if (it.type === "Transfer") { const nx = nextOn(it.id); return fmt(it.amount) + " " + FREQ_WORD[it.frequency] + " · " + acctName(it.account) + " → " + acctName(it.to) + (nx ? " · next on " + nx : ""); }
    const amt = fmt(it.type === "Bill" ? -it.amount : it.amount, { sign: true });
    const next = nextOn(it.id);
    return amt + " " + FREQ_WORD[it.frequency] + (next ? " · next on " + next : " · not in this projection");
  }

  function countTo(el, val, o = {}) {
    const from = parseFloat(el.dataset.v || "0"); el.dataset.v = val;
    const tok = el._tok = (el._tok || 0) + 1; /* a newer update cancels this animation */
    const done = () => { if (el._tok !== tok) return; el.textContent = fmt(val, o); el.classList.toggle("neg-t", val < 0); };
    if (reduce || from === val) return done();
    const t0 = performance.now(), dur = 800;
    const step = t => { if (el._tok !== tok) return; const p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3); el.textContent = fmt(from + (val - from) * e, o); p < 1 ? requestAnimationFrame(step) : done(); };
    requestAnimationFrame(step);
  }

  /* ---------- render all ---------- */
  function render() {
    const st = Store.get();
    if (V.acct !== "all" && !E.accountsOf(st).some(a => a.id === V.acct)) V.acct = "all";
    V.projAll = E.computeProjection(st);
    V.proj = V.acct === "all" ? V.projAll : E.computeProjection(st, V.acct);
    V.byIso = {}; V.proj.days.forEach((d, i) => V.byIso[d.iso] = i);
    const ms = []; V.proj.days.forEach(d => { const k = monthKey(d.iso); if (!ms.includes(k)) ms.push(k); });
    const prevKey = V.mIdx != null ? V.months[V.mIdx] : null;
    V.months = ms;
    V.mIdx = ms.includes(prevKey) ? ms.indexOf(prevKey) : Math.max(0, ms.indexOf(monthKey(todayIso())));
    if (!V.sel || V.byIso[V.sel] == null) V.sel = V.byIso[todayIso()] != null ? todayIso() : V.proj.days[0].iso;
    $("exampleBanner").hidden = !st.isExample;
    $("storageBanner").hidden = Store.storageOk();
    if (V.cfIdx != null && V.cfIdx >= ms.length) V.cfIdx = null;
    rankCategories();
    V.grow = E.computeGrowth(st, V.projAll); syncGrowthInputs();
    renderAcctUi();
    renderKpis(); renderCal(); renderDetail(); renderUpcoming(); renderDonut(); renderRecurring(); renderBillSummary(); renderProfile(); renderBreakdown();
    renderSized();
    renderEyebrow();
    if ($("drawer").open) { renderItemList(); renderPreviews(); renderTaxPreview(); }
  }

  /* "Safe to spend until payday": the lowest end-of-day balance from today until the day before the next paycheck.
     Spending up to that amount today keeps the balance at or above $0 until money comes in. */
  function renderSafe() {
    const L = V.proj.days, t = todayIso(), card = $("safeCard");
    if (!L.length || t > L[L.length - 1].iso) { card.hidden = true; return; }
    card.hidden = false;
    const start = t < L[0].iso ? 0 : V.byIso[t];
    const payIso = (V.projAll.days.find(d => d.pay > 0 && d.iso > t) || {}).iso;
    let end = payIso ? L.findIndex(d => d.iso >= payIso) - 1 : L.length - 1;
    if (end < start) end = start;
    let low = L[start]; for (let i = start; i <= end; i++) if (L[i].balance < low.balance) low = L[i];
    const safe = low.balance, days = end - start + 1, v = $("safeVal");
    card.classList.toggle("short", safe < 0);
    $("safeH").textContent = payIso ? "Safe to spend until payday" : "Safe to spend";
    if (safe < 0) {
      countTo(v, safe);
      $("safeMeta").innerHTML = '<span class="chip neg">&#9888; Short by ' + esc(fmt(-safe)) + " on " + esc(niceDate(low.iso, true)) + "</span>";
      $("safeHelp").textContent = "Your bills before " + (payIso ? "payday" : "the end of the projection") + " are more than your balance. Move a bill, add income, or transfer money in before " + niceDate(low.iso) + ".";
      return;
    }
    countTo(v, safe);
    const per = days > 1 ? "About " + fmt(safe / days, { cents: false }) + " a day for " + days + " days" : "For today";
    $("safeMeta").textContent = per + (payIso ? " · next paycheck " + niceDate(payIso, true) : " · through " + niceDate(L[end].iso));
    $("safeHelp").textContent = (payIso ? "Bills due before your next paycheck are already taken out." : "All bills in your projection are already taken out.") + " Spend up to this and your balance stays above $0" + (payIso ? " until payday." : ".");
  }
  function renderKpis() {
    renderSafe();
    const L = V.proj.days, t = todayIso(), first = L[0], last = L[L.length - 1];
    let bt, meta;
    if (t < first.iso) { bt = Store.get().projection.startingBalance; meta = "Projection starts " + niceDate(first.iso); }
    else if (t > last.iso) { bt = last.balance; meta = "Projection ended " + niceDate(last.iso); }
    else { bt = L[V.byIso[t]].balance; meta = niceDate(t, true); }
    countTo($("k1"), bt); $("k1m").textContent = meta;
    const np = L.find(x => x.pay > 0 && x.iso >= t);
    if (np) { countTo($("k2"), np.pay); const days = E.toDay(np.iso) - E.toDay(t); $("k2m").textContent = niceDate(np.iso, true) + " · " + (days === 0 ? "today" : days === 1 ? "tomorrow" : "in " + days + " days"); }
    else { $("k2")._tok = ($("k2")._tok || 0) + 1; $("k2").textContent = "None ahead"; $("k2").classList.remove("neg-t"); delete $("k2").dataset.v; $("k2m").textContent = V.acct !== "all" && (Store.get().income.depositTo || "main") !== V.acct ? "Paychecks go into " + acctName(Store.get().income.depositTo) : V.proj.income.paycheck > 0 || V.proj.depositMode ? "No paydays left in this projection" : "Add your pay in Settings"; }
    countTo($("k3"), last.balance); $("k3m").textContent = "On " + niceDate(last.iso, false, true);
    const lo = V.proj.low; countTo($("k4"), lo.balance);
    $("k4m").innerHTML = lo.balance < 0 ? '<span class="chip neg">&#9888; Below $0 on ' + esc(niceDate(lo.iso)) + '</span>' : '<span class="chip">&#10003; Stays positive</span> <span>' + esc(niceDate(lo.iso)) + '</span>';
  }

  /* ---------- chart helpers ---------- */
  function tipFor(host) { let t = host.querySelector(".tip"); if (!t) { t = document.createElement("div"); t.className = "tip"; host.appendChild(t); } return t; }
  function placeTip(host, t, x, y) { const w = host.clientWidth, tw = t.offsetWidth || 160; let left = x + 14; if (left + tw > w) left = x - tw - 14; t.style.left = Math.max(0, left) + "px"; t.style.top = Math.max(0, y - 10) + "px"; }
  function niceTicks(min, max, n = 4) {
    if (min === max) max = min + 1;
    const raw = (max - min) / n, mag = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / mag;
    const step = (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * mag, lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step, t = [];
    for (let v = lo; v <= hi + step / 2; v += step) t.push(Math.round(v * 100) / 100);
    return t;
  }

  /* ---------- categories and colors ---------- */
  const INC_COLOR = { "Paychecks": "var(--income)", "Side income": "var(--c-net)", "Other income": "var(--c-ded)", "Transfers": "var(--accent)" };
  let CAT_RANK = {};
  function rankCategories() {
    const tot = {};
    V.proj.days.forEach(p => p.events.forEach(e => { if (e.kind !== "income") tot[e.category] = (tot[e.category] || 0) - e.amount; }));
    Store.get().items.forEach(i => { if (i.type === "Bill") { const c = E.categoryOf(i); if (tot[c] == null) tot[c] = 0; tot[c] += E.monthlyEquivalent(i) * 0.001; } });
    CAT_RANK = {};
    Object.keys(tot).filter(c => c !== "Other").sort((a, b) => tot[b] - tot[a]).forEach((c, i) => CAT_RANK[c] = i);
  }
  function catColor(c) {
    if (INC_COLOR[c]) return INC_COLOR[c];
    if (c === "Other" || c === "More") return "var(--cat-0)";
    const r = CAT_RANK[c];
    return "var(--cat-" + (r == null ? 0 : r < 8 ? r + 1 : 0) + ")";
  }
  const initials = name => { const w = String(name).replace(/[^A-Za-z0-9 ]+/g, " ").trim().split(/\s+/).filter(Boolean); return ((w[0] || "?")[0] + (w[1] ? w[1][0] : (w[0] || "").slice(1, 2))).toUpperCase(); };
  const avatar = (name, color) => '<span class="av" aria-hidden="true" style="background:' + color + '">' + esc(initials(name)) + '</span>';
  const catChip = c => '<span class="cat-chip"><i style="background:' + catColor(c) + '"></i>' + esc(c) + '</span>';
  const monthName = k => MONTHS[k % 12] + " " + Math.floor(k / 12);
  const daysInMonth = k => new Date(Date.UTC(Math.floor(k / 12), k % 12 + 1, 0)).getUTCDate();
  /* totals for one month (or all months when k is null) */
  function monthAgg(k) {
    /* money moved between your own accounts is kept apart from income and bills (xin, xout, by other account) */
    const a = { inc: 0, out: 0, incCat: {}, outCat: {}, days: 0, xin: 0, xout: 0, xinBy: {}, xoutBy: {} };
    V.proj.days.forEach(p => {
      if (k != null && monthKey(p.iso) !== k) return;
      a.days++;
      p.events.forEach(e => {
        if (e.transfer) { const nm = e.otherName || "another account"; if (e.amount > 0) { a.xin += e.amount; a.xinBy[nm] = (a.xinBy[nm] || 0) + e.amount; } else { a.xout -= e.amount; a.xoutBy[nm] = (a.xoutBy[nm] || 0) - e.amount; } return; }
        if (e.amount > 0) { a.inc += e.amount; a.incCat[e.category] = (a.incCat[e.category] || 0) + e.amount; }
        else { a.out -= e.amount; a.outCat[e.category] = (a.outCat[e.category] || 0) - e.amount; }
      });
    });
    return a;
  }
  /* top n categories, the rest folded into Other */
  function topCats(obj, n) {
    const arr = Object.entries(obj).filter(([, v]) => v > 0.004).sort((a, b) => b[1] - a[1]);
    const keep = arr.filter(([c]) => c !== "Other").slice(0, n), rest = arr.filter(x => !keep.includes(x)).reduce((s, [, v]) => s + v, 0);
    if (rest > 0.004) keep.push(["Other", rest]);
    return keep;
  }
  const pct = (v, t) => t > 0 ? Math.round(v / t * 100) : 0;
  /* bills on a day, leaving out money moved to your other accounts */
  const billsOf = p => p.events.reduce((s, e) => s + (!e.transfer && e.amount < 0 ? -e.amount : 0), 0);
  const inOf = p => p.events.reduce((s, e) => s + (!e.transfer && e.amount > 0 ? e.amount : 0), 0);
  function curMonth() { const k = monthKey(todayIso()); return V.months.includes(k) ? k : V.months[0]; }

  /* ---------- balance chart with time range ---------- */
  function renderBalance() {
    const host = $("balChart"), all = V.proj.days, t = todayIso();
    let s0 = 0, end = all.length;
    if (V.range) {
      s0 = V.byIso[t] != null ? V.byIso[t] : t < all[0].iso ? 0 : all.length - 1;
      end = Math.min(all.length, s0 + V.range + 1);
      if (end - s0 < 2) { s0 = Math.max(0, all.length - 1 - V.range); end = all.length; }
    }
    const L = all.slice(s0, end);
    document.querySelectorAll("#rangePills button").forEach(b => b.setAttribute("aria-pressed", String(+b.dataset.range === V.range)));
    const first = L[0], last = L[L.length - 1], d = last.balance - first.balance;
    countTo($("balBig"), last.balance);
    $("balDelta").className = "delta " + (d >= 0 ? "up" : "down");
    $("balDelta").textContent = (d >= 0 ? "▲ " : "▼ ") + fmt(Math.abs(d), { cents: false }) + (Math.abs(first.balance) > 1 && Math.abs(d / first.balance) <= 5 ? " (" + (d >= 0 ? "+" : "-") + Math.abs(Math.round(d / Math.abs(first.balance) * 100)) + "%)" : "") + " by " + niceDate(last.iso);
    const W = host.clientWidth || 800, H = 250, m = { l: 52, r: 14, t: 16, b: 28 }, iw = W - m.l - m.r, ih = H - m.t - m.b;
    const vals = L.map(x => x.balance), ticks = niceTicks(Math.min(0, ...vals), Math.max(...vals));
    const y0 = ticks[0], y1 = ticks[ticks.length - 1];
    const X = i => m.l + (L.length === 1 ? iw / 2 : i * iw / (L.length - 1)), Y = v => m.t + ih - (v - y0) / (y1 - y0) * ih;
    let line = ""; L.forEach((p, i) => { line += (i ? "L" : "M") + X(i).toFixed(1) + "," + Y(p.balance).toFixed(1); });
    const base = Y(Math.max(y0, 0));
    const area = line + "L" + X(L.length - 1).toFixed(1) + "," + base + "L" + X(0).toFixed(1) + "," + base + "Z";
    let s = '<g class="grid">' + ticks.map(tk => '<line x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + Y(tk) + '" y2="' + Y(tk) + '"/>').join("") + '</g><g class="axis">' +
      ticks.map(tk => '<text x="' + (m.l - 8) + '" y="' + (Y(tk) + 4) + '" text-anchor="end">' + short(tk) + '</text>').join("");
    let lastLabelX = -99;
    const byWeek = L.length <= 45;
    L.forEach((p, i) => { const dd = P(p.iso); const mark = byWeek ? (i === 0 || dd.dow === 0) : (dd.d === 1 || i === 0); if (mark && X(i) - lastLabelX > 44) { s += '<text x="' + X(i) + '" y="' + (H - 8) + '" text-anchor="' + (i === 0 ? "start" : "middle") + '">' + (byWeek ? MON[dd.m] + " " + dd.d : MON[dd.m]) + '</text>'; lastLabelX = X(i); } });
    s += '</g>';
    if (y0 < 0) s += '<line x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + Y(0) + '" y2="' + Y(0) + '" stroke="var(--neg)" stroke-dasharray="4 4"/>';
    const anim = !reduce;
    s += '<defs><linearGradient id="ga" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--accent)" stop-opacity=".28"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/></linearGradient></defs>';
    s += '<path d="' + area + '" fill="url(#ga)" class="' + (anim ? "fadein" : "") + '"/><path id="balLine" d="' + line + '" fill="none" stroke="var(--accent)" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>';
    s += '<g class="' + (anim ? "fadein" : "") + '">' + L.map((p, i) => p.pay > 0 ? '<circle cx="' + X(i) + '" cy="' + Y(p.balance) + '" r="3.5" fill="var(--income)" stroke="var(--surface)" stroke-width="2"/>' : (p.balance < 0 ? '<circle cx="' + X(i) + '" cy="' + Y(p.balance) + '" r="2.5" fill="var(--neg)"/>' : "")).join("") + '</g>';
    const ti = V.byIso[t] != null ? V.byIso[t] - s0 : -1;
    if (ti >= 0 && ti < L.length) s += '<line x1="' + X(ti) + '" x2="' + X(ti) + '" y1="' + m.t + '" y2="' + (m.t + ih) + '" stroke="var(--ink-2)" stroke-dasharray="2 4"/><text x="' + (X(ti) + 5) + '" y="' + (m.t + 2) + '" fill="var(--ink-2)" font-size="10" font-family="var(--f-mono)" letter-spacing=".08em">TODAY</text>';
    s += '<g id="hov" style="display:none"><line id="hx" y1="' + m.t + '" y2="' + (m.t + ih) + '" stroke="var(--muted)"/><circle id="hc" r="5" fill="var(--accent)" stroke="var(--surface)" stroke-width="2"/></g>';
    s += '<rect x="' + m.l + '" y="0" width="' + iw + '" height="' + H + '" fill="transparent" id="hit" style="cursor:pointer"/>';
    host.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" height="' + H + '" role="img" aria-label="Projected balance from ' + niceDate(first.iso) + ' to ' + niceDate(last.iso) + ', ending at ' + fmt(last.balance) + '. Select a day to open it in the calendar.">' + s + '</svg>';
    if (anim && V.balAnimKey !== V.range + "|" + L.length) { const p = $("balLine"); p.style.setProperty("--len", p.getTotalLength()); p.classList.add("draw"); V.balAnimKey = V.range + "|" + L.length; }
    const tip = tipFor(host), hit = $("hit");
    const idxAt = e => { const r = host.getBoundingClientRect(), x = (e.clientX - r.left) * (W / r.width); return Math.max(0, Math.min(L.length - 1, Math.round((x - m.l) / iw * (L.length - 1)))); };
    const move = e => {
      const i = idxAt(e), p = L[i], r = host.getBoundingClientRect();
      $("hov").style.display = ""; $("hx").setAttribute("x1", X(i)); $("hx").setAttribute("x2", X(i)); $("hc").setAttribute("cx", X(i)); $("hc").setAttribute("cy", Y(p.balance));
      tip.innerHTML = '<div class="t-date">' + esc(niceDate(p.iso, true, true)) + '</div><div class="t-val num' + (p.balance < 0 ? ' neg-t' : '') + '">' + fmt(p.balance) + '</div>' +
        (p.events.length ? '<div class="t-ev">' + esc(p.events.slice(0, 4).map(e => e.name).join(", ") + (p.events.length > 4 ? " +" + (p.events.length - 4) + " more" : "")) + '</div>' : '') + (p.net ? '<div class="t-ev num">' + fmt(p.net, { sign: true }) + ' that day</div>' : '');
      tip.classList.add("on"); placeTip(host, tip, X(i) * r.width / W, Y(p.balance) * r.height / H);
    };
    hit.addEventListener("pointermove", move); hit.addEventListener("pointerdown", move);
    hit.addEventListener("pointerleave", () => { $("hov").style.display = "none"; tip.classList.remove("on"); });
    hit.addEventListener("click", e => { selectDay(L[idxAt(e)].iso, true); location.hash = "calendar"; });
  }

  /* ---------- spending pace: bills added up through the month vs another month ---------- */
  function renderPace() {
    const host = $("paceChart"), k = curMonth(), i = V.months.indexOf(k);
    const ck = V.months[i - 1] != null ? V.months[i - 1] : V.months[i + 1];
    const cum = key => {
      if (key == null) return null;
      const n = daysInMonth(key), arr = new Array(n).fill(null); let run = 0, any = false;
      for (let d = 1; d <= n; d++) {
        const iso = E.fromDay(Math.round(Date.UTC(Math.floor(key / 12), key % 12, d) / 864e5)), idx = V.byIso[iso];
        if (idx == null) { if (any) arr[d - 1] = run; continue; }
        any = true; run += billsOf(V.proj.days[idx]); arr[d - 1] = run;
      }
      return arr;
    };
    const a = cum(k), b = cum(ck), ta = a.reduce((m, v) => v == null ? m : v, 0), tb = b ? b.reduce((m, v) => v == null ? m : v, 0) : 0;
    const partial = key => key != null && V.proj.days.filter(p => monthKey(p.iso) === key).length < daysInMonth(key);
    countTo($("paceBig"), ta, { cents: false });
    $("paceSub").textContent = MONTHS[k % 12] + (ck != null ? " vs " + MONTHS[ck % 12] : "");
    const diff = ta - tb;
    $("paceMeta").innerHTML = ck == null ? "in bills this month" : '<span class="delta ' + (diff > 0 ? "down" : "up") + '">' + (diff > 0 ? "▲ " : "▼ ") + fmt(Math.abs(diff), { cents: false }) + '</span> ' + (diff > 0 ? "more" : "less") + " than " + MONTHS[ck % 12] + (partial(ck) ? " (partial month)" : "");
    $("paceLegend").innerHTML = '<span><i style="background:var(--bills)"></i>' + MONTHS[k % 12] + '</span>' + (ck != null ? '<span><i style="background:var(--muted)"></i>' + MONTHS[ck % 12] + '</span>' : "");
    const W = host.clientWidth || 420, H = 190, m = { l: 44, r: 10, t: 12, b: 24 }, iw = W - m.l - m.r, ih = H - m.t - m.b;
    const ticks = niceTicks(0, Math.max(1, ta, tb), 3), top = ticks[ticks.length - 1];
    const X = d => m.l + d / 30 * iw, Y = v => m.t + ih - v / top * ih;
    const path = arr => { let s = "", on = false; arr.forEach((v, d) => { if (v == null) { on = false; return; } s += (on ? "L" : "M") + X(d).toFixed(1) + "," + Y(v).toFixed(1); on = true; }); return s; };
    let s = '<g class="grid">' + ticks.map(tk => '<line x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + Y(tk) + '" y2="' + Y(tk) + '"/>').join("") + '</g><g class="axis">' + ticks.map(tk => '<text x="' + (m.l - 8) + '" y="' + (Y(tk) + 4) + '" text-anchor="end">' + short(tk) + '</text>').join("") +
      [1, 8, 15, 22, 29].map(d => '<text x="' + X(d - 1) + '" y="' + (H - 6) + '" text-anchor="middle">' + d + '</text>').join("") + '</g>';
    if (b) s += '<path d="' + path(b) + '" fill="none" stroke="var(--muted)" stroke-width="1.8" stroke-dasharray="4 4" stroke-linejoin="round"/>';
    const tday = P(todayIso()), inMonth = monthKey(todayIso()) === k;
    s += '<path id="paceLine" d="' + path(a) + '" fill="none" stroke="var(--bills)" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>';
    if (inMonth && a[tday.d - 1] != null) s += '<circle cx="' + X(tday.d - 1) + '" cy="' + Y(a[tday.d - 1]) + '" r="4.5" fill="var(--bills)" stroke="var(--surface)" stroke-width="2"/>';
    s += '<g id="phov" style="display:none"><line id="phx" y1="' + m.t + '" y2="' + (m.t + ih) + '" stroke="var(--muted)"/></g><rect id="phit" x="' + m.l + '" y="0" width="' + iw + '" height="' + H + '" fill="transparent"/>';
    host.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" height="' + H + '" role="img" aria-label="Bills added up through ' + MONTHS[k % 12] + ': ' + fmt(ta, { cents: false }) + (ck != null ? ', compared with ' + fmt(tb, { cents: false }) + ' in ' + MONTHS[ck % 12] : '') + '">' + s + '</svg>';
    if (!reduce) { const p = $("paceLine"); p.style.setProperty("--len", p.getTotalLength()); p.classList.add("draw"); }
    const tip = tipFor(host), hit = $("phit");
    const move = e => {
      const r = host.getBoundingClientRect(), x = (e.clientX - r.left) * (W / r.width), d = Math.max(0, Math.min(a.length - 1, Math.round((x - m.l) / iw * 30)));
      $("phov").style.display = ""; $("phx").setAttribute("x1", X(d)); $("phx").setAttribute("x2", X(d));
      tip.innerHTML = '<div class="t-date">Day ' + (d + 1) + '</div><div class="num"><span class="bill-t">&#9632;</span> ' + MON[k % 12] + ' ' + (a[d] == null ? "n/a" : fmt(a[d], { cents: false })) + '</div>' + (b ? '<div class="num" style="color:var(--muted)">&#9632; ' + MON[ck % 12] + ' ' + (b[d] == null ? "n/a" : fmt(b[d], { cents: false })) + '</div>' : "");
      tip.classList.add("on"); placeTip(host, tip, X(d) * r.width / W, 20);
    };
    hit.addEventListener("pointermove", move); hit.addEventListener("pointerdown", move);
    hit.addEventListener("pointerleave", () => { $("phov").style.display = "none"; tip.classList.remove("on"); });
  }

  /* ---------- category donut ---------- */
  function renderDonut() {
    const k = curMonth(), i = V.months.indexOf(k), nk = V.months[i + 1];
    const opts = [["this", MON[k % 12]]].concat(nk != null ? [["next", MON[nk % 12]]] : []).concat([["all", "All"]]);
    if (!opts.some(o => o[0] === V.donut)) V.donut = "this";
    $("donutPills").innerHTML = opts.map(o => '<button type="button" data-donut="' + o[0] + '" aria-pressed="' + (V.donut === o[0]) + '">' + o[1] + '</button>').join("");
    const agg = monthAgg(V.donut === "this" ? k : V.donut === "next" ? nk : null), cats = topCats(agg.outCat, 7), total = agg.out;
    const host = $("donut"), R = 80, r = 56, C = 85;
    if (!total) { host.innerHTML = '<svg viewBox="0 0 170 170" aria-hidden="true"><circle cx="85" cy="85" r="68" fill="none" stroke="var(--surface-2)" stroke-width="24"/></svg><div class="center"><b>$0</b><small>no bills</small></div>'; $("donutList").innerHTML = '<div class="empty">No bills in this period.</div>'; return; }
    let a0 = -Math.PI / 2, s = "";
    const pt = (rad, ang) => (C + rad * Math.cos(ang)).toFixed(2) + "," + (C + rad * Math.sin(ang)).toFixed(2);
    cats.forEach(([c, v], n) => {
      const gap = cats.length > 1 ? 0.025 : 0, a1 = a0 + v / total * Math.PI * 2, s0 = a0 + gap / 2, s1 = Math.max(s0 + 0.001, a1 - gap / 2), big = s1 - s0 > Math.PI ? 1 : 0;
      const d = cats.length === 1 ? "M" + pt(R, -Math.PI / 2) + "A" + R + "," + R + " 0 1 1 " + pt(R, Math.PI * 1.5 - 0.0001) + "L" + pt(r, Math.PI * 1.5 - 0.0001) + "A" + r + "," + r + " 0 1 0 " + pt(r, -Math.PI / 2) + "Z"
        : "M" + pt(R, s0) + "A" + R + "," + R + " 0 " + big + " 1 " + pt(R, s1) + "L" + pt(r, s1) + "A" + r + "," + r + " 0 " + big + " 0 " + pt(r, s0) + "Z";
      s += '<path d="' + d + '" fill="' + catColor(c) + '" data-c="' + n + '" style="' + (reduce ? "" : "animation:fade .5s " + (n * 0.05) + "s backwards") + '"><title>' + esc(c) + ': ' + fmt(v, { cents: false }) + ' (' + pct(v, total) + '%)</title></path>';
      a0 = a1;
    });
    const label = V.donut === "all" ? "whole projection" : MONTHS[(V.donut === "next" ? nk : k) % 12];
    host.innerHTML = '<svg viewBox="0 0 170 170" role="img" aria-label="Bills by category for ' + label + ', ' + fmt(total, { cents: false }) + ' total. ' + esc(cats.map(([c, v]) => c + " " + pct(v, total) + "%").join(", ")) + '">' + s + '</svg><div class="center"><b class="num">' + short(total) + '</b><small>' + esc(label) + '</small></div>';
    $("donutList").innerHTML = cats.map(([c, v], n) => '<div class="cat-item" data-c="' + n + '"><span class="cat-ico" style="background:color-mix(in srgb,' + catColor(c) + ' 18%,transparent)"><i style="background:' + catColor(c) + '"></i></span><span>' + esc(c) + '<small>' + pct(v, total) + '% of bills</small></span><span class="num">' + fmt(v, { cents: false }) + '</span></div>').join("");
    const hl = n => host.querySelectorAll("path").forEach(p => p.classList.toggle("dim", n != null && p.dataset.c !== n));
    $("donutList").querySelectorAll(".cat-item").forEach(el => { el.addEventListener("pointerenter", () => hl(el.dataset.c)); el.addEventListener("pointerleave", () => hl(null)); });
    host.querySelectorAll("path").forEach(p => { p.addEventListener("pointerenter", () => hl(p.dataset.c)); p.addEventListener("pointerleave", () => hl(null)); });
  }

  /* ---------- upcoming, with avatars and categories ---------- */
  function renderUpcoming() {
    const L = V.proj.days, t = todayIso();
    const start = t < L[0].iso ? 0 : (V.byIso[t] ?? L.length);
    let rows = [], tin = 0, tout = 0;
    L.slice(start, start + 14).forEach(p => p.events.forEach(e => { if (e.amount > 0) tin += e.amount; else tout -= e.amount; rows.push([p, e]); }));
    const days = iso => { const n = E.toDay(iso) - E.toDay(t); return n === 0 ? "Today" : n === 1 ? "Tomorrow" : niceDate(iso, true); };
    const html = rows.slice(0, 9).map(([p, e]) => {
      const editable = e.id !== "payday", tag = editable ? "button" : "div", inc = e.amount > 0;
      return '<' + tag + (editable ? ' type="button" data-edit="' + esc(e.id) + '"' : "") + ' class="row">' + avatar(e.name, catColor(e.category)) +
        '<span class="nm">' + esc(e.name) + catChip(e.category) + '<span class="when">' + esc(days(p.iso)) + (e.frequency && e.frequency !== "Payday" && e.frequency !== "One-time" ? " · " + esc(FREQ_WORD[e.frequency] || e.frequency) : "") + (evWhere(e) ? " · " + esc(evWhere(e)) : "") + '</span></span>' +
        '<span class="amt num ' + (inc ? "pos" : "") + '">' + fmt(e.amount, { sign: inc }) + '</span></' + tag + '>';
    }).join("") + (rows.length > 9 ? '<a class="row more-link" href="#calendar"><span></span><span class="nm sm">+' + (rows.length - 9) + ' more in the next 2 weeks</span><span class="sm">Projection Calendar &rsaquo;</span></a>' : rows.length ? '<a class="link-more up-foot" href="#calendar">See every day in the Projection Calendar &rsaquo;</a>' : "");
    $("upRows").innerHTML = html || '<div class="empty">Nothing due in the next two weeks.</div>';
    $("upSum").innerHTML = rows.length ? '<span class="inc-t">' + fmt(tin, { cents: false }) + ' in</span> · <span class="bill-t">' + fmt(tout, { cents: false }) + ' out</span>' : "";
  }

  /* ---------- cash flow view ---------- */
  function renderCashflow() {
    if (V.cfIdx == null || V.cfIdx >= V.months.length) V.cfIdx = Math.max(0, V.months.indexOf(curMonth()));
    const k = V.months[V.cfIdx], pk = V.months[V.cfIdx - 1], a = monthAgg(k), pa = pk != null ? monthAgg(pk) : null;
    $("cfTitle").textContent = monthName(k);
    $("cfPrev").disabled = V.cfIdx === 0; $("cfNext").disabled = V.cfIdx === V.months.length - 1;
    $("cfNote").textContent = a.days < daysInMonth(k) ? "Partial month: the projection covers " + a.days + " of " + daysInMonth(k) + " days" : (monthKey(todayIso()) === k ? "This month, including what's still ahead" : monthKey(todayIso()) < k ? "Projected" : "");
    /* money moved to savings counts as saved, not spent */
    const net = a.inc + a.xin - a.out - a.xout, saved = a.outCat["Savings"] || 0, rate = a.inc > 0 ? Math.round((a.inc - a.out + saved) / a.inc * 100) : null;
    const tiles = [["inc", fmt(a.inc, { cents: false }), "Money in"]];
    if (a.xin > 0.004) tiles.push(["inc", fmt(a.xin, { cents: false }), "From your other accounts"]);
    tiles.push(["exp", fmt(a.out, { cents: false }), "Bills"]);
    if (a.xout > 0.004) tiles.push(["exp", fmt(a.xout, { cents: false }), "To your other accounts"]);
    tiles.push([net >= 0 ? "inc" : "exp", fmt(net, { cents: false, sign: true }), "Left over"]);
    if (a.xin > 0.004 && a.inc < 0.005) tiles.shift(); /* an account fed only by transfers has no "money in" of its own */
    /* a savings rate only makes sense for the whole picture, not one account that passes money along */
    if (a.xin + a.xout < 0.005 && rate != null) tiles.push(["", rate + "%", saved ? "Savings rate incl. savings transfers" : "Savings rate"]);
    $("cfTiles").style.setProperty("--n", tiles.length);
    $("cfTiles").innerHTML = tiles
      .map(([c, v, l]) => '<div class="tile ' + c + '"><b class="num">' + v + '</b><small>' + l + '</small></div>').join("");
    renderSankey(a);
    renderXfers(k);
    /* bills by category with change from last month */
    const cats = topCats(a.outCat, 11), max = Math.max(1, ...cats.map(c => c[1]));
    $("catSub").textContent = pk != null ? "Change from " + MONTHS[pk % 12] : "";
    $("catRows").innerHTML = cats.length ? cats.map(([c, v], n) => {
      let chg = "";
      if (pa) { const pv = pa.outCat[c] || 0, d = v - pv; chg = Math.abs(d) < 1 ? '<span class="chg flat">no change</span>' : '<span class="chg ' + (d > 0 ? "up" : "down") + '">' + (d > 0 ? "▲ " : "▼ ") + fmt(Math.abs(d), { cents: false }) + '</span>'; }
      return '<div class="cat-row"><span class="l">' + catChip(c).replace('class="cat-chip"', 'class="cat-chip plain"') + '</span>' + chg + '<span class="num" style="font-weight:600">' + fmt(v, { cents: false }) + '</span><span class="bar"><span style="width:' + (v / max * 100).toFixed(1) + '%;background:' + catColor(c) + ';animation-delay:' + (n * 0.05) + 's"></span></span></div>';
    }).join("") : '<div class="empty">No bills this month.</div>';
  }
  function renderSankey(a) {
    a = a || {};
    const host = $("sankey");
    const tin = a.inc + a.xin, tout = a.out + a.xout;
    $("sankSub").textContent = a.xin + a.xout > 0.004 ? "Money in and transfers from your other accounts on the left, bills and transfers out on the right" : V.acct === "all" && multi() ? "Money in on the left, bills on the right. Moves between your accounts are shown below" : "Money in on the left, bills on the right";
    if (tin + tout < 0.01) { host.innerHTML = '<div class="empty">No money in or bills this month.</div>'; return; }
    const T = Math.max(tin, tout), XC = "var(--accent)";
    const left = topCats(a.incCat, 3).map(([c, v]) => ({ c, v, col: catColor(c) }))
      .concat(Object.entries(a.xinBy).sort((x, y) => y[1] - x[1]).map(([nm, v]) => ({ c: "From " + nm, v, col: XC, xfer: true })));
    if (tout > tin + 0.5) left.push({ c: "From your balance", v: tout - tin, col: "var(--neg)" });
    const right = topCats(a.outCat, 8).map(([c, v]) => ({ c, v, col: catColor(c) }))
      .concat(Object.entries(a.xoutBy).sort((x, y) => y[1] - x[1]).map(([nm, v]) => ({ c: "To " + nm, v, col: XC, xfer: true })));
    if (tin > tout + 0.5) right.push({ c: "Left over", v: tin - tout, col: "var(--good)" });
    a = Object.assign({}, a, { inc: tin });
    const W = Math.max(330, host.clientWidth || 800), narrow = W < 600, gap = 10, nw = narrow ? 9 : 12;
    const m = { t: 30, b: 8 }, minSlot = 30, k = (Math.max(220, right.length * 26) - gap * (Math.max(left.length, right.length) - 1)) / T;
    /* small categories get a taller slot so their labels never overlap */
    const colH = arr => arr.reduce((s, n) => s + Math.max(minSlot, n.v * k), 0) + gap * (arr.length - 1);
    const H = Math.ceil(Math.max(colH(left), colH(right), T * k) + m.t + m.b);
    const longest = arr => Math.max(0, ...arr.map(o => o.c.length)), cw = narrow ? 5.6 : 6.3;
    const xL = Math.max(narrow ? 82 : 150, Math.ceil(longest(left) * cw + 14)), xR = W - Math.max(narrow ? 96 : 190, Math.ceil(longest(right) * cw + 20)), xM = (xL + xR) / 2;
    const stack = (arr, x) => { let y = m.t + (H - m.t - m.b - colH(arr)) / 2; arr.forEach(n => { const slot = Math.max(minSlot, n.v * k); n.x = x; n.h = Math.max(2, n.v * k); n.y = y + (slot - n.h) / 2; y += slot + gap; }); };
    stack(left, xL); stack(right, xR);
    const mH = T * k, mY = m.t + (H - m.t - m.b - mH) / 2;
    const band = (x0, y0, x1, y1, h, col, title, n) => { const cx = (x0 + x1) / 2; return '<path class="band" d="M' + x0 + ',' + y0 + 'C' + cx + ',' + y0 + ' ' + cx + ',' + y1 + ' ' + x1 + ',' + y1 + 'L' + x1 + ',' + (y1 + h) + 'C' + cx + ',' + (y1 + h) + ' ' + cx + ',' + (y0 + h) + ' ' + x0 + ',' + (y0 + h) + 'Z" fill="' + col + '" opacity=".32" style="' + (reduce ? "" : "animation:fade .6s " + (n * 0.04) + "s backwards") + '"><title>' + esc(title) + '</title></path>'; };
    let s = "", yIn = mY, yOut = mY, n = 0;
    left.forEach(o => { s += band(xL + nw, o.y, xM, yIn, o.v * k, o.col, o.c + " to money in: " + fmt(o.v, { cents: false }), n++); yIn += o.v * k; });
    right.forEach(o => { s += band(xM + nw, yOut, xR, o.y, o.v * k, o.col, o.c + ": " + fmt(o.v, { cents: false }) + " (" + pct(o.v, a.inc || T) + "% of money in)", n++); yOut += o.v * k; });
    const node = o => '<rect x="' + o.x + '" y="' + o.y + '" width="' + nw + '" height="' + o.h + '" rx="3" fill="' + o.col + '"/>';
    s += left.map(node).join("") + right.map(node).join("") + '<rect x="' + xM + '" y="' + mY + '" width="' + nw + '" height="' + mH + '" rx="3" fill="var(--accent)"/>';
    const lab = (o, side) => { const x = side === "l" ? o.x - 8 : o.x + nw + 8, cy = o.y + o.h / 2, an = side === "l" ? "end" : "start"; return '<text x="' + x + '" y="' + (cy - 2) + '" text-anchor="' + an + '">' + esc(o.c) + '</text><text class="v" x="' + x + '" y="' + (cy + 11) + '" text-anchor="' + an + '">' + fmt(o.v, { cents: false }) + (side === "r" && a.inc > 0 ? " · " + pct(o.v, a.inc) + "%" : "") + '</text>'; };
    s += left.map(o => lab(o, "l")).join("") + right.map(o => lab(o, "r")).join("");
    s += '<text x="' + (xM + nw / 2) + '" y="' + (mY - 14) + '" text-anchor="middle" style="font-weight:600;fill:var(--ink)">Money in</text><text class="v" x="' + (xM + nw / 2) + '" y="' + (mY - 2) + '" text-anchor="middle">' + fmt(a.inc, { cents: false }) + '</text>';
    host.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" height="' + H + '" role="img" aria-label="Cash flow: ' + fmt(a.inc, { cents: false }) + ' in from ' + esc(left.map(o => o.c).join(", ")) + '; going to ' + esc(right.map(o => o.c + " " + fmt(o.v, { cents: false })).join(", ")) + '">' + s + '</svg>';
  }

  /* ---------- transfers between your own accounts, for one month ---------- */
  function renderXfers(k) {
    const card = $("xferCard"), list = accts();
    if (list.length < 2 || !V.projAll.byAccount) { card.hidden = true; return; }
    const rows = [];
    V.projAll.byAccount.forEach(acc => acc.days.forEach(p => { if (monthKey(p.iso) !== k) return; p.events.forEach(e => { if (e.transfer && e.amount < 0) rows.push({ iso: p.iso, from: acc.id, to: e.other, amt: -e.amount, name: e.name, id: e.id }); }); }));
    const mine = V.acct === "all" ? rows : rows.filter(r => r.from === V.acct || r.to === V.acct);
    card.hidden = false;
    if (!mine.length) { $("xfSub").textContent = ""; $("xfChart").innerHTML = '<div class="empty">No transfers between ' + (V.acct === "all" ? "your accounts" : esc(acctName(V.acct)) + " and your other accounts") + ' in ' + monthName(k) + '. Add one with Add bill or income, then choose Transfer.</div>'; $("xfRows").innerHTML = ""; return; }
    const total = mine.reduce((s, r) => s + r.amt, 0);
    $("xfSub").textContent = mine.length + (mine.length === 1 ? " transfer" : " transfers") + " · " + fmt(total, { cents: false }) + " moved";
    /* one band per from/to pair; each account keeps one color across both sides */
    const pairs = {}; mine.forEach(r => { const key = r.from + ">" + r.to; (pairs[key] = pairs[key] || { from: r.from, to: r.to, v: 0, n: 0 }); pairs[key].v += r.amt; pairs[key].n++; });
    const P_ = Object.values(pairs).sort((x, y) => y.v - x.v), col = id => "var(--cat-" + (list.findIndex(a => a.id === id) + 1) + ")";
    const side = key => { const m = {}; P_.forEach(p => { m[p[key]] = (m[p[key]] || 0) + p.v; }); return Object.entries(m).map(([id, v]) => ({ id, v, c: acctName(id), col: col(id) })).sort((x, y) => y.v - x.v); };
    const L = side("from"), R = side("to"), host = $("xfChart");
    const W = Math.max(330, host.clientWidth || 800), narrow = W < 600, nw = narrow ? 9 : 12, gap = 14, minSlot = 34;
    const k2 = Math.max(90, Math.max(L.length, R.length) * 44) / total;
    const colH = arr => arr.reduce((s, n) => s + Math.max(minSlot, n.v * k2), 0) + gap * (arr.length - 1);
    const H = Math.ceil(Math.max(colH(L), colH(R)) + 16), xL = narrow ? 104 : 190, xR = W - (narrow ? 112 : 210);
    const stack = (arr, x) => { let y = 8 + (H - 16 - colH(arr)) / 2; arr.forEach(n => { const slot = Math.max(minSlot, n.v * k2); n.x = x; n.h = Math.max(3, n.v * k2); n.y = y + (slot - n.h) / 2; n.off = 0; y += slot + gap; }); };
    stack(L, xL); stack(R, xR);
    let s = "";
    P_.forEach((p, i) => {
      const a = L.find(n => n.id === p.from), b = R.find(n => n.id === p.to), h = p.v * k2, y0 = a.y + a.off, y1 = b.y + b.off, x0 = xL + nw, x1 = xR, cx = (x0 + x1) / 2; a.off += h; b.off += h;
      s += '<path class="band" d="M' + x0 + ',' + y0 + 'C' + cx + ',' + y0 + ' ' + cx + ',' + y1 + ' ' + x1 + ',' + y1 + 'L' + x1 + ',' + (y1 + h) + 'C' + cx + ',' + (y1 + h) + ' ' + cx + ',' + (y0 + h) + ' ' + x0 + ',' + (y0 + h) + 'Z" fill="' + a.col + '" opacity=".35" style="' + (reduce ? "" : "animation:fade .6s " + (i * 0.05) + "s backwards") + '"><title>' + esc(a.c + " to " + b.c + ": " + fmt(p.v, { cents: false }) + " in " + p.n + (p.n === 1 ? " transfer" : " transfers")) + '</title></path>';
    });
    const node = o => '<rect x="' + o.x + '" y="' + o.y + '" width="' + nw + '" height="' + o.h + '" rx="3" fill="' + o.col + '"/>';
    const lab = (o, sd) => { const x = sd === "l" ? o.x - 8 : o.x + nw + 8, cy = o.y + o.h / 2, an = sd === "l" ? "end" : "start"; return '<text x="' + x + '" y="' + (cy - 2) + '" text-anchor="' + an + '">' + esc(o.c) + '</text><text class="v" x="' + x + '" y="' + (cy + 11) + '" text-anchor="' + an + '">' + (sd === "l" ? "sent " : "got ") + fmt(o.v, { cents: false }) + '</text>'; };
    s += L.map(node).join("") + R.map(node).join("") + L.map(o => lab(o, "l")).join("") + R.map(o => lab(o, "r")).join("");
    s += '<text x="' + (xL + nw / 2) + '" y="' + (H - 1) + '" text-anchor="middle" class="v"></text>';
    host.innerHTML = '<div class="xf-heads"><span>From</span><span>To</span></div><svg viewBox="0 0 ' + W + ' ' + H + '" height="' + H + '" role="img" aria-label="' + esc("Transfers in " + monthName(k) + ": " + P_.map(p => acctName(p.from) + " to " + acctName(p.to) + " " + fmt(p.v, { cents: false })).join(", ")) + '">' + s + '</svg>';
    host.style.setProperty("--xl", xL + "px"); host.style.setProperty("--xr", (W - xR - nw) + "px");
    mine.sort((x, y) => x.iso.localeCompare(y.iso));
    $("xfRows").innerHTML = mine.map(r => '<button type="button" class="row" data-edit="' + esc(r.id) + '">' + avatar(acctName(r.from), col(r.from)) +
      '<span class="nm">' + esc(acctName(r.from)) + ' <span class="xf-arrow" aria-label="to">&rarr;</span> ' + esc(acctName(r.to)) + '<span class="when">' + esc(niceDate(r.iso, true)) + (V.acct !== "all" ? " · " + (r.from === V.acct ? "out of" : "into") + " this account" : "") + '</span></span>' +
      '<span class="amt num">' + fmt(r.amt) + '</span></button>').join("");
  }

  /* ---------- bills grouped like an accounts list ---------- */
  function renderRecurring() {
    const host = $("recur"), its = Store.get().items;
    if (!its.length) { host.innerHTML = '<div class="empty">No bills or extra income yet.</div><button class="btn sm" type="button" data-add>Add your first bill</button>'; return; }
    const t = todayIso(), groups = {}, q = ($("billSearch").value || "").trim().toLowerCase();
    const shown = q ? its.filter(i => (i.name + " " + E.categoryOf(i) + " " + acctName(i.account)).toLowerCase().includes(q)) : its;
    if (!shown.length) { host.innerHTML = '<div class="empty">Nothing matches "' + esc(q) + '".</div>'; $("grpToggle").hidden = true; return; }
    $("grpToggle").hidden = false;
    if (!V.grpOpen) V.grpOpen = {};
    shown.forEach(i => { const c = E.categoryOf(i), g = groups[i.type + "|" + c] = groups[i.type + "|" + c] || { type: i.type, c, list: [], me: 0, once: 0 }; const me = E.monthlyEquivalent(i); g.list.push({ ...i, me }); g.me += me; if (i.frequency === "One-time") g.once += i.amount; });
    const TORD = { Bill: 0, Income: 1, Transfer: 2 };
    const order = Object.values(groups).sort((a, b) => (TORD[a.type] - TORD[b.type]) || (b.me - a.me) || (b.once - a.once));
    let lastType = "";
    host.innerHTML = order.map(g => {
      g.list.sort((a, b) => (b.me - a.me) || (a.frequency === "One-time" && b.frequency === "One-time" ? b.first.localeCompare(a.first) : 0) || b.amount - a.amount);
      const head = g.type !== lastType ? '<div class="nav-lab mono grp-lab">' + (g.type === "Bill" ? "Bills" : g.type === "Income" ? "Extra income" : "Transfers between accounts") + '</div>' : ""; lastType = g.type;
      const col = catColor(g.c), sub = [g.list.length + (g.list.length === 1 ? " item" : " items")].concat(g.once ? [fmt(g.once, { cents: false }) + " one-time"] : []).join(" · ");
      const key = g.type + "|" + g.c, isOpen = q ? true : key in V.grpOpen ? V.grpOpen[key] : its.length <= 12;
      return head + '<details class="grp" data-grp="' + esc(key) + '"' + (isOpen ? " open" : "") + '><summary class="grp-head"><span class="l"><i style="background:' + col + '"></i>' + esc(g.c) + ' <span class="sub">' + sub + '</span></span><span class="num">' + (g.me ? fmt(g.me, { cents: false }) + '<span class="sub"> /mo</span>' : "") + '</span></summary>' +
        g.list.map(i => {
          const once = i.frequency === "One-time", past = once && i.first < t;
          return '<button type="button" class="acct" data-edit="' + esc(i.id) + '">' + avatar(i.name, col) + '<span class="nm">' + esc(i.name) + '<small>' + esc(once ? (past ? "Paid " : "Due ") + niceDate(i.first, false, P(i.first).y !== P(t).y) : FREQ_WORD[i.frequency] + (i.end ? " until " + niceDate(i.end) : "")) + (i.type === "Transfer" ? " · " + esc(acctName(i.account) + " → " + acctName(i.to)) : multi() ? " · " + esc(acctName(i.account)) : "") + '</small></span>' +
            '<span class="r num' + (i.type === "Income" ? " inc-t" : "") + '">' + fmt(i.amount, { cents: i.amount % 1 !== 0 }) + '<small>' + (once ? "once" : i.frequency === "Monthly" ? "a month" : fmt(i.me, { cents: false }) + " a month") + '</small></span></button>';
        }).join("") + '</details>';
    }).join("");
    grpToggleText();
  }
  function grpToggleText() { const d = [...$("recur").querySelectorAll("details.grp")]; $("grpToggle").textContent = d.length && d.every(x => x.open) ? "Close all" : "Open all"; }
  /* remember only groups the person opened or closed (inserting <details open> also fires "toggle") */
  $("recur").addEventListener("click", e => { const sm = e.target.closest("summary.grp-head"); if (!sm) return; const d = sm.parentElement; if (!($("billSearch").value || "").trim()) V.grpOpen[d.dataset.grp] = !d.open; });
  $("recur").addEventListener("toggle", grpToggleText, true);
  $("grpToggle").addEventListener("click", () => { const d = [...$("recur").querySelectorAll("details.grp")], open = !d.every(x => x.open); d.forEach(x => { x.open = open; V.grpOpen[x.dataset.grp] = open; }); grpToggleText(); });
  let bsT; $("billSearch").addEventListener("input", () => { clearTimeout(bsT); bsT = setTimeout(renderRecurring, 120); });

  /* ---------- summary: what money in and bills are made of ---------- */
  function renderBillSummary() {
    const k = curMonth(), a = monthAgg(k), P_ = V.sum === "percent";
    document.querySelectorAll("#sumPills button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.sum === (V.sum || "totals"))));
    const block = (title, total, cats, of) => {
      const rows = cats.map(([c, v]) => [c, v, catColor(c)]);
      return '<div class="sum-block"><div class="sum-top"><span>' + title + '</span><span class="num">' + (P_ && of ? pct(total, of) + "%" : fmt(total, { cents: false })) + '</span></div>' +
        (total > 0 ? '<div class="stack" role="img" aria-label="' + esc(title + ": " + rows.map(([c, v]) => c + " " + pct(v, total) + "%").join(", ")) + '">' + rows.map(([, v, col], n) => '<span style="flex:' + v.toFixed(2) + ';background:' + col + ';animation-delay:' + (n * 0.05) + 's"></span>').join("") + '</div>' : "") +
        rows.map(([c, v, col]) => '<div class="sum-row"><span class="l"><i style="background:' + col + '"></i>' + esc(c) + '</span><span class="num">' + (P_ ? pct(v, total) + "%" : fmt(v, { cents: false })) + '</span></div>').join("") + '</div>';
    };
    const net = a.inc - a.out;
    $("billSummary").innerHTML = '<p class="hint" style="margin:0 0 10px">' + monthName(k) + (a.days < daysInMonth(k) ? " (partial)" : "") + '</p>' +
      block("Money in", a.inc, topCats(a.incCat, 3), 0) + block("Bills", a.out, topCats(a.outCat, 6), a.inc) +
      '<div class="sum-block"><div class="sum-top"><span>Left over</span><span class="num" style="color:var(--' + (net < 0 ? "neg" : "good") + ')">' + (P_ ? (a.inc > 0 ? Math.round(net / a.inc * 100) + "%" : "n/a") : fmt(net, { cents: false, sign: true })) + '</span></div><p class="hint" style="margin:0">' + (P_ ? "Share of money in that stays in your account" : "Money in minus bills for the month") + '</p></div>';
  }

  /* ---------- calendar ---------- */
  function renderCal(dir) {
    const grid = $("cal"), key = V.months[V.mIdx], y = Math.floor(key / 12), mo = key % 12;
    $("mtitle").textContent = MONTHS[mo] + " " + y;
    $("prevM").disabled = V.mIdx === 0; $("nextM").disabled = V.mIdx === V.months.length - 1;
    const firstDow = new Date(Date.UTC(y, mo, 1)).getUTCDay(), days = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate(), t = todayIso();
    let html = "";
    for (let i = 0; i < firstDow; i++) html += '<div class="day blank" aria-hidden="true"></div>';
    for (let d = 1; d <= days; d++) {
      const k = E.fromDay(Math.round(Date.UTC(y, mo, d) / 864e5)), idx = V.byIso[k], p = idx != null ? V.proj.days[idx] : null, isT = k === t;
      if (!p) { html += '<div class="day out' + (isT ? " today" : "") + '"><div class="dn"><span>' + d + '</span></div></div>'; continue; }
      const inc = p.pay + p.extra > 0, bill = p.bills > 0;
      const dots = (inc ? '<i style="background:var(--income)"></i>' : "") + (bill ? '<i style="background:var(--bills)"></i>' : "");
      const label = niceDate(k, true) + ", balance " + fmt(p.balance) + (p.events.length ? ", " + p.events.map(e => e.name).join(", ") : "");
      html += '<button type="button" class="day' + (isT ? " today" : "") + (V.sel === k ? " sel" : "") + (p.balance < 0 ? " negbal" : "") + '" data-iso="' + k + '" aria-label="' + esc(label) + '" aria-pressed="' + (V.sel === k) + '">' +
        '<div class="dn"><span>' + d + '</span><span class="dots">' + dots + '</span></div>' +
        (p.net ? '<span class="net num ' + (p.net > 0 ? "inc-t" : "bill-t") + '">' + fmt(p.net, { sign: true, cents: false }) + '</span>' : '<span class="net"></span>') +
        '<span class="bal num' + (p.balance < 0 ? " neg-t" : "") + '">' + fmt(p.balance, { cents: false }) + '</span></button>';
    }
    grid.innerHTML = html;
    if (dir) { grid.style.setProperty("--dx", (dir * 14) + "px"); grid.classList.remove("month-anim"); void grid.offsetWidth; grid.classList.add("month-anim"); }
  }
  function selectDay(k, jump) {
    if (V.byIso[k] == null) return;
    V.sel = k;
    const ni = V.months.indexOf(monthKey(k));
    if (jump && ni !== V.mIdx) { const dir = ni > V.mIdx ? 1 : -1; V.mIdx = ni; renderCal(dir); } else renderCal();
    renderDetail();
  }

  function evWhere(e) {
    if (e.transfer) return (e.amount < 0 ? "to " : "from ") + e.otherName;
    return multi() && V.acct === "all" ? acctName(e.account) : "";
  }
  function evRow(e, extraCls, lead) {
    const editable = e.id !== "payday", where = evWhere(e);
    const tag = editable ? "button" : "div";
    return '<' + tag + (editable ? ' type="button" data-edit="' + esc(e.id) + '"' : "") + ' class="row ' + (extraCls || "") + '">' + (lead || '<span class="sw" style="background:var(--' + (e.kind === "income" ? "income" : "bills") + ')"></span>') +
      '<span class="nm">' + esc(e.name) + ' <span class="sm">' + esc(e.frequency !== "Payday" ? e.frequency : e.deposit ? "from your bank deposits" : e.breakdown ? "after " + fmt(e.breakdown.taxes + e.breakdown.deductions, { cents: false }) + " taken out" : "Gross pay") + (where ? " · " + esc(where) : "") + '</span></span>' +
      '<span class="amt num ' + (e.kind === "income" ? "inc-t" : "bill-t") + '">' + fmt(e.amount, { sign: true }) + '</span></' + tag + '>';
  }
  function renderDetail() {
    const p = V.proj.days[V.byIso[V.sel]];
    $("dTitle").textContent = niceDate(p.iso, true);
    $("dSub").textContent = P(p.iso).y + (p.iso === todayIso() ? " · Today" : "");
    countTo($("dBal"), p.balance);
    $("dRows").innerHTML = p.events.length ? p.events.map(e => evRow(e) + (e.breakdown ? subRows(e.breakdown) : "")).join("") + (p.events.length > 1 ? '<div class="row"><span></span><span class="nm sm">Net for the day</span><span class="amt num">' + fmt(p.net, { sign: true }) + '</span></div>' : "")
      : '<div class="empty">Nothing scheduled. Your balance carries over.</div>';
  }
  function subRows(b) {
    const r = [["Gross pay", b.gross]];
    if (b.taxes) r.push(["Taxes", -b.taxes]);
    if (b.deductions) r.push(["Benefits and retirement", -b.deductions]);
    return '<div class="sub-rows num">' + r.map(([l, v]) => '<div><span>' + l + '</span><span>' + fmt(v, { sign: v < 0 }) + '</span></div>').join("") + '</div>';
  }

  /* ---------- monthly bars ---------- */
  function renderMonthly() {
    const host = $("monChart"), L = V.proj.days;
    const agg = V.months.map((k, i) => ({ k, label: MON[k % 12] + ((k % 12 === 0 || i === 0) && V.months.length <= 8 && ($("monChart").clientWidth || 600) > 480 ? " '" + String(Math.floor(k / 12)).slice(2) : ""), inc: 0, out: 0, xin: 0, xout: 0, n: 0 }));
    L.forEach(p => { const a = agg[V.months.indexOf(monthKey(p.iso))]; a.inc += inOf(p); a.out += billsOf(p); p.events.forEach(e => { if (e.transfer) { if (e.amount > 0) a.xin += e.amount; else a.xout -= e.amount; } }); a.n++; });
    const hasX = agg.some(a => a.xin + a.xout > 0.004);
    $("monXLeg").hidden = !hasX;
    agg.forEach(a => { a.partial = a.n < new Date(Date.UTC(Math.floor(a.k / 12), a.k % 12 + 1, 0)).getUTCDate(); });
    const W = host.clientWidth || 600, H = 230, m = { l: 48, r: 8, t: 12, b: 30 }, iw = W - m.l - m.r, ih = H - m.t - m.b;
    const ticks = niceTicks(0, Math.max(1, ...agg.map(a => Math.max(a.inc + a.xin, a.out + a.xout)))), top = ticks[ticks.length - 1], Y = v => m.t + ih - v / top * ih;
    const band = iw / agg.length, bw = Math.max(4, Math.min(26, (band - 12) / 2));
    const anim = !V.monAnimated && !reduce;
    const bar = (x, v, col, i) => {
      const h = ih - (Y(v) - m.t); if (h <= 0.5) return "";
      const yy = Y(v), r = Math.min(4, h / 2, bw / 2);
      const d = "M" + x + "," + (m.t + ih) + "V" + (yy + r) + "Q" + x + "," + yy + " " + (x + r) + "," + yy + "H" + (x + bw - r) + "Q" + (x + bw) + "," + yy + " " + (x + bw) + "," + (yy + r) + "V" + (m.t + ih) + "Z";
      return '<path d="' + d + '" fill="' + col + '" data-i="' + i + '" class="mbar" style="transform-origin:0 ' + (m.t + ih) + 'px;' + (anim ? "animation:barup .8s " + (i * 0.06) + "s cubic-bezier(.2,.7,.2,1) backwards" : "") + '"/>';
    };
    let s = '<g class="grid">' + ticks.map(t => '<line x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + Y(t) + '" y2="' + Y(t) + '"/>').join("") + '</g><g class="axis">' + ticks.map(t => '<text x="' + (m.l - 8) + '" y="' + (Y(t) + 4) + '" text-anchor="end">' + short(t) + '</text>').join("");
    const every = band < 34 ? 2 : 1;
    agg.forEach((a, i) => { if (i % every === 0) s += '<text x="' + (m.l + band * i + band / 2) + '" y="' + (H - 10) + '" text-anchor="middle">' + a.label + (a.partial ? "*" : "") + '</text>'; });
    s += '</g>';
    agg.forEach((a, i) => { const cx = m.l + band * i + band / 2; s += (a.xin > 0.004 ? bar(cx - bw - 1, a.inc + a.xin, "var(--accent)", i) : "") + bar(cx - bw - 1, a.inc, "var(--income)", i) + (a.xout > 0.004 ? bar(cx + 1, a.out + a.xout, "var(--accent)", i) : "") + bar(cx + 1, a.out, "var(--bills)", i); });
    s += agg.map((a, i) => '<rect class="mhit" data-i="' + i + '" x="' + (m.l + band * i) + '" y="' + m.t + '" width="' + band + '" height="' + ih + '" fill="transparent"/>').join("");
    host.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" height="' + H + '" role="img" aria-label="Money in and bills for each month. * marks a partial month.">' + s + '</svg>';
    V.monAnimated = true;
    const tip = tipFor(host);
    host.querySelectorAll(".mhit").forEach(el => {
      const show = () => {
        const i = +el.dataset.i, a = agg[i];
        host.querySelectorAll(".mbar").forEach(o => o.classList.toggle("dim", o.dataset.i !== el.dataset.i));
        tip.innerHTML = '<div class="t-date">' + MONTHS[a.k % 12] + ' ' + Math.floor(a.k / 12) + (a.partial ? ' (partial month)' : '') + '</div><div class="num"><span class="inc-t">&#9632;</span> In ' + fmt(a.inc) + '</div><div class="num"><span class="bill-t">&#9632;</span> Bills ' + fmt(a.out) + '</div>' + (a.xin > 0.004 ? '<div class="num"><span style="color:var(--accent)">&#9632;</span> From other accounts ' + fmt(a.xin) + '</div>' : '') + (a.xout > 0.004 ? '<div class="num"><span style="color:var(--accent)">&#9632;</span> To other accounts ' + fmt(a.xout) + '</div>' : '') + '<div class="t-ev num">Left over ' + fmt(a.inc + a.xin - a.out - a.xout, { sign: true }) + '</div>';
        tip.classList.add("on"); const r = host.getBoundingClientRect(), b = el.getBoundingClientRect(); placeTip(host, tip, b.left - r.left + b.width / 2, Y(Math.max(a.inc, a.out)) * r.height / H);
      };
      el.addEventListener("pointerenter", show); el.addEventListener("pointerdown", show);
      el.addEventListener("pointerleave", () => { tip.classList.remove("on"); host.querySelectorAll(".mbar").forEach(o => o.classList.remove("dim")); });
    });
    $("monTable").innerHTML = '<thead><tr><th>Month</th><th>Money in</th><th>Bills</th><th>Left over</th></tr></thead><tbody>' + agg.map(a => '<tr><td>' + MONTHS[a.k % 12] + ' ' + Math.floor(a.k / 12) + (a.partial ? ' (partial)' : '') + '</td><td class="num">' + fmt(a.inc) + '</td><td class="num">' + fmt(a.out) + '</td><td class="num">' + fmt(a.inc - a.out) + '</td></tr>').join("") + '</tbody>';
  }


  function renderProfile() {
    const st = Store.get(), inc = V.proj.income;
    const freqName = { "Week": "Every week", "Bi-Week": "Every 2 weeks", "Semi-Month": "Twice a month", "Month": "Monthly" };
    const f = [["Pay type", st.income.payType], ["Paid", freqName[st.income.payFrequency]], ["Gross per paycheck", fmt(inc.paycheck)], ["Annual gross", fmt(inc.annualGross)], ["Per hour worked", fmt(inc.perHourWorked)], ["Paychecks in " + st.income.year, String(inc.paychecksThisYear)]];
    if (V.proj.depositMode) { f.splice(3, 0, ["Deposit per paycheck", fmt(st.income.depositAmount)]); f.splice(5, 0, ["Deposits per year", fmt(st.income.depositAmount * inc.paychecksThisYear, { cents: false })]); }
    else if (st.deductions.enabled) { const y = E.computeYearPaychecks(st, st.income.year); f.splice(3, 0, ["Take-home per paycheck", fmt(y.typical.net)]); f.splice(5, 0, ["Take-home per year", fmt(y.net, { cents: false })]); }
    $("profile").innerHTML = f.map(([l, v]) => '<div><span class="lab">' + esc(l) + '</span><span class="v num">' + esc(v) + '</span></div>').join("");
  }

  /* ---------- savings and investments ---------- */
  const HZ_LABEL = { proj: "By the end of your projection", "1y": "In 1 year", "5y": "In 5 years", "10y": "In 10 years", "30y": "In 30 years" };
  function growthChart(host, pts, color, o = {}) {
    const W = host.clientWidth || 600, H = o.height || 180, m = { l: 52, r: 12, t: 12, b: 26 }, iw = W - m.l - m.r, ih = H - m.t - m.b;
    const top = Math.max(1, ...pts.map(p => p.total), ...pts.map(p => p.put)), tk = niceTicks(Math.min(0, ...pts.map(p => p.total)), top, o.big ? 4 : 3);
    const y0 = tk[0], y1 = tk[tk.length - 1], d0 = E.toDay(pts[0].iso), span = Math.max(1, E.toDay(pts[pts.length - 1].iso) - d0);
    const X = p => m.l + (E.toDay(p.iso) - d0) / span * iw, Y = v => m.t + ih - (v - y0) / (y1 - y0) * ih;
    const path = k => pts.map((p, i) => (i ? "L" : "M") + X(p).toFixed(1) + "," + Y(p[k]).toFixed(1)).join("");
    const gid = "gg" + host.id;
    let s = '<g class="grid">' + tk.map(t => '<line x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + Y(t) + '" y2="' + Y(t) + '"/>').join("") + '</g><g class="axis">' + tk.map(t => '<text x="' + (m.l - 8) + '" y="' + (Y(t) + 4) + '" text-anchor="end">' + short(t) + '</text>').join("");
    let lastX = -99; const years = span > 400;
    pts.forEach((p, i) => { const d = P(p.iso), x = X(p); const mark = i === 0 || (years ? d.m === 0 && d.d <= 31 && (i === 0 || P(pts[i - 1].iso).y !== d.y) : d.d === 1 || P(pts[i - 1].iso).m !== d.m); if (mark && x - lastX > (years ? 60 : 38)) { s += '<text x="' + x + '" y="' + (H - 7) + '" text-anchor="' + (i ? "middle" : "start") + '">' + (years ? d.y : MON[d.m]) + '</text>'; lastX = x; } });
    s += '</g><defs><linearGradient id="' + gid + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + color + '" stop-opacity=".3"/><stop offset="1" stop-color="' + color + '" stop-opacity="0"/></linearGradient></defs>';
    const base = Y(Math.max(0, y0));
    s += '<path d="' + path("total") + 'L' + X(pts[pts.length - 1]).toFixed(1) + ',' + base + 'L' + X(pts[0]).toFixed(1) + ',' + base + 'Z" fill="url(#' + gid + ')"/>';
    s += '<path d="' + path("put") + '" fill="none" stroke="var(--muted)" stroke-width="1.6" stroke-dasharray="4 4"/>';
    s += '<path class="gline" d="' + path("total") + '" fill="none" stroke="' + color + '" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>';
    if (o.endIso && o.endIso < pts[pts.length - 1].iso) { const x = X({ iso: o.endIso }); s += '<line x1="' + x + '" x2="' + x + '" y1="' + m.t + '" y2="' + (m.t + ih) + '" stroke="var(--ink-2)" stroke-dasharray="2 4"/><text x="' + (x + 5) + '" y="' + (m.t + 9) + '" fill="var(--ink-2)" font-size="10" font-family="var(--f-mono)" letter-spacing=".08em">' + (o.big ? "PROJECTION ENDS" : "") + '</text>'; }
    s += '<g class="ghov" style="display:none"><line y1="' + m.t + '" y2="' + (m.t + ih) + '" stroke="var(--muted)"/><circle r="4.5" fill="' + color + '" stroke="var(--surface)" stroke-width="2"/></g><rect class="ghit" x="' + m.l + '" y="0" width="' + iw + '" height="' + H + '" fill="transparent"/>';
    const last = pts[pts.length - 1];
    host.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" height="' + H + '" role="img" aria-label="' + esc(o.label + ": grows to " + fmt(last.total, { cents: false }) + " by " + niceDate(last.iso, false, true) + ", of which " + fmt(last.put, { cents: false }) + " is money put in") + '">' + s + '</svg>';
    if (!reduce) { const p = host.querySelector(".gline"); p.style.setProperty("--len", p.getTotalLength()); p.classList.add("draw"); }
    const tip = tipFor(host), hit = host.querySelector(".ghit"), hov = host.querySelector(".ghov");
    const move = e => {
      const r = host.getBoundingClientRect(), x = (e.clientX - r.left) * (W / r.width), day = d0 + (x - m.l) / iw * span;
      let best = pts[0]; for (const p of pts) if (Math.abs(E.toDay(p.iso) - day) < Math.abs(E.toDay(best.iso) - day)) best = p;
      hov.style.display = ""; hov.querySelector("line").setAttribute("x1", X(best)); hov.querySelector("line").setAttribute("x2", X(best));
      hov.querySelector("circle").setAttribute("cx", X(best)); hov.querySelector("circle").setAttribute("cy", Y(best.total));
      tip.innerHTML = '<div class="t-date">' + esc(niceDate(best.iso, false, true)) + '</div><div class="t-val num">' + fmt(best.total, { cents: false }) + '</div><div class="t-ev num">Put in ' + fmt(best.put, { cents: false }) + '</div><div class="t-ev num" style="color:' + color + '">Growth ' + fmt(best.total - best.put, { sign: true, cents: false }) + '</div>';
      tip.classList.add("on"); placeTip(host, tip, X(best) * r.width / W, Y(best.total) * r.height / H);
    };
    hit.addEventListener("pointermove", move); hit.addEventListener("pointerdown", move);
    hit.addEventListener("pointerleave", () => { hov.style.display = "none"; tip.classList.remove("on"); });
  }
  function syncGrowthInputs() {
    const sv = V.grow.settings;
    document.querySelectorAll("[data-roi]").forEach(el => { if (document.activeElement !== el) el.value = el.dataset.roi === "sv" ? sv.roi : sv.invRoi; });
    document.querySelectorAll("[data-gs]").forEach(el => { if (document.activeElement !== el) el.value = sv[el.dataset.gs] || ""; });
    document.querySelectorAll("#svPills button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.h === sv.horizon)));
  }
  function growthCard(key, g, color, label) {
    const last = g.points[g.points.length - 1], gain = last.total - last.put;
    countTo($(key + "Big"), last.total, { cents: false });
    $(key + "Delta").className = "delta " + (gain >= 0 ? "up" : "down");
    $(key + "Delta").textContent = (gain >= 0 ? "+" : "-") + fmt(Math.abs(gain), { cents: false }) + " growth";
    $(key + "Meta").textContent = HZ_LABEL[V.grow.settings.horizon] + " (" + niceDate(last.iso, false, true) + ") · " + fmt(last.put, { cents: false }) + " put in" + (g.monthly ? " · " + fmt(g.monthly, { cents: false }) + " a month" : "");
    growthChart($(key + "Chart"), g.points, color, { endIso: V.grow.endIso, label, height: 120 });
  }
  function renderGrowthDash() {
    const G = V.grow;
    growthCard("sv", G.savings, "var(--good)", "Savings projection");
    growthCard("inv", G.invest, "var(--c-ded)", "Investments");
    const svNone = !G.savings.inProjection && !G.settings.start && !G.savings.monthly, invNone = !G.invest.perCheck && !G.settings.invStart;
    const empty = (key, none, msg, btn) => {
      $(key + "Chart").hidden = none; $(key + "Meta").hidden = none; $(key + "Empty").hidden = !none;
      $(key + "Big").parentElement.hidden = none;
      if (none) $(key + "Empty").innerHTML = '<p>' + msg + '</p>' + btn;
    };
    empty("sv", svNone, "Nothing set aside for savings yet. Add a monthly amount, or set any bill's category to Savings.", '<button class="btn sm" type="button" data-add-saving>Add money to savings</button>');
    empty("inv", invNone, G.invest.enabled ? "No 401(k), HSA or other investments in your take-home settings yet." : "Add your 401(k), HSA or other benefits to see them grow.", '<button class="btn sm" type="button" data-open-tax>Set up take-home pay</button>');
  }
  function renderGrowthPage() {
    const G = V.grow, sv = G.settings, s = G.savings, iv = G.invest, ls = s.points[s.points.length - 1], li = iv.points[iv.points.length - 1];
    const lbl = HZ_LABEL[sv.horizon];
    $("svTiles").innerHTML = [["inc", fmt(ls.total, { cents: false }), "Savings, " + lbl.toLowerCase()], ["", fmt(ls.total - ls.put, { cents: false, sign: true }), "Savings growth at " + sv.roi + "%"],
      ["", fmt(li.total, { cents: false }), "Investments, " + lbl.toLowerCase()], ["", fmt(li.total - li.put, { cents: false, sign: true }), "Investment growth at " + sv.invRoi + "%"]]
      .map(([c, v, l]) => '<div class="tile ' + c + '"><b class="num">' + v + '</b><small>' + esc(l) + '</small></div>').join("");
    $("svNote").textContent = sv.horizon === "proj" ? "Through " + niceDate(G.endIso, false, true) : "After " + niceDate(G.endIso, false, true) + " (end of your cash projection), your regular monthly amounts are assumed to continue.";
    const svNone = !ls.total && !ls.put, invNone = !li.total && !li.put;
    $("svBigChart").hidden = $("svLegend").hidden = svNone; $("invBigChart").hidden = $("invLegend").hidden = invNone;
    if (!svNone) growthChart($("svBigChart"), s.points, "var(--good)", { height: 280, big: true, endIso: G.endIso, label: "Savings projection" });
    if (!invNone) growthChart($("invBigChart"), iv.points, "var(--c-ded)", { height: 280, big: true, endIso: G.endIso, label: "Investments" });
    const leg = c => '<span><i style="background:' + c + '"></i>With growth</span><span><i style="background:var(--muted)"></i>Money put in</span>';
    $("svLegend").innerHTML = leg("var(--good)"); $("invLegend").innerHTML = leg("var(--c-ded)");
    $("svHelp").textContent = "Growth is a yearly rate, for example about 4% for a high-yield savings account. Compounded daily.";
    $("invHelp").textContent = "Growth is a yearly rate, for example 6 to 8% for a stock index fund over the long run. Not a promise of returns.";
    const one = Store.get().items.filter(i => i.type === "Bill" && i.frequency === "One-time" && E.categoryOf(i) === "Savings");
    $("svRows").innerHTML = s.items.length || one.length ? s.items.concat(one).map(i => '<button type="button" class="row" data-edit="' + esc(i.id) + '">' + avatar(i.name, "var(--good)") +
      '<span class="nm">' + esc(i.name) + '<span class="when">' + esc(i.frequency === "One-time" ? "Once on " + niceDate(i.first) : FREQ_WORD[i.frequency] + " · " + fmt(E.monthlyEquivalent(i), { cents: false }) + " a month") + '</span></span><span class="amt num pos">' + fmt(i.amount) + '</span></button>').join("")
      : '<div class="empty">Nothing in the Savings category yet. Add money to savings below, or open any bill and set its category to Savings.</div>';
    if (!iv.enabled || !iv.rows.length) { $("invRows").innerHTML = '<div class="empty">Add a 401(k), HSA or other benefits in Settings, Take-home, and they show up here.</div><button class="btn sm" type="button" data-open-tax>Set up take-home pay</button>'; return; }
    const per = E.PERIODS_PER_YEAR[Store.get().income.payFrequency] || 26;
    $("invRows").innerHTML = '<p class="help" style="margin:6px 0">Choose what counts as an investment. Insurance premiums are left out at first.</p>' + iv.rows.map(r => '<label class="inv-row"><input type="checkbox" data-inv="' + esc(r.id) + '"' + (r.invest ? " checked" : "") + '><span class="nm">' + esc(r.name) + '<span class="when">' + (r.treatment === "posttax" ? "After taxes" : "Before taxes") + '</span></span><span class="num">' + fmt(r.amount) + '<span class="when">' + fmt(r.amount * per, { cents: false }) + ' a year</span></span></label>').join("");
  }
  let gsT;
  document.addEventListener("input", e => {
    const el = e.target, roi = el.dataset && el.dataset.roi, gs = el.dataset && el.dataset.gs; if (!roi && !gs) return;
    clearTimeout(gsT); gsT = setTimeout(() => {
      const v = parseFloat(el.value); if (!Number.isFinite(v) && el.value !== "") return;
      Store.update(s => { s.savings = Object.assign(E.defaultSavings(), s.savings); if (roi) s.savings[roi === "sv" ? "roi" : "invRoi"] = Math.max(-50, Math.min(50, v || 0)); else s.savings[gs] = Math.max(0, v || 0); });
    }, 350);
  });
  document.addEventListener("change", e => {
    const id = e.target.dataset && e.target.dataset.inv; if (!id) return;
    Store.update(s => { s.savings = Object.assign(E.defaultSavings(), s.savings); s.savings.invInclude = Object.assign({}, s.savings.invInclude, { [id]: e.target.checked }); });
  });
  document.addEventListener("click", e => { if (e.target.closest("[data-open-tax]")) { Store.update(s => { s.deductions.enabled = true; }); openDrawer("tax"); } });
  $("svPills").addEventListener("click", e => { const b = e.target.closest("button[data-h]"); if (b) Store.update(s => { s.savings = Object.assign(E.defaultSavings(), s.savings, { horizon: b.dataset.h }); }); });
  $("addSaving").addEventListener("click", () => openItem(null, null, { name: "Transfer to savings", category: "Savings", frequency: "Monthly" }));
  document.addEventListener("click", e => { if (e.target.closest("[data-add-saving]")) $("addSaving").click(); });

  /* ---------- account switcher and accounts strip ---------- */
  function renderAcctUi() {
    const list = accts(), sel = $("acctSel"), strip = $("acctStrip");
    $("acctSelWrap").hidden = list.length < 2; strip.hidden = list.length < 2;
    if (list.length < 2) return;
    sel.innerHTML = [["all", "All accounts"]].concat(list.map(a => [a.id, a.name])).map(([id, nm]) => '<option value="' + esc(id) + '"' + (V.acct === id ? " selected" : "") + '>' + esc(nm) + '</option>').join("");
    $("acctSelWrap").classList.toggle("on", V.acct !== "all");
    const t = todayIso();
    strip.innerHTML = (V.projAll.byAccount || []).map(a => {
      const d = a.days.find(x => x.iso === t) || (t < a.days[0].iso ? null : a.days[a.days.length - 1]);
      const now = d ? d.balance : a.start, lowNeg = a.low.balance < 0;
      return '<button type="button" class="acct-tile' + (V.acct === a.id ? " on" : "") + '" data-acct-view="' + esc(a.id) + '"><span class="lab mono">' + esc(a.name) + '</span><b class="num' + (now < 0 ? " neg-t" : "") + '">' + fmt(now) + '</b>' +
        '<small>' + (lowNeg ? '<span class="chip neg">&#9888; Below $0 on ' + esc(niceDate(a.low.iso)) + '</span>' : 'Lowest ' + fmt(a.low.balance, { cents: false }) + ' on ' + esc(niceDate(a.low.iso))) + '</small></button>';
    }).join("");
  }
  $("acctSel").addEventListener("change", e => { V.acct = e.target.value; V.cfIdx = null; saveUi(); render(); });
  document.addEventListener("click", e => {
    const b = e.target.closest("[data-acct-view]"); if (!b) return;
    V.acct = V.acct === b.dataset.acctView && b.classList.contains("acct-tile") ? "all" : b.dataset.acctView;
    V.cfIdx = null; saveUi(); render();
  });

  /* ---------- Settings: checking accounts ---------- */
  const NEW_NAMES = ["Bills checking", "Spending checking"];
  function renderAcctEditor() {
    const st = Store.get(), list = E.accountsOf(st), host = $("acctList");
    host.querySelectorAll(".acct-erow:not([data-acct=main])").forEach(r => r.remove());
    host.querySelector('[data-acct=main] [data-acct-k=name]').value = list[0].name;
    list.slice(1).forEach(a => host.insertAdjacentHTML("beforeend", '<div class="acct-erow" data-acct="' + esc(a.id) + '"><input data-acct-k="name" maxlength="30" aria-label="Account name" value="' + esc(a.name) + '"><span class="money-in"><input data-acct-k="start" type="number" step="0.01" inputmode="decimal" aria-label="Starting balance" value="' + a.start + '"></span><button class="icon-btn" type="button" data-acct-del="' + esc(a.id) + '" aria-label="Remove ' + esc(a.name) + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>'));
    $("acctAdd").hidden = list.length >= E.MAX_ACCOUNTS;
    $("acctHelp").textContent = list.length >= E.MAX_ACCOUNTS ? "That's the most: 3 checking accounts. Enter each balance on the start date." : "Up to 3. Enter each account's balance on the start date, then move money between them with a Transfer.";
    $("depositToWrap").hidden = list.length < 2;
    $("f-depositTo").innerHTML = list.map(a => '<option value="' + esc(a.id) + '"' + (a.id === (st.income.depositTo || "main") ? " selected" : "") + '>' + esc(a.name) + '</option>').join("");
  }
  let acctT;
  $("acctList").addEventListener("input", e => {
    const k = e.target.dataset.acctK; if (!k) return;
    const id = e.target.closest(".acct-erow").dataset.acct, v = e.target.value;
    if (k === "name" && !v.trim()) return;
    clearTimeout(acctT); acctT = setTimeout(() => Store.update(s => {
      s.accounts = E.accountsOf(s).map(a => Object.assign({}, a));
      const a = s.accounts.find(x => x.id === id); if (!a) return;
      if (k === "name") a.name = v.trim().slice(0, 30); else a.start = Number(v) || 0;
    }), 300);
  });
  $("acctAdd").addEventListener("click", () => {
    const list = accts(); if (list.length >= E.MAX_ACCOUNTS) return;
    const name = NEW_NAMES.find(n => !list.some(a => a.name === n)) || "Checking " + (list.length + 1);
    Store.update(s => { s.accounts = E.accountsOf(s).map(a => Object.assign({}, a)).concat([{ id: "acct" + Store.uid(), name, start: 0 }]); });
    renderAcctEditor();
    const rows = $("acctList").querySelectorAll(".acct-erow"); rows[rows.length - 1].querySelector("input").select();
    toast({ kind: "added", title: "Added " + name, detail: "Enter its balance, then add a Transfer to move money into it." });
  });
  $("acctList").addEventListener("click", e => {
    const b = e.target.closest("[data-acct-del]"); if (!b) return;
    const id = b.dataset.acctDel, prev = Store.get(), name = acctName(id);
    const moved = prev.items.filter(i => i.account === id && i.type !== "Transfer").length, dropped = prev.items.filter(i => i.type === "Transfer" && (i.account === id || i.to === id)).length;
    Store.update(s => {
      s.accounts = E.accountsOf(s).filter(a => a.id !== id);
      s.items = s.items.filter(i => !(i.type === "Transfer" && (i.account === id || i.to === id))).map(i => i.account === id ? Object.assign({}, i, { account: "main" }) : i);
      if (s.income.depositTo === id) s.income.depositTo = "main";
    });
    renderAcctEditor();
    toast({ kind: "deleted", title: "Removed " + name, detail: [moved ? moved + " item" + (moved === 1 ? "" : "s") + " moved to " + acctName("main") : "", dropped ? dropped + " transfer" + (dropped === 1 ? "" : "s") + " removed" : ""].filter(Boolean).join(" · ") || "It had no bills or transfers.",
      action: { label: "Undo", run: () => { Store.replace(prev); fillForms(); } } });
  });
  $("f-depositTo").addEventListener("change", e => Store.update(s => { s.income.depositTo = e.target.value; }));

  /* ---------- views (hash routing) ---------- */
  const VIEWS = { dashboard: "Dashboard", cashflow: "Cash flow", calendar: "Projection Calendar", bills: "Bills & income", paycheck: "Paycheck", savings: "Savings & investments" };
  /* charts that measure their width only render while their view is showing */
  function renderSized() {
    if (V.view === "dashboard") { renderBalance(); renderPace(); renderGrowthDash(); }
    if (V.view === "savings") renderGrowthPage();
    if (V.view === "cashflow") { renderCashflow(); renderMonthly(); }
  }
  function renderEyebrow() {
    const now = new Date(), h = now.getHours(), st = Store.get();
    const ey = {
      dashboard: (h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening") + " · " + DOW[now.getDay()] + ", " + MON[now.getMonth()] + " " + now.getDate(),
      cashflow: "Money in and out, month by month",
      calendar: "Day by day",
      bills: st.items.length + (st.items.length === 1 ? " item" : " items"),
      paycheck: "Take-home pay",
      savings: "Growing your money"
    };
    $("pageEyebrow").textContent = ey[V.view];
  }
  function route(first) {
    const v = location.hash.slice(1);
    V.view = VIEWS[v] ? v : "dashboard";
    document.querySelectorAll(".view").forEach(el => { el.hidden = el.dataset.view !== V.view; });
    document.querySelectorAll(".nav-item[data-view], .tab-item").forEach(a => { const on = a.dataset.view === V.view; a.classList.toggle("active", on); if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
    $("pageTitle").textContent = VIEWS[V.view];
    document.title = (V.view === "dashboard" ? "" : VIEWS[V.view] + " · ") + "Finance Toolbox";
    if (V.proj) { renderSized(); renderEyebrow(); }
    if (!first) { scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" }); $("pageTitle").focus({ preventScroll: true }); }
  }
  addEventListener("hashchange", () => route(false));
  $("rangePills").addEventListener("click", e => { const b = e.target.closest("button[data-range]"); if (!b) return; V.range = +b.dataset.range; saveUi(); renderBalance(); });
  $("donutPills").addEventListener("click", e => { const b = e.target.closest("button[data-donut]"); if (!b) return; V.donut = b.dataset.donut; renderDonut(); });
  $("sumPills").addEventListener("click", e => { const b = e.target.closest("button[data-sum]"); if (!b) return; V.sum = b.dataset.sum; saveUi(); renderBillSummary(); });
  $("cfPrev").addEventListener("click", () => { if (V.cfIdx > 0) { V.cfIdx--; renderCashflow(); } });
  $("cfNext").addEventListener("click", () => { if (V.cfIdx < V.months.length - 1) { V.cfIdx++; renderCashflow(); } });

  /* ---------- light and dark theme ---------- */
  function applyTheme(t) {
    const light = t === "light";
    if (light) document.documentElement.dataset.theme = "light"; else document.documentElement.dataset.theme = "dark";
    $("themeText").textContent = light ? "Dark mode" : "Light mode";
    $("mThemeText").textContent = light ? "Dark mode" : "Light mode";
    $("themeColor").setAttribute("content", light ? "#f4f5f8" : "#0b0d12");
  }
  applyTheme(document.documentElement.dataset.theme);
  $("mTheme").addEventListener("click", () => $("themeBtn").click());
  $("themeBtn").addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
    try { localStorage.setItem("ft.theme", next); } catch (e) {}
    applyTheme(next);
  });

  /* ---------- settings drawer ---------- */
  const drawer = $("drawer");
  function openDrawer(tab) {
    fillForms(); showTab(tab || "pay");
    if (!drawer.open) drawer.showModal();
    renderItemList(); renderPreviews(); renderSync(); fillTaxForm(); renderDedList(); renderTaxPreview();
  }
  function showTab(name) {
    drawer.querySelectorAll("[role=tab]").forEach(b => b.setAttribute("aria-selected", String(b.dataset.tab === name)));
    drawer.querySelectorAll("[data-panel]").forEach(p => p.hidden = p.dataset.panel !== name);
    if (name === "sync") renderSync();
  }
  drawer.querySelectorAll("[role=tab]").forEach(b => b.addEventListener("click", () => showTab(b.dataset.tab)));
  document.querySelectorAll("dialog").forEach(d => {
    d.addEventListener("click", e => { if (e.target === d) d.close(); if (e.target.closest("[data-close]")) d.close(); });
  });

  const payFields = { "f-amount": "amount", "f-per": "per", "f-hours": "hoursPerWeek", "f-days": "daysPerWeek", "f-hol": "paidHolidays", "f-pto": "paidPto", "f-unpaid": "unpaidDays", "f-ota": "overtimeAfter", "f-otm": "overtimeMultiplier", "f-freq": "payFrequency", "f-known": "knownPayday", "f-year": "year" };
  const projFields = { "f-start": "startDate", "f-bal": "startingBalance", "f-months": "months" };
  function fillForms() {
    const st = Store.get();
    for (const [id, k] of Object.entries(payFields)) $(id).value = st.income[k];
    $("f-otm").value = String(st.income.overtimeMultiplier);
    if (![...$("f-otm").options].some(o => o.value === String(st.income.overtimeMultiplier))) $("f-otm").insertAdjacentHTML("beforeend", '<option value="' + st.income.overtimeMultiplier + '">' + st.income.overtimeMultiplier + 'x</option>'), $("f-otm").value = String(st.income.overtimeMultiplier);
    $(st.income.payType === "Salaried" ? "f-salaried" : "f-hourly").checked = true;
    for (const [id, k] of Object.entries(projFields)) $(id).value = st.projection[k];
    $(st.income.payMode === "deposit" ? "f-modeDep" : "f-modeCalc").checked = true;
    $("f-deposit").value = st.income.depositAmount || "";
    payTypeUi(); payModeUi(); renderAcctEditor();
  }
  function payModeUi() {
    const st = Store.get(), dep = $("f-modeDep").checked;
    $("tab-pay").classList.toggle("deposit-mode", dep);
    $("depWrap").hidden = !dep;
    $("payModeHelp").textContent = dep
      ? "Each payday adds exactly this amount, which is already after taxes and deductions." +
        (V.proj && V.proj.income.paycheck < st.income.depositAmount ? " Your pay details below work out to " + fmt(V.proj.income.paycheck) + " gross, which is less than your deposit. Update them if you want the yearly and tax figures to be right; your projection isn't affected." : "") + (st.income.paysFrom ? " Paychecks are counted from " + niceDate(st.income.paysFrom, false, true) + " on, because earlier deposits came from your imported statement." : "")
      : "Each paycheck is figured from your pay below" + (st.deductions.enabled ? ", minus the taxes and deductions in Take-home." : ". Turn on Take-home to subtract taxes and deductions.");
  }
  function payTypeUi() {
    const sal = $("f-salaried").checked;
    $("otSet").hidden = sal;
    $("payTypeHelp").textContent = sal ? "Salaried: your yearly pay stays the same. Paid time off doesn't lower it; unpaid days do." : "Hourly: you're paid for the hours you work, plus paid holidays and PTO. Overtime counts at the overtime rate.";
  }
  let editTimer;
  function bindLive(form, apply) {
    form.addEventListener("input", e => {
      const el = e.target; if (!el.name) return;
      if (el.type !== "radio" && !el.checkValidity()) { el.setAttribute("aria-invalid", "true"); return; }
      el.removeAttribute("aria-invalid");
      if (el.name === "payType") payTypeUi();
      if (el.name === "payMode") { payModeUi(); if (el.value === "deposit" && !(Store.get().income.depositAmount > 0)) { $("f-deposit").focus(); return; } }
      clearTimeout(editTimer); editTimer = setTimeout(() => apply(el), 250);
    });
    form.addEventListener("submit", e => e.preventDefault());
  }
  bindLive($("tab-pay"), el => {
    if (el.value === "" && el.type !== "date") return;
    const val = ["per", "payFrequency", "knownPayday", "payType", "payMode"].includes(el.name) ? el.value : Number(el.value);
    if (el.name === "knownPayday" && !el.value) return;
    Store.update(s => { s.income[el.name] = val; if (el.name === "depositAmount" && $("f-modeDep").checked) s.income.payMode = "deposit"; });
  });
  bindLive($("tab-proj"), el => {
    if (!el.value) return;
    Store.update(s => { s.projection[el.name] = el.name === "startDate" ? el.value : Number(el.value); });
  });
  let lastPreview = {};
  function renderPreviews() {
    const inc = V.proj.income, pr = V.proj;
    const set = (host, pairs) => {
      host.innerHTML = pairs.map(([k, l, v]) => '<div><small>' + l + '</small><b class="num' + (lastPreview[k] !== undefined && lastPreview[k] !== v ? " flash" : "") + '">' + v + '</b></div>').join("");
      pairs.forEach(([k, , v]) => lastPreview[k] = v);
      setTimeout(() => host.querySelectorAll(".flash").forEach(b => b.classList.remove("flash")), 600);
    };
    const si = Store.get().income;
    if (pr.depositMode) set($("payPreview"), [["pc", "Deposit per paycheck", fmt(si.depositAmount)], ["ag", "Deposits per year", fmt(si.depositAmount * inc.paychecksThisYear, { cents: false })], ["ph", "Gross per paycheck", fmt(inc.paycheck)], ["n", "Paychecks in " + si.year, String(inc.paychecksThisYear)]]);
    else set($("payPreview"), [["pc", "Per paycheck", fmt(inc.paycheck)], ["ag", "Per year", fmt(inc.annualGross, { cents: false })], ["ph", "Per hour worked", fmt(inc.perHourWorked)], ["n", "Paychecks in " + si.year, String(inc.paychecksThisYear)]]);
    set($("projPreview"), [["end", "Ends on", niceDate(pr.endDate, false, true)], ["eb", "Ending balance", fmt(pr.ending, { cents: false })], ["lo", "Lowest balance", fmt(pr.low.balance, { cents: false })], ["lod", "Lowest on", niceDate(pr.low.iso)]]);
  }
  function renderItemList() {
    const its = Store.get().items;
    $("itemList").innerHTML = its.length ? its.slice().sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name)).map(i =>
      '<button type="button" class="item-row" data-edit="' + esc(i.id) + '"><span class="sw" style="background:var(--' + (i.type === "Bill" ? "bills" : "income") + ')"></span><span class="nm" style="min-width:0"><b>' + esc(i.name) + '</b><br><span class="sm hint">' + esc(i.frequency) + ' · ' + (i.frequency === "One-time" ? "on " : "from ") + esc(niceDate(i.first, false, true)) + (i.end ? " to " + esc(niceDate(i.end, false, true)) : "") + '</span></span><span class="num ' + (i.type === "Bill" ? "bill-t" : "inc-t") + '" style="font-weight:600">' + fmt(i.type === "Bill" ? -i.amount : i.amount, { sign: true }) + '</span></button>').join("")
      : '<div class="empty">Nothing here yet. Add rent, phone, subscriptions, or extra income like a side gig.</div>';
  }

  /* ---------- bill / income editor ---------- */
  const dlg = $("itemDialog"), form = $("itemForm");
  let editingId = null;
  function openItem(id, presetDate, preset) {
    const it = id ? Store.get().items.find(x => x.id === id) : null;
    editingId = it ? it.id : null;
    $("itemTitle").textContent = it ? "Edit " + it.name : "Add bill or income";
    $(it && it.type === "Income" ? "i-inc" : it && it.type === "Transfer" ? "i-xfer" : "i-bill").checked = true;
    acctOptions(it ? it.account : (V.acct !== "all" ? V.acct : "main"), it && it.to);
    $("i-name").value = it ? it.name : "";
    catOptions(it && it.category ? it.category : "");
    $("i-amount").value = it ? it.amount : "";
    $("i-freq").value = it ? it.frequency : (presetDate ? "One-time" : "Monthly");
    $("i-first").value = it ? it.first : (presetDate || todayIso());
    $("i-end").value = it ? it.end : "";
    $("i-delete").hidden = !it; $("i-err").textContent = "";
    if (preset) { if (preset.name) $("i-name").value = preset.name; if (preset.frequency) $("i-freq").value = preset.frequency; catOptions(preset.category || ""); }
    freqUi();
    dlg.showModal();
    setTimeout(() => $(it ? "i-amount" : "i-name").focus(), 30);
  }
  function freqUi() {
    const f = $("i-freq").value, one = f === "One-time";
    $("i-endWrap").hidden = one;
    $("i-firstLab").textContent = one ? "Date" : "First date";
    const d = $("i-first").value;
    const p = d ? P(d) : null;
    $("i-help").textContent = !p ? "" : one ? "Happens once on " + niceDate(d, true, true) + "." :
      f === "Weekly" ? "Every " + DOW[p.dow] + ", starting " + niceDate(d) + "." :
      f === "Bi-Weekly" ? "Every other " + DOW[p.dow] + ", starting " + niceDate(d) + "." :
      f === "Monthly" ? "On day " + p.d + " of each month" + (p.d > 28 ? " (or the last day in shorter months)" : "") + "." :
      "Every year on " + MON[p.m] + " " + p.d + ".";
  }
  /* category picker: Automatic shows what the app would choose from the name */
  function catOptions(keep) {
    const inc = $("i-inc").checked, list = inc ? E.INCOME_CATEGORIES : E.CATEGORIES, cur = keep != null ? keep : $("i-cat").value;
    const auto = E.categoryOf({ name: $("i-name").value, type: inc ? "Income" : "Bill" });
    $("i-cat").innerHTML = '<option value="">Automatic (' + esc(auto) + ')</option>' + list.map(c => '<option>' + esc(c) + '</option>').join("");
    $("i-cat").value = list.includes(cur) ? cur : "";
  }
  $("i-bill").addEventListener("change", () => { catOptions(); xferUi(); }); $("i-inc").addEventListener("change", () => { catOptions(); xferUi(); }); $("i-xfer").addEventListener("change", () => xferUi());
  /* account pickers: shown only with more than one checking account */
  function acctOptions(from, to) {
    const list = accts(), opt = (sel) => list.map(a => '<option value="' + esc(a.id) + '"' + (a.id === sel ? " selected" : "") + '>' + esc(a.name) + '</option>').join("");
    const f = list.some(a => a.id === from) ? from : "main";
    $("i-acct").innerHTML = opt(f);
    $("i-to").innerHTML = opt(list.some(a => a.id === to) && to !== f ? to : (list.find(a => a.id !== f) || {}).id);
    $("i-xferWrap").hidden = list.length < 2; if (list.length < 2 && $("i-xfer").checked) $("i-bill").checked = true;
    xferUi();
  }
  function xferUi() {
    const x = $("i-xfer").checked;
    $("i-acctRow").hidden = !multi(); $("i-toWrap").hidden = !x; $("i-catWrap").hidden = x;
    $("i-acctLab").textContent = x ? "From account" : "Account";
    $("i-name").placeholder = x ? "Move to bills account" : "Rent, phone, side gig";
    if (!$("itemTitle").textContent.startsWith("Edit")) $("itemTitle").textContent = x ? "Add a transfer" : "Add bill or income";
  }
  $("i-name").addEventListener("input", () => { const o = $("i-cat").options[0]; if (o) o.textContent = "Automatic (" + E.categoryOf({ name: $("i-name").value, type: $("i-inc").checked ? "Income" : "Bill" }) + ")"; });
  $("i-freq").addEventListener("change", freqUi); $("i-first").addEventListener("input", freqUi);
  form.addEventListener("submit", e => {
    e.preventDefault();
    const name = $("i-name").value.trim(), amount = Number($("i-amount").value), first = $("i-first").value, end = $("i-freq").value === "One-time" ? "" : $("i-end").value;
    if (!name) return showErr("Give it a name, like Rent or Phone.", "i-name");
    if (!(amount > 0)) return showErr("Enter an amount greater than $0.", "i-amount");
    if (!first) return showErr("Pick a date.", "i-first");
    if (end && end < first) return showErr("The end date is before the first date.", "i-end");
    const xfer = $("i-xfer").checked && multi();
    if (xfer && $("i-acct").value === $("i-to").value) return showErr("Choose two different accounts for a transfer.", "i-to");
    const item = { id: editingId || Store.uid(), name, type: xfer ? "Transfer" : $("i-inc").checked ? "Income" : "Bill", amount, frequency: $("i-freq").value, first, end, account: multi() ? $("i-acct").value : "main" };
    if (xfer) item.to = $("i-to").value;
    else if ($("i-cat").value) item.category = $("i-cat").value;
    const wasEdit = !!editingId, before = V.proj.ending;
    Store.update(s => { const i = s.items.findIndex(x => x.id === item.id); if (i >= 0) s.items[i] = item; else s.items.push(item); });
    dlg.close();
    toast({ kind: wasEdit ? "saved" : "added", tone: item.type === "Bill" ? "bill" : item.type === "Transfer" ? "accent" : "income", title: (wasEdit ? "Saved " : "Added ") + name, detail: itemDetail(item), impact: impactLine(before, V.proj.ending) });
  });
  function showErr(msg, id) { $("i-err").textContent = msg; $(id).setAttribute("aria-invalid", "true"); $(id).focus(); $(id).addEventListener("input", () => { $(id).removeAttribute("aria-invalid"); $("i-err").textContent = ""; }, { once: true }); }
  $("i-delete").addEventListener("click", () => {
    const st = Store.get(), idx = st.items.findIndex(x => x.id === editingId); if (idx < 0) return;
    const removed = st.items[idx], before = V.proj.ending;
    Store.update(s => { s.items = s.items.filter(x => x.id !== removed.id); });
    dlg.close();
    toast({ kind: "deleted", title: "Deleted " + removed.name, detail: "Was " + fmt(removed.type === "Bill" ? -removed.amount : removed.amount, { sign: true }) + " " + FREQ_WORD[removed.frequency],
      impact: impactLine(before, V.proj.ending),
      action: { label: "Undo", run: () => { Store.update(s => { s.items.splice(Math.min(idx, s.items.length), 0, removed); }); toast({ kind: "saved", title: "Restored " + removed.name, detail: itemDetail(removed) }); } } });
  });


  /* ---------- take-home pay: taxes, benefits and retirement ---------- */
  const TAX = window.FTTax;
  const STATE_CODES = Object.keys(TAX.STATES).sort((a, b) => TAX.STATES[a].name.localeCompare(TAX.STATES[b].name));
  $("t-state").insertAdjacentHTML("beforeend", STATE_CODES.map(c => '<option value="' + c + '">' + esc(TAX.STATES[c].name) + (TAX.STATES[c].single ? "" : " (no income tax)") + '</option>').join(""));
  const PRESETS = [
    ["401(k)", "%", 5, "pretax"], ["Roth 401(k)", "%", 5, "posttax"], ["Health insurance", "$", 0, "pretax-all"], ["Dental", "$", 0, "pretax-all"],
    ["Vision", "$", 0, "pretax-all"], ["HSA", "$", 0, "pretax-all"], ["FSA", "$", 0, "pretax-all"], ["403(b)", "%", 5, "pretax"],
    ["Life insurance", "$", 0, "posttax"], ["Union dues", "$", 0, "posttax"], ["Other", "$", 0, "posttax"]
  ];
  $("dedPresets").innerHTML = PRESETS.map((p, i) => '<button type="button" class="chip-btn" data-preset="' + i + '">+ ' + esc(p[0]) + '</button>').join("");
  const TREAT_LABEL = { "pretax": "Before taxes", "pretax-all": "Before all taxes", "posttax": "After taxes" };
  const getPath = (o, k) => k.split(".").reduce((a, x) => a && a[x], o);
  const setPath = (o, k, v) => { const ks = k.split("."), last = ks.pop(); ks.reduce((a, x) => a[x], o)[last] = v; };

  function fillTaxForm() {
    const d = Store.get().deductions;
    $("tab-tax").querySelectorAll("[data-k]").forEach(el => { const v = getPath(d, el.dataset.k); if (el.type === "checkbox") el.checked = !!v; else el.value = v === 0 && el.type === "number" && /extra|credits|localPercent/.test(el.dataset.k) ? "" : v; });
    taxUi();
  }
  function taxUi() {
    const d = Store.get().deductions;
    $("taxBody").classList.toggle("off", !d.enabled);
    const unit = (mode, wrap, u) => { $(wrap).classList.toggle("nv", !(mode === "percent" || mode === "amount")); $(u).classList.toggle("pct", mode === "percent"); };
    unit(d.federal.mode, "t-fedValWrap", "t-fedUnit"); unit(d.state.mode, "t-stateValWrap", "t-stateUnit");
    $("t-fedMore").hidden = d.federal.mode === "off";
    const S = TAX.STATES[d.state.code];
    $("t-stateHint").textContent = !d.state.code ? "Choose your state above" : !S.single ? S.name + " has no income tax on wages" : S.name + ", 2026 rates";
    $("t-stateNote").textContent = S && S.note ? S.note : "";
  }
  function renderDedList() {
    const items = Store.get().deductions.items;
    $("dedList").innerHTML = items.length ? items.map(it =>
      '<div class="ded-row" data-id="' + esc(it.id) + '">' +
      '<input data-f="name" value="' + esc(it.name) + '" maxlength="40" aria-label="Deduction name">' +
      '<span class="amt-pair"><input data-f="value" type="number" min="0" step="0.01" inputmode="decimal" value="' + (it.value || "") + '" placeholder="0" aria-label="Amount"><select data-f="unit" aria-label="Dollars or percent"><option value="$"' + (it.unit === "$" ? " selected" : "") + '>$</option><option value="%"' + (it.unit === "%" ? " selected" : "") + '>%</option></select></span>' +
      '<select class="ded-treat" data-f="treatment" aria-label="When it comes out">' + E.TREATMENTS.map(t => '<option value="' + t + '"' + (it.treatment === t ? " selected" : "") + '>' + TREAT_LABEL[t] + '</option>').join("") + '</select>' +
      '<button type="button" class="icon-btn" data-del="' + esc(it.id) + '" aria-label="Remove ' + esc(it.name) + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button>' +
      '<span class="ded-amt num" data-out="' + esc(it.id) + '"></span></div>').join("")
      : '<div class="empty">No benefits or retirement yet. Tap one below to add it.</div>';
    renderTaxPreview();
  }
  function renderTaxPreview() {
    const st = Store.get(), d = st.deductions;
    const inc = E.computeIncome(st.income), periods = E.PERIODS_PER_YEAR[st.income.payFrequency] || 26;
    const b = E.computePaycheck(d, inc.paycheck, periods);
    const set = (id, v) => { const el = $(id); if (!el) return; el.textContent = v > 0.004 ? "-" + fmt(v) : "$0.00"; el.classList.toggle("zero", !(v > 0.004)); };
    set("o-federal", b.federal); set("o-socialSecurity", b.socialSecurity); set("o-medicare", b.medicare); set("o-state", b.state); set("o-local", b.local);
    [...b.pretax, ...b.posttax].forEach(r => { const el = document.querySelector('[data-out="' + CSS.escape(r.id) + '"]'); if (el) el.textContent = "-" + fmt(r.amount) + " per paycheck · " + (r.treatment === "posttax" ? "taken after taxes" : r.treatment === "pretax" ? "lowers income tax" : "lowers all taxes"); });
    const pairs = [["tg", "Gross per paycheck", fmt(b.gross)], ["tt", "Taxes", "-" + fmt(b.taxes)], ["td", "Benefits & retirement", "-" + fmt(b.deductions)], ["tn", "Take-home", fmt(b.net)]];
    $("taxPreview").innerHTML = pairs.map(([k, l, v]) => '<div><small>' + l + '</small><b class="num' + (lastPreview[k] !== undefined && lastPreview[k] !== v ? " flash" : "") + '"' + (k === "tn" ? ' style="color:var(--c-net)"' : "") + '>' + v + '</b></div>').join("");
    pairs.forEach(([k, , v]) => lastPreview[k] = v);
    setTimeout(() => $("taxPreview").querySelectorAll(".flash").forEach(x => x.classList.remove("flash")), 600);
  }
  let taxTimer;
  $("tab-tax").addEventListener("input", e => {
    const el = e.target;
    if (el.dataset.k) {
      const k = el.dataset.k; let v = el.type === "checkbox" ? el.checked : el.type === "number" ? (el.value === "" ? 0 : Number(el.value)) : el.value;
      if (el.type === "number" && el.value !== "" && !el.checkValidity()) { el.setAttribute("aria-invalid", "true"); return; }
      el.removeAttribute("aria-invalid");
      const instant = el.type === "checkbox" || el.tagName === "SELECT";
      clearTimeout(taxTimer);
      const apply = () => { Store.update(s => setPath(s.deductions, k, v)); taxUi(); if (k === "enabled") toast(v ? { kind: "saved", title: "Showing take-home pay", detail: "Your calendar and balance now use pay after taxes and deductions." } : { kind: "info", title: "Showing gross pay", detail: "Taxes and deductions are no longer subtracted." }); };
      instant ? apply() : (taxTimer = setTimeout(apply, 250));
      return;
    }
    const row = el.closest(".ded-row"); if (!row || !el.dataset.f) return;
    const id = row.dataset.id, f = el.dataset.f, val = f === "value" ? (el.value === "" ? 0 : Number(el.value)) : el.value;
    if (f === "value" && el.value !== "" && !(Number(el.value) >= 0)) return;
    if (f === "name" && !String(val).trim()) return;
    clearTimeout(taxTimer);
    taxTimer = setTimeout(() => Store.update(s => { const it = s.deductions.items.find(x => x.id === id); if (it) it[f] = val; }), el.tagName === "SELECT" ? 0 : 250);
  });
  $("tab-tax").addEventListener("submit", e => e.preventDefault());
  $("tab-tax").addEventListener("click", e => {
    const pre = e.target.closest("[data-preset]");
    if (pre) {
      const [name, unit, value, treatment] = PRESETS[+pre.dataset.preset], id = Store.uid();
      Store.update(s => { s.deductions.items.push({ id, name, unit, value, treatment }); if (!s.deductions.enabled) s.deductions.enabled = true; });
      fillTaxForm(); renderDedList();
      const inp = document.querySelector('.ded-row[data-id="' + CSS.escape(id) + '"] [data-f="value"]'); if (inp) { inp.focus(); inp.select(); }
      return;
    }
    const del = e.target.closest("[data-del]");
    if (del) {
      const st = Store.get(), idx = st.deductions.items.findIndex(x => x.id === del.dataset.del), removed = st.deductions.items[idx], before = V.proj.ending;
      Store.update(s => { s.deductions.items.splice(idx, 1); }); renderDedList();
      toast({ kind: "deleted", title: "Removed " + removed.name, detail: "No longer taken out of your paycheck.", impact: impactLine(before, V.proj.ending),
        action: { label: "Undo", run: () => { Store.update(s => { s.deductions.items.splice(idx, 0, removed); }); renderDedList(); } } });
    }
  });

  /* dashboard card: where each paycheck goes */
  function renderBreakdown() {
    const st = Store.get(), d = st.deductions, host = $("breakdown");
    if (V.proj.depositMode) {
      const g = V.proj.income.paycheck, dep = st.income.depositAmount, gap = g - dep;
      host.innerHTML = '<div class="bk-head"><span class="bk-net num">' + fmt(dep) + '</span><span class="bk-of">deposited each payday, from your bank statement</span></div>' +
        '<p class="help" style="margin-top:8px">Your projection uses the amount that actually reaches your account, so taxes, benefits and retirement are already taken out.' +
        (gap > 1 ? ' Compared with the ' + fmt(g) + ' gross figured from your pay settings, about ' + fmt(gap) + ' (' + (gap / g * 100).toFixed(1) + '%) goes to taxes and deductions each paycheck.' : '') + '</p>' +
        '<div class="row-btns" style="margin-top:10px"><button class="btn sm" type="button" id="bkDep">Change deposit amount</button><button class="btn sm ghost" type="button" id="bkCalc">Figure it from my pay instead</button></div>';
      $("bkDep").onclick = () => openDrawer("pay");
      $("bkCalc").onclick = () => { Store.update(s => { s.income.payMode = "calc"; }); toast({ kind: "info", title: "Paychecks figured from your pay", detail: "Change it back any time in Settings, Pay." }); };
      return;
    }
    if (!d.enabled) {
      host.innerHTML = '<div class="bk-cta"><p>See what actually lands in your account. Add federal and state taxes, Social Security, Medicare, and benefits like health insurance or a 401(k).</p><button class="btn primary sm" type="button" id="bkSetup">Set up take-home pay</button></div>';
      $("bkSetup").onclick = () => { Store.update(s => { s.deductions.enabled = true; }); openDrawer("tax"); };
      return;
    }
    const y = E.computeYearPaychecks(st, st.income.year), b = y.typical, g = b.gross || 1;
    const pct = v => (v / g * 100).toFixed(1) + "%";
    const S = TAX.STATES[d.state.code];
    const taxRows = [["Federal income tax", b.federal], ["Social Security", b.socialSecurity], ["Medicare", b.medicare], [(S ? S.name : "State") + " income tax", b.state], ["Local tax", b.local]].filter(r => r[1] > 0.004);
    const dedRows = [...b.pretax, ...b.posttax].map(r => [r.name, r.amount]).filter(r => r[1] > 0.004);
    const row = (l, v, cls, p) => '<div class="bk-row ' + (cls || "") + '"><span>' + esc(l) + '</span><span class="num">' + fmt(v) + '</span><span class="pct num">' + (p || pct(Math.abs(v))) + '</span></div>';
    const seg = (v, c, n) => v > 0.004 ? '<span style="width:' + (v / g * 100) + '%;background:var(' + c + ');animation-delay:' + n * 0.12 + 's" title="' + fmt(v) + '"></span>' : "";
    let note = "";
    if (d.state.mode === "auto" && !d.state.code) note = "Choose your state in Take-home settings to include state income tax.";
    else if (y.ssCapDate) note = "You pass the $184,500 Social Security limit on " + niceDate(y.ssCapDate) + ". Paychecks after that are about " + fmt(b.socialSecurity, { cents: false }) + " bigger until January.";
    host.innerHTML =
      '<div class="bk-head"><span class="bk-net num">' + fmt(b.net) + '</span><span class="bk-of">take-home of ' + fmt(b.gross) + ' gross, per paycheck (' + pct(b.net) + ')</span></div>' +
      '<div class="segbar" role="img" aria-label="Take-home ' + pct(b.net) + ', taxes ' + pct(b.taxes) + ', benefits and retirement ' + pct(b.deductions) + '">' + seg(b.net, "--c-net", 0) + seg(b.taxes, "--c-tax", 1) + seg(b.deductions, "--c-ded", 2) + '</div>' +
      '<div class="seglegend"><span><i style="background:var(--c-net)"></i>Take-home ' + pct(b.net) + '</span><span><i style="background:var(--c-tax)"></i>Taxes ' + pct(b.taxes) + '</span><span><i style="background:var(--c-ded)"></i>Benefits &amp; retirement ' + pct(b.deductions) + '</span></div>' +
      (taxRows.length ? '<div class="bk-group"><div class="sect-lab">Taxes · ' + fmt(b.taxes) + '</div>' + taxRows.map(r => row(r[0], r[1])).join("") + '</div>' : "") +
      (dedRows.length ? '<div class="bk-group"><div class="sect-lab">Benefits and retirement · ' + fmt(b.deductions) + '</div>' + dedRows.map(r => row(r[0], r[1])).join("") + '</div>' : "") +
      '<div class="bk-group">' + row("Take-home in " + st.income.year, y.net, "total", (y.gross ? (y.net / y.gross * 100).toFixed(1) : "0") + "%") + '<div class="bk-row"><span class="hint">' + y.checks.length + ' paychecks · ' + fmt(y.taxes, { cents: false }) + ' taxes · ' + fmt(y.deductions, { cents: false }) + ' benefits and retirement</span><span></span><span></span></div></div>' +
      (note ? '<div class="bk-note">' + esc(note) + '</div>' : "");
  }


  /* ---------- import a bank statement ---------- */
  const Imp = window.FTImport;
  const IMP = { accounts: [], acct: null, rows: [], start: "end", touched: new Set(), errors: [], rowsBy: {}, touchedBy: {}, map: {} };
  const isMultiImp = () => IMP.accounts.length > 1;
  const stmtName = a => String(a.label || "Checking").replace(/\s*••\d+$/, "").slice(0, 30) || "Checking";
  const hasPayroll = a => a.transactions.some(t => /payroll|direct dep|dir dep|salary/i.test((t.type || "") + " " + (t.raw || "")));
  /* which app account each statement account goes into: same account number first, then Main, then a new account (3 max) */
  function impMap() {
    const st = Store.get(), list = E.accountsOf(st), map = {}, taken = new Set();
    let free = E.MAX_ACCOUNTS - list.length;
    const order = IMP.accounts.slice().sort((a, b) => (/sav/i.test(a.label) - /sav/i.test(b.label)) || (hasPayroll(b) - hasPayroll(a)));
    for (const a of order) {
      const sav = /sav/i.test(a.label);
      let target = (list.find(x => x.number && x.number === a.number && !taken.has(x.id)) || {}).id;
      /* an account you made by hand with a similar name, like "Bills checking" for "Bills Checking ••5390" */
      const word = n => String(n || "").toLowerCase().replace(/checking|account|acct|••\d+|[^a-z ]/g, " ").trim().split(/\s+/)[0] || "";
      if (!target) target = (list.find(x => x.id !== "main" && !x.number && !taken.has(x.id) && word(x.name) && word(x.name) === word(a.label)) || {}).id;
      if (!target && !sav && !list[0].number && !taken.has("main")) target = "main";
      if (!target && free > 0) { target = "new"; free--; }
      map[a.id] = { use: !!target && !sav, target: target || "", sav, full: !target };
      if (target && target !== "new") taken.add(target);
    }
    return map;
  }
  const impDlg = $("importDialog");
  const IMP_GROUPS = [
    ["pay", "Paychecks", "Deposits from your employer. Use them to line up your paydays in the app."],
    ["repeat", "Repeating bills and income", "Found more than once on a regular schedule. Bills are added one time on their dates; choose how often to keep them going forward."],
    ["likely", "Probably monthly bills", "Seen once, but they look like bills or subscriptions. Added one time; pick Every month to keep them going forward."],
    ["pattern", "Everyday spending", "Places you spend often. Added one time on each date; pick Every week to project a weekly average instead."],
    ["transfer", "Transfers", "Money moved between your own accounts. Not added unless you choose."],
    ["other", "Everything else", ""]
  ];
  const ACTIONS = [["skip", "Don't add"], ["One-time", "One time"], ["Weekly", "Every week"], ["Bi-Weekly", "Every 2 weeks"], ["Monthly", "Every month"], ["Yearly", "Every year"]];
  const PAYFREQ_TXT = { "Week": "every week", "Bi-Week": "every 2 weeks", "Semi-Month": "twice a month", "Month": "once a month" };
  function impView(v) { $("impPick").hidden = v !== "pick"; $("impBusy").hidden = v !== "busy"; $("impReview").hidden = v !== "review"; $("impFoot").hidden = v !== "review"; }
  function openImport(files) {
    $("impErr").textContent = ""; impView("pick");
    if (!impDlg.open) impDlg.showModal();
    if (files && files.length) impHandle(files);
  }
  async function impHandle(files) {
    impView("busy"); $("impBusyText").textContent = "Reading " + (files.length > 1 ? files.length + " statements" : "“" + files[0].name + "”");
    try {
      const res = await Imp.readFiles([...files]);
      IMP.errors = res.errors;
      const accts = res.accounts.filter(a => a.transactions.length);
      if (!accts.length) throw new Error(res.errors[0] || "No transactions were found. If this is a PDF, try downloading a CSV or OFX file from your bank instead.");
      IMP.accounts = accts; IMP.rowsBy = {}; IMP.touchedBy = {}; IMP.start = null;
      IMP.map = accts.length > 1 ? impMap() : {};
      impPickAccount((accts.find(hasPayroll) || accts.reduce((b, a) => a.transactions.length > b.transactions.length ? a : b, accts[0])).id);
      impView("review");
      if (res.errors.length) toast({ kind: "error", title: "Some files couldn't be read", detail: res.errors.join(" ") });
    } catch (e) { impView("pick"); $("impErr").textContent = e.message; }
  }
  function impPickAccount(id) {
    IMP.acct = IMP.accounts.find(a => a.id === id);
    /* bills come in as one-time items on their real dates, so replay the statement when we can */
    if (!IMP.start || !isMultiImp()) IMP.start = IMP.acct.beginBalance != null ? "replay" : IMP.acct.endBalance != null ? "end" : "keep";
    IMP.touched = IMP.touchedBy[id] = IMP.touchedBy[id] || new Set();
    if (!IMP.rowsBy[id]) { IMP.rowsBy[id] = Imp.analyze(IMP.acct).rows; IMP.rows = IMP.rowsBy[id]; impDefaults(); }
    IMP.rows = IMP.rowsBy[id];
    impRender();
  }
  /* the review rows for a statement account, with default choices, without showing it */
  function impRowsFor(a) {
    if (!IMP.rowsBy[a.id]) { const keep = [IMP.rows, IMP.touched]; IMP.rows = IMP.rowsBy[a.id] = Imp.analyze(a).rows; IMP.touched = IMP.touchedBy[a.id] = new Set(); impDefaults(); [IMP.rows, IMP.touched] = keep; }
    return IMP.rowsBy[a.id];
  }
  function impDefaults() {
    IMP.rows.forEach(r => { if (IMP.touched.has(r.id) || r.group === "pay") return;
      if (r.misc) { r.action = "skip"; return; } /* the weekly average would double count the one-time bills */
      if (r.group === "transfer") { r.action = IMP.start === "replay" ? "One-time" : "skip"; return; }
      if (r.type === "Bill") { r.action = "One-time"; return; }
      if (r.group === "other") r.action = IMP.start === "replay" ? "One-time" : "skip"; });
  }
  const shortD = d => niceDate(d);
  function impAcctList() {
    if (!isMultiImp()) return "";
    const list = E.accountsOf(Store.get()), newNeeded = id => Object.entries(IMP.map).filter(([k, m]) => m.use && m.target === "new" && k !== id).length;
    const rows = IMP.accounts.map(a => {
      const m = IMP.map[a.id], room = E.MAX_ACCOUNTS - list.length - newNeeded(a.id) > 0;
      const opts = list.map(x => '<option value="' + esc(x.id) + '"' + (m.target === x.id ? " selected" : "") + '>' + esc(x.name) + '</option>').join("") + (room || m.target === "new" ? '<option value="new"' + (m.target === "new" ? " selected" : "") + '>New account: ' + esc(stmtName(a)) + '</option>' : "");
      const ok = a.balanced === true ? '<span class="ia-ok">&#10003;</span>' : "";
      return '<div class="ia-row' + (m.use ? "" : " off") + '"><label class="ia-use"><input type="checkbox" data-ia-use="' + esc(a.id) + '"' + (m.use ? " checked" : "") + (!m.target && !room ? " disabled" : "") + '><span><b>' + esc(a.label) + '</b> ' + ok + '<small>' + a.transactions.length + ' transactions' + (m.sav ? " · savings account, tick to track it as one of your accounts" : !m.target && !room ? " · no room, the app tracks up to 3 accounts" : "") + '</small></span></label>' +
        '<span class="ia-arrow" aria-hidden="true">&rarr;</span><select data-ia-target="' + esc(a.id) + '" aria-label="App account for ' + esc(a.label) + '"' + (m.use ? "" : " disabled") + '>' + opts + '</select></div>';
    }).join("");
    return '<div class="imp-accts"><div class="ia-head">This statement has ' + IMP.accounts.length + ' accounts. Choose where each one goes.</div>' + rows + '</div>';
  }
  $("impSummary").addEventListener("change", e => {
    const u = e.target.dataset.iaUse, t = e.target.dataset.iaTarget;
    if (u) { const m = IMP.map[u]; m.use = e.target.checked; if (m.use && !m.target) m.target = "new"; impRender(); }
    if (t) { IMP.map[t].target = e.target.value; impRender(); }
  });
  function impRender() {
    const a = IMP.acct;
    const acctSel = IMP.accounts.length > 1 ? '<label class="acct-row">Account <select id="impAcct">' + IMP.accounts.map(x => '<option value="' + x.id + '"' + (x.id === a.id ? " selected" : "") + '>' + esc(x.label) + " (" + x.transactions.length + " transactions)</option>").join("") + '</select></label>' : '<div class="acct-row"><b>' + esc(a.label) + '</b></div>';
    const check = a.balanced === true ? '<span class="chip">&#10003; Totals match the statement</span>' : a.balanced === false ? '<span class="chip warn">&#9888; Totals don’t add up exactly. Check the amounts below.</span>' : "";
    if (!IMP.target || !accts().some(x => x.id === IMP.target)) IMP.target = V.acct !== "all" ? V.acct : "main";
    const targetSel = isMultiImp() ? "" : multi() ? '<label class="acct-row">Add to <select id="impTarget">' + accts().map(x => '<option value="' + esc(x.id) + '"' + (x.id === IMP.target ? " selected" : "") + '>' + esc(x.name) + '</option>').join("") + '</select></label>' : "";
    $("impSummary").innerHTML = impAcctList() + '<div class="acct-row">' + acctSel.replace(">Account <", ">Reviewing <") + targetSel + check + '</div><div class="imp-stats">' +
      '<div><small>Period</small><b class="num">' + (a.firstDate ? shortD(a.firstDate) + " to " + niceDate(a.lastDate, false, true) : "Unknown") + '</b></div>' +
      '<div><small>Transactions</small><b class="num">' + a.transactions.length + '</b></div>' +
      '<div><small>Money in</small><b class="num inc-t">' + fmt(a.moneyIn) + '</b></div>' +
      '<div><small>Money out</small><b class="num bill-t">' + fmt(a.moneyOut) + '</b></div>' +
      (a.endBalance != null ? '<div><small>Ending balance</small><b class="num">' + fmt(a.endBalance) + '</b></div>' : "") + '</div>';
    if ($("impAcct")) $("impAcct").onchange = e => impPickAccount(e.target.value);
    if ($("impTarget")) $("impTarget").onchange = e => { IMP.target = e.target.value; impRender(); };
    const st = Store.get();
    const opts = [
      ["end", "From the end of this statement", a.endBalance != null ? "Start " + niceDate(E.fromDay(E.toDay(a.lastDate) + 1)) + " with " + fmt(a.endBalance) : "No ending balance found", a.endBalance == null],
      ["replay", "Replay this statement", a.beginBalance != null ? "Start " + shortD(a.firstDate) + " with " + fmt(a.beginBalance) + " and add every transaction" : "No beginning balance found", a.beginBalance == null],
      ["keep", "Keep my current start", "Start " + niceDate(st.projection.startDate) + " with " + fmt(E.accountStart(st, IMP.target)), false]];
    $("impStart").innerHTML = opts.map(([v, t, d, dis]) => '<label class="radio-card' + (dis ? " disabled" : "") + '"><input type="radio" name="impStart" value="' + v + '"' + (IMP.start === v ? " checked" : "") + (dis ? " disabled" : "") + '><b>' + t + '</b><span>' + esc(d) + '</span></label>').join("");
    let html = "";
    for (const [g, title, help] of IMP_GROUPS) {
      const rows = IMP.rows.filter(r => r.group === g); if (!rows.length) continue;
      const open = !["transfer", "other"].includes(g) || (g === "other" && IMP.start === "replay" && rows.length <= 12);
      const h = g === "other" ? "Added one time on their dates." + (IMP.start === "replay" ? " Together with the groups above, the statement plays back exactly." : "")
        : g === "transfer" && IMP.start === "replay" ? "Money moved between your own accounts. Included so this account's balance plays back exactly." : help;
      html += '<details class="imp-group" data-group="' + g + '"' + (open ? " open" : "") + '><summary><span class="g-title">' + title + ' <span class="hint">(' + rows.length + ')</span></span><span class="hint g-count" data-gc="' + g + '"></span></summary><div class="g-help">' + h + '</div>' + rows.map(impRow).join("") + '</details>';
    }
    $("impGroups").innerHTML = html;
    impPlanText();
  }
  function impRow(r) {
    const plus = r.type === "Income" || r.group === "pay";
    const dates = r.dates.length > 4 ? r.dates.slice(0, 3).map(shortD).join(", ") + " and " + (r.dates.length - 3) + " more" : r.dates.map(shortD).join(", ");
    const looks = r.suggested && r.action !== r.suggested && r.type === "Bill" ? " · looks " + ({ "Weekly": "weekly", "Bi-Weekly": "every 2 weeks", "Monthly": "monthly", "Yearly": "yearly" }[r.suggested] || "") : "";
    const meta = (r.misc ? "Average of the " + r.count + " one-time purchases under Everything else (" + fmt(r.total) + " total) · " + fmt(r.amount) + " a week" : r.group === "pattern" ? r.count + " times, " + fmt(r.total) + " total · " + fmt(r.amount) + " a week on average" : (r.count > 1 ? r.count + " times · " : "") + dates + (r.count === 1 && r.txs[0].type && r.txs[0].type !== r.name ? " · " + r.txs[0].type : "")) + looks;
    const acts = r.group === "pay" ? [["deposit", "Use as my paychecks"], ["schedule", "Only set my paydays"], ["skip", "Ignore"]] : ACTIONS;
    let note = "";
    if (r.group === "pay") {
      const st = Store.get(), est = V.proj.depositMode ? st.income.depositAmount : st.deductions.enabled ? E.computeYearPaychecks(st, st.income.year).typical.net : V.proj.income.paycheck;
      const list = r.txs.map(t => fmt(t.amount) + " on " + shortD(t.date)).join(", ");
      note = '<div class="pay-note">Deposits: ' + esc(list) + (r.payFreq ? " (" + PAYFREQ_TXT[r.payFreq] + ")" : "") + '. ' +
        (r.action === "deposit" ? 'Each projected payday will add <b class="num">' + fmt(r.amount) + '</b>. Change the amount if your pay has changed.' :
         r.action === "schedule" ? 'Paydays will line up with these dates, but each paycheck stays at <b class="num">' + fmt(est) + '</b> from your pay settings.' : 'Your pay settings stay as they are.') + '</div>';
    }
    return '<div class="imp-row' + (r.action === "skip" ? " off" : "") + '" data-id="' + esc(r.id) + '"><div class="ir-main"><input class="ir-name" data-f="name" value="' + esc(r.name) + '" maxlength="60" aria-label="Name"' + (r.group === "pay" ? " readonly" : "") + '><span class="ir-meta"><span class="ir-dir ' + (plus ? "inc-t" : "bill-t") + '">' + (plus ? "IN" : "OUT") + '</span>' + esc(meta) + '</span></div>' +
      '<span class="money-in"><input data-f="amount" type="number" min="0" step="0.01" value="' + r.amount + '" aria-label="Amount"' + "></span>" +
      '<select data-f="action" aria-label="How to add ' + esc(r.name) + '">' + acts.map(([v, l]) => '<option value="' + v + '"' + (r.action === v ? " selected" : "") + '>' + l + '</option>').join("") + '</select>' + note + '</div>';
  }
  function impPlans() {
    if (!isMultiImp()) return [{ stmt: IMP.acct, target: IMP.target || "main", plan: Imp.buildPlan(IMP.acct, IMP.rows, { start: IMP.start }) }];
    return IMP.accounts.filter(a => IMP.map[a.id].use && IMP.map[a.id].target).map(a => ({ stmt: a, target: IMP.map[a.id].target, plan: Imp.buildPlan(a, impRowsFor(a), { start: IMP.start }) }));
  }
  function impPlanText() {
    const plans = impPlans();
    const plan = { items: plans.flatMap(x => x.plan.items), setPay: (plans.find(x => x.plan.setPay) || { plan: {} }).plan.setPay, projection: (plans.find(x => x.plan.projection) || { plan: {} }).plan.projection };
    if (plans.length > 1 && plan.projection) plan.projection = Object.assign({}, plan.projection, { startDate: plans.filter(x => x.plan.projection).map(x => x.plan.projection.startDate).sort()[0], startingBalance: plans.reduce((t, x) => t + (x.plan.projection ? x.plan.projection.startingBalance : 0), 0) });
    plan.plans = plans;
    const parts = [];
    const recurring = plan.items.filter(i => i.frequency !== "One-time").length, once = plan.items.length - recurring;
    if (recurring) parts.push(recurring + " repeating " + (recurring === 1 ? "item" : "items"));
    if (once) parts.push(once + " one-time " + (once === 1 ? "item" : "items"));
    if (plan.setPay) parts.push((plan.setPay.deposit ? "paychecks of " + fmt(plan.setPay.deposit) + " " : "paydays ") + (plan.setPay.payFrequency ? PAYFREQ_TXT[plan.setPay.payFrequency] + " " : "") + "lined up with " + shortD(plan.setPay.knownPayday));
    if (plan.projection) parts.push("start " + shortD(plan.projection.startDate) + " with " + fmt(plan.projection.startingBalance) + (plans.length > 1 ? " in total" : ""));
    if (isMultiImp()) { const nNew = plans.filter(x => x.target === "new").length; if (plans.length) parts.unshift(plans.length + (plans.length === 1 ? " account" : " accounts") + (nNew ? " (" + nNew + " new)" : "")); }
    const startAt = plan.projection ? plan.projection.startDate : Store.get().projection.startDate;
    const early = plan.items.filter(i => i.frequency === "One-time" && i.first < startAt).length;
    $("impPlanText").textContent = (parts.length ? "Will add: " + parts.join(" · ") : "Nothing selected yet. Choose how to add the items you want.") +
      (early ? ". " + early + " one-time " + (early === 1 ? "item is" : "items are") + " dated before your projection starts, so " + (early === 1 ? "it" : "they") + " won't change it. Choose Replay this statement to include them." : "");
    $("impApply").disabled = !parts.length;
    IMP_GROUPS.forEach(([g]) => { const el = document.querySelector('[data-gc="' + g + '"]'); if (!el) return; const n = IMP.rows.filter(r => r.group === g && r.action !== "skip").length; el.textContent = n ? n + " selected" : ""; });
    return plan;
  }
  $("impGroups").addEventListener("input", e => {
    const row = e.target.closest(".imp-row"); if (!row) return;
    const r = IMP.rows.find(x => x.id === row.dataset.id), f = e.target.dataset.f; if (!r || !f) return;
    if (f === "amount") { const v = Number(e.target.value); if (!(v >= 0)) return; r.amount = v; }
    else if (f === "name") { if (!e.target.value.trim()) return; r.name = e.target.value.trim(); }
    else { r.action = e.target.value; IMP.touched.add(r.id); row.classList.toggle("off", r.action === "skip"); }
    if (r.group === "pay" && f === "action") { const fresh = document.createElement("div"); fresh.innerHTML = impRow(r); row.replaceWith(fresh.firstChild); }
    impPlanText();
  });
  $("impStart").addEventListener("change", e => {
    if (e.target.name !== "impStart") return; IMP.start = e.target.value;
    const keep = [IMP.rows, IMP.touched];
    Object.keys(IMP.rowsBy).forEach(id => { IMP.rows = IMP.rowsBy[id]; IMP.touched = IMP.touchedBy[id] || new Set(); impDefaults(); });
    [IMP.rows, IMP.touched] = keep; impRender();
  });
  $("impApply").addEventListener("click", () => {
    const plan = impPlanText(), prev = Store.get(), before = V.proj.ending;
    let added = 0, dupes = 0, linked = 0, created = 0;
    const clearedExamples = prev.isExample;
    Store.update(s => {
      if (clearedExamples) s.items = [];
      s.accounts = E.accountsOf(s).map(a => Object.assign({}, a));
      let startDate = null;
      for (const { stmt, target, plan: pl } of plan.plans) {
        /* the app account: an existing one, or a new one named after the statement account */
        let tgt = target;
        if (tgt === "new") {
          if (s.accounts.length >= E.MAX_ACCOUNTS) continue;
          tgt = "acct" + Store.uid(); s.accounts.push({ id: tgt, name: stmtName(stmt), start: 0, number: stmt.number || "" }); created++;
        } else if (isMultiImp()) {
          const a = s.accounts.find(x => x.id === tgt);
          if (a && !a.number && stmt.number) a.number = stmt.number;
          if (a && tgt === "main" && a.name === "Main checking") a.name = stmtName(stmt);
        }
        for (const it of pl.items) {
          if (s.items.some(x => (x.name === it.name && Math.abs(x.amount - it.amount) < 0.005 && x.frequency === it.frequency && x.first === it.first && (x.account || "main") === tgt) ||
            (x.type === "Transfer" && it.frequency === "One-time" && E.categoryOf(it) === "Transfers" && Math.abs(x.amount - it.amount) < 0.005 && Math.abs(E.toDay(x.first) - E.toDay(it.first)) <= 1 && (it.type === "Bill" ? x.account === tgt : x.to === tgt)))) { dupes++; continue; }
          s.items.push(Object.assign({ id: Store.uid(), end: "" }, it, { amount: Math.round(it.amount * 100) / 100, account: tgt })); added++;
        }
        if (pl.setPay && !s._paySet) {
          s.income.knownPayday = pl.setPay.knownPayday; if (pl.setPay.payFrequency) s.income.payFrequency = pl.setPay.payFrequency;
          if (pl.setPay.deposit) { s.income.payMode = "deposit"; s.income.depositAmount = pl.setPay.deposit; }
          s.income.paysFrom = pl.setPay.paysFrom || ""; s.income.depositTo = tgt; s._paySet = true;
        }
        if (pl.projection) {
          if (!startDate || pl.projection.startDate < startDate) startDate = pl.projection.startDate;
          if (tgt === "main") s.projection.startingBalance = pl.projection.startingBalance;
          else { const a = s.accounts.find(x => x.id === tgt); if (a) a.start = pl.projection.startingBalance; }
        }
      }
      delete s._paySet;
      if (startDate) s.projection.startDate = startDate;
      /* a transfer out of one account that matches a transfer into another becomes one linked Transfer */
      if (s.accounts.length > 1) { const lk = E.linkTransfers(s.items, s.accounts); s.items = lk.items; linked = lk.linked; }
    });
    impDlg.close();
    if (created || isMultiImp()) V.acct = "all";
    V.mIdx = null; V.sel = null; V.cfIdx = null; saveUi(); render();
    const bits = [];
    if (isMultiImp()) bits.push(plan.plans.length + (plan.plans.length === 1 ? " account" : " accounts") + (created ? " (" + created + " new)" : ""));
    bits.push(added + (added === 1 ? " item" : " items") + " added");
    if (linked) bits.push(linked + (linked === 1 ? " transfer" : " transfers") + " linked");
    if (dupes) bits.push(dupes + " already in your list");
    if (clearedExamples) bits.push("example bills removed");
    if (plan.setPay) bits.push(plan.setPay.deposit ? "paychecks set to " + fmt(plan.setPay.deposit) : "paydays updated");
    if (plan.projection) bits.push("starting balance " + fmt(plan.projection.startingBalance, { cents: false }) + (plan.plans.length > 1 ? " in total" : ""));
    toast({ kind: "added", title: "Statement imported", detail: bits.slice(0, 3).join(" · "), impact: impactLine(before, V.proj.ending), action: { label: "Undo", run: () => { Store.replace(prev); fillForms(); toast({ kind: "info", title: "Import undone" }); } } });
  });
  $("impBack").addEventListener("click", () => { $("impFile").value = ""; impView("pick"); });
  $("impFile").addEventListener("change", e => { const f = e.target.files; if (f && f.length) impHandle(f); e.target.value = ""; });
  const dz = $("dropzone");
  ["dragenter", "dragover"].forEach(t => dz.addEventListener(t, e => { e.preventDefault(); dz.classList.add("over"); }));
  ["dragleave", "drop"].forEach(t => dz.addEventListener(t, () => dz.classList.remove("over")));
  dz.addEventListener("drop", e => { e.preventDefault(); e.stopPropagation(); if (e.dataTransfer.files.length) impHandle(e.dataTransfer.files); });
  /* drop a statement anywhere on the page */
  let dragDepth = 0;
  const hasFiles = e => e.dataTransfer && [...e.dataTransfer.types].includes("Files");
  document.addEventListener("dragenter", e => { if (!hasFiles(e) || impDlg.open) return; dragDepth++; $("dropOverlay").hidden = false; });
  document.addEventListener("dragleave", e => { if (!hasFiles(e)) return; dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $("dropOverlay").hidden = true; });
  document.addEventListener("dragover", e => { if (hasFiles(e)) e.preventDefault(); });
  document.addEventListener("drop", e => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth = 0; $("dropOverlay").hidden = true; if (!impDlg.open && e.dataTransfer.files.length) openImport(e.dataTransfer.files); });
  $("openImport").addEventListener("click", () => openImport());
  $("navImport").addEventListener("click", () => openImport());
  $("drawerImport").addEventListener("click", () => { drawer.close(); openImport(); });

  /* ---------- global clicks ---------- */
  document.addEventListener("click", e => {
    const ed = e.target.closest("[data-edit]"); if (ed) { openItem(ed.dataset.edit); return; }
    if (e.target.closest("[data-add]")) openItem();
  });
  $("cal").addEventListener("click", e => { const b = e.target.closest("button.day"); if (b) selectDay(b.dataset.iso); });
  $("prevM").addEventListener("click", () => { if (V.mIdx > 0) { V.mIdx--; renderCal(-1); } });
  $("nextM").addEventListener("click", () => { if (V.mIdx < V.months.length - 1) { V.mIdx++; renderCal(1); } });
  $("addItem").addEventListener("click", () => openItem());
  $("drawerAdd").addEventListener("click", () => openItem());
  $("addOnDay").addEventListener("click", () => openItem(null, V.sel));
  $("openSettings").addEventListener("click", () => openDrawer("pay"));
  $("mSettings").addEventListener("click", () => openDrawer("pay"));
  $("editPay").addEventListener("click", () => openDrawer("pay"));
  $("editTax").addEventListener("click", () => openDrawer("tax"));
  $("syncPill").addEventListener("click", () => openDrawer("sync"));
  $("setupMine").addEventListener("click", () => { Store.update(() => {}, "edit"); openDrawer("pay"); toast({ kind: "info", title: "Let’s set up your numbers", detail: "Start with your pay, then add your bills." }); });
  $("startBlank").addEventListener("click", () => { Store.replace(Store.blankState()); openDrawer("pay"); toast({ kind: "deleted", title: "Examples cleared", detail: "Enter your pay to begin." }); });

  /* ---------- Excel and Google Sheets (made on this device, no internet needed) ---------- */
  async function exportExcel(btn) {
    const lbl = btn && btn.querySelector("span") || btn, was = lbl ? lbl.textContent : "";
    if (btn) { btn.disabled = true; if (lbl) lbl.textContent = "Making your spreadsheet…"; }
    try {
      const blob = await window.FTExcel.exportWorkbook({ state: Store.get(), proj: V.projAll, catColor, todayIso: todayIso() });
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
      a.download = "Finance Toolbox " + todayIso() + ".xlsx"; document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
      toast({ kind: "saved", title: "Spreadsheet downloaded", detail: "Open it in Excel or Numbers, or upload it to Google Drive and open it with Google Sheets." });
    } catch (err) { toast({ kind: "error", title: "The spreadsheet couldn't be made", detail: err.message || String(err) }); }
    finally { if (btn) { btn.disabled = false; if (lbl) lbl.textContent = was; } }
  }
  $("xlsxExport").addEventListener("click", e => exportExcel(e.currentTarget));
  $("navExcel").addEventListener("click", e => exportExcel(e.currentTarget));
  $("xlsxFile").addEventListener("change", async e => {
    const f = e.target.files[0]; e.target.value = ""; if (!f) return;
    try {
      const prev = Store.get(), before = V.proj.ending;
      const res = await window.FTExcel.importWorkbook(f, prev);
      Store.replace(res.state, "edit"); fillForms(); V.mIdx = null; V.sel = null; V.cfIdx = null; render();
      toast({ kind: "saved", title: "Spreadsheet imported", detail: res.count + (res.count === 1 ? " bill or income" : " bills and income") + " plus your pay settings" + (res.problems.length ? " · skipped " + res.problems.length + " row" + (res.problems.length === 1 ? "" : "s") + " with no amount or date: " + res.problems.slice(0, 3).join(", ") : ""),
        impact: impactLine(before, V.proj.ending), action: { label: "Undo", run: () => { Store.replace(prev); fillForms(); toast({ kind: "info", title: "Import undone" }); } } });
    } catch (err) { toast({ kind: "error", title: "That file couldn't be imported", detail: err.message || "Choose a spreadsheet made with Export to Excel." }); }
  });

  /* ---------- backup ---------- */
  $("exportBtn").addEventListener("click", () => {
    const st = Store.get(), data = JSON.stringify({ app: "Finance Toolbox", exportedAt: new Date().toISOString(), ...st, sync: {} }, null, 2);
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([data], { type: "application/json" }));
    a.download = "finance-toolbox-backup-" + todayIso() + ".json"; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    toast({ kind: "saved", title: "Backup downloaded", detail: "Keep the file somewhere safe, like your email or cloud storage." });
  });
  $("importFile").addEventListener("change", async e => {
    const f = e.target.files[0]; e.target.value = ""; if (!f) return;
    try {
      const prev = Store.get();
      const next = Store.clean(JSON.parse(await f.text()));
      next.isExample = false; next.updatedAt = Date.now(); next.sync = prev.sync;
      Store.replace(next, "edit"); fillForms();
      toast({ kind: "saved", title: "Backup restored", detail: next.items.length + " bills and income items plus your pay settings", action: { label: "Undo", run: () => { Store.replace(prev); fillForms(); } } });
    } catch (err) { toast({ kind: "error", title: "That file couldn't be read", detail: "Choose a Finance Toolbox backup file (.json)." }); }
  });
  const RESET_IDLE = '<button class="btn" type="button" data-reset="ask">Erase my data</button>';
  $("resetRow").addEventListener("click", e => {
    const b = e.target.closest("[data-reset]"); if (!b) return;
    const act = b.dataset.reset;
    if (act === "ask") { $("resetRow").innerHTML = '<span class="help" style="align-self:center">Erase everything in this browser?</span><button class="btn danger-t" type="button" data-reset="yes">Yes, erase</button><button class="btn" type="button" data-reset="no">Keep my data</button>'; return; }
    $("resetRow").innerHTML = RESET_IDLE;
    if (act === "yes") { const prev = Store.get(); Store.replace(Store.blankState()); fillForms(); toast({ kind: "deleted", title: "Your data was erased", detail: "Pay, projection and bills were cleared from this browser.", action: { label: "Undo", run: () => { Store.replace(prev); fillForms(); } } }); }
  });
  $("resetRow").innerHTML = RESET_IDLE;

  /* ---------- Google Sheets panel ---------- */
  const FileStore = window.FTFile;
  /* ---------- where the data lives: always on this device ---------- */
  let installEvt = null;
  addEventListener("beforeinstallprompt", e => { e.preventDefault(); installEvt = e; if ($("drawer").open) renderDevice(); });
  addEventListener("appinstalled", () => { installEvt = null; Store.protect().then(() => { if ($("drawer").open) renderDevice(); }); toast({ kind: "added", title: "App installed", detail: "Your numbers stay on this device." }); });
  const standalone = () => { try { return matchMedia("(display-mode: standalone)").matches || navigator.standalone === true; } catch (e) { return false; } };
  const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  function renderDevice() {
    const box = $("deviceBox"); if (!box) return;
    const d = Store.deviceStatus(), web = /^https?:$/.test(location.protocol);
    const line = (ok, yes, no, unknown) => '<li class="dv ' + (ok === true ? "ok" : ok === false ? "no" : "un") + '"><i aria-hidden="true">' + (ok === true ? "&#10003;" : ok === false ? "!" : "&middot;") + '</i>' + (ok === true ? yes : ok === false ? no : unknown) + '</li>';
    let install = "";
    if (web && !standalone()) {
      if (installEvt) install = '<div class="row-btns"><button class="btn primary" type="button" id="installBtn">Install the app</button></div><p class="help">Opens in its own window, works without internet, and keeps your data from being cleared.</p>';
      else if (isIOS()) install = '<p class="help"><b>Install on iPhone or iPad:</b> tap the Share button, then <b>Add to Home Screen</b>. Safari can clear website data after a few weeks of not visiting; the installed app keeps it.</p>';
    }
    box.innerHTML = '<h3>Stored on this device</h3><p class="help">Your numbers are saved only on this ' + (isIOS() ? "device" : "computer") + ', inside this browser. They are never uploaded, and nothing is sent online.</p><ul class="dv-list">' +
      line(d.local, "Saved in this browser", "This browser isn't allowing saving (private window?). Download a backup.", "Checking browser storage") +
      line(d.copy, "Second copy kept on this device", "No second copy (not supported here)", "Checking for the second copy") +
      (web ? line(d.persisted, "Protected from automatic clearing", standalone() ? "The browser may clear it if storage runs low. Keep a backup." : "Not protected yet. Install the app to protect it.", "Protection not available in this browser") : "") +
      (web ? line(standalone() ? true : null, "Running as an installed app", "", "Running in a browser tab") : "") + '</ul>' + install;
    const b = $("installBtn"); if (b) b.onclick = () => { const ev = installEvt; installEvt = null; ev.prompt(); ev.userChoice.finally(renderDevice); };
  }
  function renderSync() { renderDevice(); if (FileStore) FileStore.renderPanel($("fileBox"), { toast, fillForms }); if (Sheets) Sheets.renderPanel($("sheetBox"), { toast, fillForms }); }
  /* The Google Sheets pill only shows once a sheet is linked; the file pill always shows where data is saved */
  function setPill(kind, text) { const hide = !kind && text === "Saved on this device"; $("syncPill").hidden = hide; $("syncPill").className = "pill " + (kind || ""); $("syncText").textContent = text; }
  window.FTApp = { toast, setPill, render, fillForms, renderSync };

  /* ---------- boot ---------- */
  Store.load();
  route(true);
  /* bring numbers back from the on-device copy if the browser cleared its main storage, then ask the browser to keep them */
  Store.recover().then(restored => { if (restored) { fillForms(); toast({ kind: "added", title: "Your numbers were restored", detail: "Recovered from the copy saved on this device." }); } if ($("drawer").open) renderDevice(); });
  (standalone() ? Store.protect() : Store.checkProtect()).then(() => { if ($("drawer").open) renderDevice(); });
  let askedProtect = false;
  Store.onChange((st, reason) => { if (!askedProtect && reason !== "restore" && !st.isExample) { askedProtect = true; Store.protect().then(() => { if ($("drawer").open) renderDevice(); }); } });
  Store.onChange((st, reason) => { if (reason !== "sync-meta") render(); else if ($("drawer").open) renderSync(); if (Sheets) Sheets.onLocalChange(reason); if (FileStore) FileStore.onChange(reason); });
  render();
  if (Sheets) Sheets.init(); else setPill("", "Saved on this device");
  if (FileStore) FileStore.init({ toast, fillForms: () => { fillForms(); if ($("drawer").open) { fillTaxForm(); renderDedList(); } } }).then(() => { if ($("drawer").open) renderSync(); });
  $("filePill").addEventListener("click", () => { const t = $("fileText").textContent; if (t.startsWith("Allow access")) FileStore.allow().then(renderSync); else openDrawer("sync"); });
  let rz; addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(() => { renderSized(); }, 150); });
  /* refresh "today" when the app is reopened on a later day */
  let lastDay = todayIso();
  document.addEventListener("visibilitychange", () => { if (!document.hidden && todayIso() !== lastDay) { lastDay = todayIso(); V.sel = null; render(); } });
})();
