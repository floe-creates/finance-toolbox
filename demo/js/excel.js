/* Finance Toolbox: Excel export and import, built in the browser with no internet.
   The workbook copies the app's look (colors from the current light or dark theme) and keeps
   live formulas, so editing a transaction in Excel or Google Sheets updates the ledger,
   calendar, cash flow and dashboard. The "Bills & income" and "Settings" tabs can be imported back. */
(function (root) {
  "use strict";
  const E = root.FTEngine;
  const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const MON = MONTHS.map(m => m.slice(0, 3));
  const DOW = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  const FREQS = ["One-time", "Weekly", "Bi-Weekly", "Monthly", "Yearly"];
  const INC = ["amount", "per", "payType", "year", "hoursPerWeek", "daysPerWeek", "paidHolidays", "paidPto", "unpaidDays", "overtimeAfter", "overtimeMultiplier", "payFrequency", "knownPayday", "payMode", "depositAmount", "paysFrom"];
  const LABELS = { amount: "Income amount", per: "Per", payType: "Pay type", year: "Tax year", hoursPerWeek: "Hours per week", daysPerWeek: "Days per week", paidHolidays: "Paid holidays per year", paidPto: "Paid PTO days per year", unpaidDays: "Unpaid days off per year", overtimeAfter: "Overtime after (hours per week)", overtimeMultiplier: "Overtime pay multiplier", payFrequency: "Pay frequency", knownPayday: "A known payday", payMode: "Paycheck amount (calc = figured from pay, deposit = bank deposit)", depositAmount: "Deposit per paycheck", paysFrom: "Paychecks counted from (blank = always)", startDate: "Projection start date", months: "Months to project", startingBalance: "Starting balance" };
  const SHEET = { dash: "Dashboard", cash: "Cash flow", cal: "Projection Calendar", ledger: "Ledger", tx: "Transactions", bills: "Bills & income", pay: "Paycheck", set: "Settings" };
  const ref = name => /^[A-Za-z]+$/.test(name) ? name : "'" + name + "'";
  const FONT = "Arial", TITLE_FONT = "Georgia";
  const MONEY = '"$"#,##0.00;-"$"#,##0.00', MONEY0 = '"$"#,##0;-"$"#,##0', SIGNED0 = '+"$"#,##0;-"$"#,##0;""', PCT = '0%', DATE = 'ddd, mmm d, yyyy', DATE_S = 'mmm d';

  /* ---------- colors from the app's current theme ---------- */
  function palette() {
    const cs = getComputedStyle(document.documentElement);
    const v = n => hex(cs.getPropertyValue("--" + n).trim() || "#888888");
    const P = { bg: v("bg"), surface: v("surface"), surface2: v("surface-2"), surface3: v("surface-3"), ink: v("ink"), ink2: v("ink-2"), muted: v("muted"), line: v("line"),
      accent: v("accent"), income: v("income"), bills: v("bills"), good: v("good"), neg: v("neg"), negSoft: v("neg-soft") };
    P.resolve = c => { const m = /var\(--([\w-]+)\)/.exec(c || ""); return m ? v(m[1]) : hex(c || "#888888"); };
    P.dark = lum(P.bg) < 0.4;
    return P;
  }
  function hex(c) { c = String(c).trim(); if (/^#[0-9a-f]{3}$/i.test(c)) c = "#" + c.slice(1).split("").map(x => x + x).join(""); return /^#[0-9a-f]{6}$/i.test(c) ? c.toLowerCase() : "#888888"; }
  const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const lum = h => { const [r, g, b] = rgb(h); return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; };
  const mix = (a, b, t) => { const A = rgb(a), B = rgb(b); return "#" + A.map((x, i) => Math.round(x + (B[i] - x) * t).toString(16).padStart(2, "0")).join(""); };
  const argb = h => ({ argb: "FF" + hex(h).slice(1).toUpperCase() });
  const solid = h => ({ type: "pattern", pattern: "solid", fgColor: argb(h), bgColor: argb(h) });

  /* ---------- dates ---------- */
  const isoDate = iso => { const p = E.parts(E.toDay(iso)); return new Date(Date.UTC(p.y, p.m, p.d)); };
  const niceDate = (iso, year) => { const p = E.parts(E.toDay(iso)); return DOW[p.dow] + ", " + MON[p.m] + " " + p.d + (year ? ", " + p.y : ""); };
  const monthKey = iso => { const p = E.parts(E.toDay(iso)); return p.y * 12 + p.m; };
  const dim = k => new Date(Date.UTC(Math.floor(k / 12), k % 12 + 1, 0)).getUTCDate();
  const r2 = n => Math.round(n * 1e6) / 1e6; /* full precision, so spreadsheet sums match the app to the cent */

  /* ---------- small style helpers ---------- */
  function sheetFor(wb, name, P, tab) {
    const ws = wb.addWorksheet(name, { views: [{ showGridLines: false, zoomScale: 100 }], properties: { tabColor: argb(tab || P.accent), defaultRowHeight: 18 } });
    ws.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } };
    /* paint the background on whole columns so the sheet looks like the app */
    for (let c = 1; c <= 40; c++) { const col = ws.getColumn(c); col.width = col.width || 11; col.fill = solid(P.bg); col.font = { name: FONT, size: 10, color: argb(P.ink) }; }
    return ws;
  }
  function put(ws, r, c, value, st = {}) {
    const cell = ws.getCell(r, c);
    cell.value = value;
    cell.font = Object.assign({ name: FONT, size: 10, color: argb(st.color || st.P.ink) }, st.font || {});
    cell.fill = solid(st.fill || st.P.bg);
    if (st.fmt) cell.numFmt = st.fmt;
    cell.alignment = Object.assign({ vertical: "middle" }, st.align || {});
    if (st.border) cell.border = st.border;
    return cell;
  }
  const box = (h, w = "thin") => ({ top: { style: w, color: argb(h) }, left: { style: w, color: argb(h) }, bottom: { style: w, color: argb(h) }, right: { style: w, color: argb(h) } });
  const under = h => ({ bottom: { style: "thin", color: argb(h) } });
  function label(ws, r, c, text, P, o = {}) { return put(ws, r, c, String(text).toUpperCase(), { P, color: P.muted, fill: o.fill, font: { size: 8, bold: true }, align: o.align }); }
  function title(ws, P, eyebrow, name, sub) {
    ws.getRow(1).height = 10;
    label(ws, 2, 2, eyebrow, P);
    put(ws, 3, 2, name, { P, font: { name: TITLE_FONT, size: 24 } }); ws.getRow(3).height = 34;
    if (sub) put(ws, 4, 2, sub, { P, color: P.muted, font: { size: 10 } });
  }
  function headerRow(ws, r, c, names, P, widths) {
    names.forEach((n, i) => {
      const cell = label(ws, r, c + i, n, P, { fill: P.surface2, align: { horizontal: i && !/name|category|what|how|type|item|month|date|day|id|key|value/i.test(n) ? "right" : "left", indent: 1 } });
      cell.border = under(P.line);
      if (widths && widths[i]) ws.getColumn(c + i).width = widths[i];
    });
    ws.getRow(r).height = 22;
  }
  function tile(ws, r, c, span, lab, value, meta, P, fmt, color) {
    for (let rr = r; rr < r + 3; rr++) for (let cc = c; cc < c + span; cc++) put(ws, rr, cc, null, { P, fill: P.surface });
    ws.mergeCells(r, c, r, c + span - 1); ws.mergeCells(r + 1, c, r + 1, c + span - 1); ws.mergeCells(r + 2, c, r + 2, c + span - 1);
    label(ws, r, c, lab, P, { fill: P.surface, align: { indent: 1, vertical: "bottom" } });
    put(ws, r + 1, c, value, { P, fill: P.surface, fmt, color: color || P.ink, font: { size: 18, bold: true }, align: { indent: 1, horizontal: "left" } });
    put(ws, r + 2, c, meta, { P, fill: P.surface, color: P.muted, font: { size: 9 }, align: { indent: 1, vertical: "top", horizontal: "left" }, fmt: typeof meta === "object" ? DATE : undefined });
    const L = argb(P.line);
    for (let cc = c; cc < c + span; cc++) {
      ws.getCell(r, cc).border = Object.assign({}, ws.getCell(r, cc).border, { top: { style: "thin", color: L } });
      ws.getCell(r + 2, cc).border = Object.assign({}, ws.getCell(r + 2, cc).border, { bottom: { style: "thin", color: L } });
    }
    for (let rr = r; rr < r + 3; rr++) { ws.getCell(rr, c).border = Object.assign({}, ws.getCell(rr, c).border, { left: { style: "thin", color: L } }); ws.getCell(rr, c + span - 1).border = Object.assign({}, ws.getCell(rr, c + span - 1).border, { right: { style: "thin", color: L } }); }
    ws.getRow(r).height = 22; ws.getRow(r + 1).height = 30; ws.getRow(r + 2).height = 20;
  }

  /* ---------- chart pictures (drawn like the app's charts) ---------- */
  function canvas(w, h, P) {
    const c = document.createElement("canvas"), s = 2; c.width = w * s; c.height = h * s;
    const g = c.getContext("2d"); g.scale(s, s); g.fillStyle = P.surface; g.fillRect(0, 0, w, h);
    g.strokeStyle = P.line; g.lineWidth = 1; g.strokeRect(0.5, 0.5, w - 1, h - 1);
    return { c, g, w, h };
  }
  const body = (sz, wt) => (wt || 400) + " " + sz + "px Figtree, Arial, sans-serif";
  const mono = sz => "500 " + sz + "px 'IBM Plex Mono', Consolas, monospace";
  const short = n => { const a = Math.abs(n), s = n < 0 ? "-" : ""; return a >= 1e6 ? s + "$" + (a / 1e6).toFixed(1).replace(/\.0$/, "") + "M" : a >= 1e3 ? s + "$" + (a / 1e3).toFixed(a >= 1e4 ? 0 : 1).replace(/\.0$/, "") + "k" : s + "$" + Math.round(a); };
  function ticks(min, max, n = 4) {
    if (min === max) max = min + 1;
    const raw = (max - min) / n, mag = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / mag, step = (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * mag, t = [];
    for (let v = Math.floor(min / step) * step; v <= Math.ceil(max / step) * step + step / 2; v += step) t.push(Math.round(v * 100) / 100);
    return t;
  }
  function chartHead(g, P, text, x = 18, y = 26) { g.fillStyle = P.ink2; g.font = mono(10); g.fillText(text.toUpperCase().split("").join(String.fromCharCode(8202)), x, y); }
  function balanceChart(days, today, P, w = 980, h = 290) {
    const { c, g } = canvas(w, h, P), m = { l: 62, r: 20, t: 46, b: 30 }, iw = w - m.l - m.r, ih = h - m.t - m.b;
    chartHead(g, P, "Balance projection");
    const vals = days.map(d => d.balance), tk = ticks(Math.min(0, ...vals), Math.max(...vals)), y0 = tk[0], y1 = tk[tk.length - 1];
    const X = i => m.l + (days.length === 1 ? iw / 2 : i * iw / (days.length - 1)), Y = v => m.t + ih - (v - y0) / (y1 - y0) * ih;
    g.font = body(11); g.textAlign = "right";
    tk.forEach(t => { g.strokeStyle = P.line; g.beginPath(); g.moveTo(m.l, Y(t) + .5); g.lineTo(w - m.r, Y(t) + .5); g.stroke(); g.fillStyle = P.muted; g.fillText(short(t), m.l - 8, Y(t) + 4); });
    g.textAlign = "center"; let lastX = -99;
    days.forEach((d, i) => { const p = E.parts(E.toDay(d.iso)); if ((p.d === 1 || i === 0) && X(i) - lastX > 40) { g.fillStyle = P.muted; g.fillText(MON[p.m] + (p.m === 0 || i === 0 ? " \u2019" + String(p.y).slice(2) : ""), X(i), h - 10); lastX = X(i); } });
    const grad = g.createLinearGradient(0, m.t, 0, m.t + ih); grad.addColorStop(0, P.accent + "55"); grad.addColorStop(1, P.accent + "00");
    g.beginPath(); days.forEach((d, i) => i ? g.lineTo(X(i), Y(d.balance)) : g.moveTo(X(i), Y(d.balance)));
    g.lineTo(X(days.length - 1), Y(Math.max(0, y0))); g.lineTo(X(0), Y(Math.max(0, y0))); g.closePath(); g.fillStyle = grad; g.fill();
    if (y0 < 0) { g.setLineDash([4, 4]); g.strokeStyle = P.neg; g.beginPath(); g.moveTo(m.l, Y(0)); g.lineTo(w - m.r, Y(0)); g.stroke(); g.setLineDash([]); }
    g.beginPath(); days.forEach((d, i) => i ? g.lineTo(X(i), Y(d.balance)) : g.moveTo(X(i), Y(d.balance)));
    g.strokeStyle = P.accent; g.lineWidth = 2.2; g.lineJoin = "round"; g.stroke(); g.lineWidth = 1;
    days.forEach((d, i) => { if (d.pay > 0) { g.beginPath(); g.arc(X(i), Y(d.balance), 3.2, 0, Math.PI * 2); g.fillStyle = P.income; g.fill(); } });
    const ti = days.findIndex(d => d.iso === today);
    if (ti >= 0) { g.setLineDash([2, 4]); g.strokeStyle = P.ink2; g.beginPath(); g.moveTo(X(ti), m.t); g.lineTo(X(ti), m.t + ih); g.stroke(); g.setLineDash([]); g.fillStyle = P.ink2; g.font = mono(9); g.textAlign = "left"; g.fillText("TODAY", X(ti) + 5, m.t + 8); }
    g.textAlign = "right"; g.font = body(11); g.fillStyle = P.income; g.fillText("● Payday", w - m.r, 26);
    return c.toDataURL("image/png");
  }
  function monthBars(agg, P, w = 600, h = 280) {
    const { c, g } = canvas(w, h, P), m = { l: 56, r: 16, t: 50, b: 30 }, iw = w - m.l - m.r, ih = h - m.t - m.b;
    chartHead(g, P, "Money in vs bills");
    g.font = body(11); g.textAlign = "right"; g.fillStyle = P.bills; g.fillText("■ Bills", w - 16, 26); g.fillStyle = P.income; g.fillText("■ Money in", w - 72, 26);
    const tk = ticks(0, Math.max(1, ...agg.map(a => Math.max(a.inc, a.out)))), top = tk[tk.length - 1], Y = v => m.t + ih - v / top * ih;
    tk.forEach(t => { g.strokeStyle = P.line; g.beginPath(); g.moveTo(m.l, Y(t) + .5); g.lineTo(w - m.r, Y(t) + .5); g.stroke(); g.fillStyle = P.muted; g.fillText(short(t), m.l - 8, Y(t) + 4); });
    const band = iw / Math.max(1, agg.length), bw = Math.max(3, Math.min(22, (band - 10) / 2));
    const bar = (x, v, col) => { const y = Y(v), hh = m.t + ih - y; if (hh < .5) return; g.fillStyle = col; g.beginPath(); const r = Math.min(3, bw / 2, hh / 2); g.moveTo(x, m.t + ih); g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y); g.lineTo(x + bw - r, y); g.quadraticCurveTo(x + bw, y, x + bw, y + r); g.lineTo(x + bw, m.t + ih); g.fill(); };
    g.textAlign = "center";
    agg.forEach((a, i) => { const cx = m.l + band * i + band / 2; bar(cx - bw - 1, a.inc, P.income); bar(cx + 1, a.out, P.bills); if (band >= 26 || i % 2 === 0) { g.fillStyle = P.muted; g.fillText(MON[a.k % 12], cx, h - 10); } });
    return c.toDataURL("image/png");
  }
  function donut(cats, total, labelText, P, w = 400, h = 280) {
    const { c, g } = canvas(w, h, P);
    chartHead(g, P, "Category breakdown");
    const cx = 120, cy = 158, R = 92, r = 64;
    if (!total) { g.strokeStyle = P.surface2; g.lineWidth = R - r; g.beginPath(); g.arc(cx, cy, (R + r) / 2, 0, Math.PI * 2); g.stroke(); }
    let a0 = -Math.PI / 2;
    cats.forEach(([, v, col]) => { const a1 = a0 + v / total * Math.PI * 2, gap = cats.length > 1 ? 0.02 : 0; g.beginPath(); g.arc(cx, cy, R, a0 + gap / 2, a1 - gap / 2); g.arc(cx, cy, r, a1 - gap / 2, a0 + gap / 2, true); g.closePath(); g.fillStyle = col; g.fill(); a0 = a1; });
    g.textAlign = "center"; g.fillStyle = P.ink; g.font = body(20, 600); g.fillText(short(total), cx, cy + 4); g.fillStyle = P.muted; g.font = body(11); g.fillText(labelText, cx, cy + 22);
    g.textAlign = "left";
    cats.slice(0, 8).forEach(([n, v, col], i) => { const y = 66 + i * 26; g.fillStyle = col; g.fillRect(240, y - 9, 10, 10); g.fillStyle = P.ink; g.font = body(12); g.fillText(n.length > 15 ? n.slice(0, 14) + "…" : n, 258, y); g.fillStyle = P.muted; g.font = body(11); g.textAlign = "right"; g.fillText(Math.round(v / total * 100) + "%", w - 16, y); g.textAlign = "left"; });
    return c.toDataURL("image/png");
  }
  function addPic(wb, ws, dataUrl, col, row, w, h) { const id = wb.addImage({ base64: dataUrl, extension: "png" }); ws.addImage(id, { tl: { col: col - 1, row: row - 1 }, ext: { width: w, height: h }, editAs: "oneCell" }); }

  /* ---------- export ---------- */
  async function exportWorkbook(o) {
    const ExcelJS = await root.FTLazy.load("excel", "ExcelJS", "Excel writer");
    const st = o.state, proj = o.proj, P = palette(), today = o.todayIso, days = proj.days;
    const catCol = c => P.resolve(o.catColor(c));
    const wb = new ExcelJS.Workbook();
    wb.creator = "Finance Toolbox"; wb.created = new Date(); wb.calcProperties = { fullCalcOnLoad: true };
    const S = sty => Object.assign({ P }, sty);
    const first = days[0].iso, last = days[days.length - 1].iso;
    const span = niceDate(first, true) + " to " + niceDate(last, true);
    const exported = "Exported " + niceDate(today, true);

    /* create the tabs in display order (formulas can point to tabs filled in later) */
    const wsDash = sheetFor(wb, SHEET.dash, P), wsCash = sheetFor(wb, SHEET.cash, P, P.income), wsCal = sheetFor(wb, SHEET.cal, P, P.good),
      wsLed = sheetFor(wb, SHEET.ledger, P, P.ink2), wsTx = sheetFor(wb, SHEET.tx, P, P.bills), wsBills = sheetFor(wb, SHEET.bills, P, P.bills),
      wsPay = sheetFor(wb, SHEET.pay, P, P.income), wsSet = sheetFor(wb, SHEET.set, P, P.muted);

    /* ===== Transactions: every projected paycheck, bill and income, one row each ===== */
    const tx = [], ACC = E.accountsOf(st), MULTI = ACC.length > 1, accName = id => (ACC.find(a => a.id === id) || ACC[0]).name;
    const srcDays = MULTI ? proj.byAccount.map(a => a.days.map(d => ({ d, acct: a.id }))).flat().sort((x, y) => x.d.day - y.d.day) : days.map(d => ({ d, acct: "main" }));
    srcDays.forEach(({ d, acct }) => d.events.forEach(e => tx.push({ iso: d.iso, name: e.name, cat: e.category || E.categoryOf({ name: e.name, type: e.amount > 0 ? "Income" : "Bill" }), amount: r2(e.amount), freq: e.frequency === "Payday" ? "Payday" : e.frequency, acct: accName(e.account || acct) })));
    title(wsTx, P, "Finance Toolbox · " + exported, "Transactions", "Every paycheck, bill and extra income in the projection. Change an amount or add a row and every other tab updates.");
    const TX0 = 6, TXN = Math.max(TX0, TX0 + tx.length - 1 + 200); /* room for 200 rows the buyer adds */
    headerRow(wsTx, TX0 - 1, 2, ["Date", "Name", "Category", "Amount", "How often", "Account"], P, [16, 34, 18, 14, 14, 20]);
    wsTx.getColumn(1).width = 3;
    tx.forEach((t, i) => {
      const r = TX0 + i, f = i % 2 ? P.surface : P.bg;
      put(wsTx, r, 2, isoDate(t.iso), S({ fill: f, fmt: DATE, align: { indent: 1 } }));
      put(wsTx, r, 3, t.name, S({ fill: f }));
      put(wsTx, r, 4, t.cat, S({ fill: f, color: P.ink2, border: { left: { style: "thick", color: argb(catCol(t.cat)) } }, align: { indent: 1 } }));
      put(wsTx, r, 5, t.amount, S({ fill: f, fmt: MONEY, color: t.amount > 0 ? P.good : P.ink, font: { bold: t.amount > 0 } }));
      put(wsTx, r, 6, t.freq, S({ fill: f, color: P.muted, font: { size: 9 } }));
      put(wsTx, r, 7, t.acct, S({ fill: f, color: P.ink2, font: { size: 9 } }));
    });
    wsTx.views = [{ state: "frozen", ySplit: TX0 - 1, showGridLines: false }];
    wsTx.autoFilter = { from: { row: TX0 - 1, column: 2 }, to: { row: TX0 - 1, column: 7 } };
    const TD = "Transactions!$B$" + TX0 + ":$B$" + TXN, TN = "Transactions!$C$" + TX0 + ":$C$" + TXN, TC = "Transactions!$D$" + TX0 + ":$D$" + TXN, TA = "Transactions!$E$" + TX0 + ":$E$" + TXN, TG = "Transactions!$G$" + TX0 + ":$G$" + TXN;
    const NOX = "," + TC + ",\"<>Transfers\""; /* money moved between your own accounts isn't income or a bill */

    /* ===== Ledger: one row per day with a running balance ===== */
    title(wsLed, P, "Finance Toolbox · " + exported, "Daily ledger", span);
    label(wsLed, 5, 2, MULTI ? "Starting balance, all accounts" : "Starting balance", P);
    put(wsLed, 5, 4, MULTI ? { formula: "SUM(" + wsLed.getColumn(9).letter + "5:" + wsLed.getColumn(8 + ACC.length).letter + "5)", result: r2(ACC.reduce((t, a) => t + E.accountStart(st, a.id), 0)) } : r2(st.projection.startingBalance), S({ fmt: MONEY, color: P.accent, font: { bold: true, size: 12 }, fill: P.surface, border: box(P.line) }));
    put(wsLed, 5, 5, "← change this to try a different start", S({ color: P.muted, font: { size: 9, italic: true } }));
    const L0 = 8, LN = L0 + days.length - 1;
    headerRow(wsLed, L0 - 1, 2, ["Date", "Day", "Money in", "Bills", "Net", "Balance", "What happens"], P, [16, 7, 13, 13, 13, 15, 60]);
    wsLed.getColumn(1).width = 3;
    days.forEach((d, i) => {
      const r = L0 + i, f = d.iso === today ? mix(P.bg, P.accent, 0.18) : i % 2 ? P.surface : P.bg, p = E.parts(E.toDay(d.iso));
      const inc = r2(d.pay + d.extra), out = r2(d.bills);
      put(wsLed, r, 2, isoDate(d.iso), S({ fill: f, fmt: 'mmm d, yyyy', align: { indent: 1 } }));
      put(wsLed, r, 3, DOW[p.dow], S({ fill: f, color: P.muted }));
      put(wsLed, r, 4, { formula: "SUMIFS(" + TA + "," + TD + ",B" + r + "," + TA + ",\">0\"" + NOX + ")", result: inc }, S({ fill: f, fmt: '"$"#,##0.00;-"$"#,##0.00;""', color: P.good }));
      put(wsLed, r, 5, { formula: "-SUMIFS(" + TA + "," + TD + ",B" + r + "," + TA + ",\"<0\"" + NOX + ")", result: out }, S({ fill: f, fmt: '"$"#,##0.00;-"$"#,##0.00;""', color: P.bills }));
      put(wsLed, r, 6, { formula: "D" + r + "-E" + r, result: r2(inc - out) }, S({ fill: f, fmt: '+"$"#,##0.00;-"$"#,##0.00;""', color: P.ink2 }));
      put(wsLed, r, 7, { formula: (i ? "G" + (r - 1) : "$D$5") + "+F" + r, result: r2(d.balance) }, S({ fill: f, fmt: MONEY, font: { bold: true } }));
      put(wsLed, r, 8, d.events.map(e => e.name).join(", "), S({ fill: f, color: P.muted, font: { size: 9 } }));
      /* one running balance per checking account (transfers included) */
      if (MULTI) ACC.forEach((a, k) => {
        const c = 9 + k, L = wsLed.getColumn(c).letter, ad = proj.byAccount[k].days[i];
        put(wsLed, r, c, { formula: (i ? L + (r - 1) : L + "$5") + "+SUMIFS(" + TA + "," + TD + ",B" + r + "," + TG + "," + L + "$" + (L0 - 1) + ")", result: r2(ad.balance) }, S({ fill: f, fmt: MONEY, color: P.ink2 }));
      });
    });
    if (MULTI) ACC.forEach((a, k) => {
      const c = 9 + k; wsLed.getColumn(c).width = 18;
      label(wsLed, 4, c, "Start", P, { align: { horizontal: "right" } });
      put(wsLed, 5, c, r2(E.accountStart(st, a.id)), S({ fmt: MONEY, color: P.accent, font: { bold: true }, fill: P.surface, border: box(P.line) }));
      const h = label(wsLed, L0 - 1, c, a.name, P, { fill: P.surface2, align: { horizontal: "right" } }); h.value = a.name; h.border = under(P.line);
      wsLed.addConditionalFormatting({ ref: wsLed.getColumn(c).letter + L0 + ":" + wsLed.getColumn(c).letter + (L0 + days.length - 1), rules: [{ type: "cellIs", operator: "lessThan", formulae: ["0"], priority: 2 + k, style: { font: { color: argb(P.neg), bold: true } } }] });
    });
    wsLed.addConditionalFormatting({ ref: "G" + L0 + ":G" + LN, rules: [{ type: "cellIs", operator: "lessThan", formulae: ["0"], priority: 1, style: { font: { color: argb(P.neg), bold: true }, fill: { type: "pattern", pattern: "solid", bgColor: argb(P.negSoft) } } }] });
    wsLed.views = [{ state: "frozen", ySplit: L0 - 1, showGridLines: false }];
    const LD = "Ledger!$B$" + L0 + ":$B$" + LN, LB = "Ledger!$G$" + L0 + ":$G$" + LN;
    const ledRow = iso => L0 + (E.toDay(iso) - E.toDay(first));

    /* ===== Projection Calendar: one block per month, live from the ledger ===== */
    title(wsCal, P, "Finance Toolbox · " + exported, "Projection Calendar", "Each day shows the change that day and your balance at the end of the day. Hover a day with a red corner to see what happens.");
    wsCal.getColumn(1).width = 3;
    for (let c = 2; c <= 8; c++) wsCal.getColumn(c).width = 16;
    const months = []; days.forEach(d => { const k = monthKey(d.iso); if (!months.includes(k)) months.push(k); });
    let r = 6;
    const netRefs = [], balRefs = [];
    months.forEach(k => {
      const y = Math.floor(k / 12), mo = k % 12;
      put(wsCal, r, 2, MONTHS[mo] + " " + y, S({ font: { name: TITLE_FONT, size: 16 } })); wsCal.getRow(r).height = 28;
      r++;
      DOW.forEach((d, i) => label(wsCal, r, 2 + i, d, P, { fill: P.surface2, align: { horizontal: "center" } }));
      r++;
      const firstDow = new Date(Date.UTC(y, mo, 1)).getUTCDay(), n = dim(k);
      const weeks = Math.ceil((firstDow + n) / 7);
      for (let w = 0; w < weeks; w++) {
        for (let c = 0; c < 7; c++) {
          const dnum = w * 7 + c - firstDow + 1, col = 2 + c;
          const iso = dnum >= 1 && dnum <= n ? E.fromDay(Math.round(Date.UTC(y, mo, dnum) / 864e5)) : null;
          const inProj = iso && iso >= first && iso <= last, d = inProj ? days[ledRow(iso) - L0] : null;
          const f = !iso ? P.bg : inProj ? P.surface : mix(P.bg, P.surface, 0.4);
          const B = argb(iso === today ? P.accent : P.line), bw = iso === today ? "medium" : "thin";
          const c1 = put(wsCal, r, col, iso ? dnum : null, S({ fill: f, color: inProj ? P.ink2 : P.muted, font: { bold: true, size: 10 }, align: { indent: 1, vertical: "bottom", horizontal: "left" } }));
          const c2 = put(wsCal, r + 1, col, inProj ? { formula: "IF(Ledger!F" + ledRow(iso) + "=0,\"\",Ledger!F" + ledRow(iso) + ")", result: d.net ? r2(d.net) : "" } : null, S({ fill: f, fmt: SIGNED0, color: P.muted, font: { size: 9 }, align: { horizontal: "right", indent: 1 } }));
          const c3 = put(wsCal, r + 2, col, inProj ? { formula: "Ledger!G" + ledRow(iso), result: r2(d.balance) } : null, S({ fill: f, fmt: MONEY0, font: { bold: true, size: 11 }, align: { horizontal: "right", indent: 1, vertical: "top" } }));
          if (iso) { c1.border = { top: { style: bw, color: B }, left: { style: bw, color: B }, right: { style: bw, color: B } }; c2.border = { left: { style: bw, color: B }, right: { style: bw, color: B } }; c3.border = { bottom: { style: bw, color: B }, left: { style: bw, color: B }, right: { style: bw, color: B } }; }
          if (d && d.events.length) c1.note = { texts: [{ text: niceDate(iso, true) + "\n" + d.events.map(e => e.name + "  " + (e.amount > 0 ? "+" : "-") + "$" + Math.abs(e.amount).toFixed(2)).join("\n") }] };
          if (inProj) { netRefs.push(c2.address); balRefs.push(c3.address); }
        }
        wsCal.getRow(r).height = 18; wsCal.getRow(r + 1).height = 15; wsCal.getRow(r + 2).height = 20;
        r += 3;
      }
      r += 1;
    });
    const sq = list => list.join(" ");
    if (netRefs.length) wsCal.addConditionalFormatting({ ref: sq(netRefs), rules: [
      { type: "cellIs", operator: "greaterThan", formulae: ["0"], priority: 1, style: { font: { color: argb(P.income), bold: true } } },
      { type: "cellIs", operator: "lessThan", formulae: ["0"], priority: 2, style: { font: { color: argb(P.bills), bold: true } } }] });
    if (balRefs.length) wsCal.addConditionalFormatting({ ref: sq(balRefs), rules: [{ type: "cellIs", operator: "lessThan", formulae: ["0"], priority: 3, style: { font: { color: argb(P.neg), bold: true }, fill: { type: "pattern", pattern: "solid", bgColor: argb(P.negSoft) } } }] });
    put(wsCal, r, 2, "■ Money in", S({ color: P.income, font: { size: 9 } })); put(wsCal, r, 3, "■ Bills", S({ color: P.bills, font: { size: 9 } })); put(wsCal, r, 4, "■ Below $0", S({ color: P.neg, font: { size: 9 } }));

    /* ===== Cash flow: month by month, plus bills by category ===== */
    title(wsCash, P, "Finance Toolbox · " + exported, "Cash flow", "Money in and out for each month of the projection. * marks a month the projection only partly covers.");
    wsCash.getColumn(1).width = 3;
    const C0 = 7;
    label(wsCash, C0 - 2, 2, "Month by month", P);
    headerRow(wsCash, C0 - 1, 2, ["Month", "Money in", "Bills", "To savings", "Left over", "Savings rate"], P, [16, 13, 13, 13, 13, 13]);
    const agg = months.map(k => ({ k, inc: 0, out: 0, sav: 0, cats: {}, n: 0 }));
    days.forEach(d => { const a = agg[months.indexOf(monthKey(d.iso))]; a.n++; d.events.forEach(e => { if (e.amount > 0) a.inc += e.amount; else { a.out -= e.amount; a.cats[e.category] = (a.cats[e.category] || 0) - e.amount; if (e.category === "Savings") a.sav -= e.amount; } }); });
    const between = (rng, k) => { const y = Math.floor(k / 12), m = k % 12 + 1; return TD + ",\">=\"&DATE(" + y + "," + m + ",1)," + TD + ",\"<\"&DATE(" + y + "," + (m + 1) + ",1)"; };
    agg.forEach((a, i) => {
      const rr = C0 + i, f = i % 2 ? P.surface : P.bg, partial = a.n < dim(a.k);
      put(wsCash, rr, 2, MONTHS[a.k % 12] + " " + Math.floor(a.k / 12) + (partial ? " *" : ""), S({ fill: f, align: { indent: 1 } }));
      put(wsCash, rr, 3, { formula: "SUMIFS(" + TA + "," + between(TD, a.k) + "," + TA + ",\">0\"" + NOX + ")", result: r2(a.inc) }, S({ fill: f, fmt: MONEY0, color: P.good }));
      put(wsCash, rr, 4, { formula: "-SUMIFS(" + TA + "," + between(TD, a.k) + "," + TA + ",\"<0\"" + NOX + ")", result: r2(a.out) }, S({ fill: f, fmt: MONEY0, color: P.bills }));
      put(wsCash, rr, 5, { formula: "-SUMIFS(" + TA + "," + between(TD, a.k) + "," + TC + ",\"Savings\")", result: r2(a.sav) }, S({ fill: f, fmt: MONEY0, color: P.ink2 }));
      put(wsCash, rr, 6, { formula: "C" + rr + "-D" + rr, result: r2(a.inc - a.out) }, S({ fill: f, fmt: '+"$"#,##0;-"$"#,##0', font: { bold: true } }));
      put(wsCash, rr, 7, { formula: "IF(C" + rr + ">0,(F" + rr + "+E" + rr + ")/C" + rr + ",\"\")", result: a.inc > 0 ? (a.inc - a.out + a.sav) / a.inc : "" }, S({ fill: f, fmt: PCT, color: P.ink2 }));
    });
    const CN = C0 + agg.length - 1;
    wsCash.addConditionalFormatting({ ref: "F" + C0 + ":F" + CN, rules: [{ type: "cellIs", operator: "lessThan", formulae: ["0"], priority: 1, style: { font: { color: argb(P.neg), bold: true } } }] });
    addPic(wb, wsCash, monthBars(agg, P), 9, C0 - 2, 600, 280);
    /* bills by category, one column per month */
    const allCats = {}; agg.forEach(a => Object.entries(a.cats).forEach(([c, v]) => allCats[c] = (allCats[c] || 0) + v));
    const catList = Object.keys(allCats).sort((a, b) => (a === "Other") - (b === "Other") || allCats[b] - allCats[a]);
    let K0 = Math.max(CN + 4, C0 + 17);
    label(wsCash, K0 - 2, 2, "Bills by category", P);
    headerRow(wsCash, K0 - 1, 2, ["Category"].concat(agg.map(a => MON[a.k % 12] + " " + String(Math.floor(a.k / 12)).slice(2))).concat(["Total"]), P);
    for (let c = 8; c <= 3 + agg.length; c++) wsCash.getColumn(c).width = Math.max(wsCash.getColumn(c).width || 11, 11);
    catList.forEach((cat, i) => {
      const rr = K0 + i, f = i % 2 ? P.surface : P.bg;
      put(wsCash, rr, 2, cat, S({ fill: f, border: { left: { style: "thick", color: argb(catCol(cat)) } }, align: { indent: 1 } }));
      agg.forEach((a, j) => put(wsCash, rr, 3 + j, { formula: "-SUMIFS(" + TA + "," + between(TD, a.k) + "," + TC + ",$B" + rr + "," + TA + ",\"<0\")", result: r2(a.cats[cat] || 0) }, S({ fill: f, fmt: '"$"#,##0;-"$"#,##0;"-"', color: P.ink2 })));
      const tc = 3 + agg.length, colL = wsCash.getColumn(3).letter, colR = wsCash.getColumn(tc - 1).letter;
      put(wsCash, rr, tc, { formula: "SUM(" + colL + rr + ":" + colR + rr + ")", result: r2(allCats[cat]) }, S({ fill: f, fmt: MONEY0, font: { bold: true } }));
    });

    /* ===== Dashboard ===== */
    title(wsDash, P, "Finance Toolbox · " + exported, "Dashboard", "Projection " + span);
    wsDash.getColumn(1).width = 3;
    for (let c = 2; c <= 13; c++) wsDash.getColumn(c).width = 11.5;
    const ti = days.findIndex(d => d.iso === today), lo = proj.low;
    const balToday = ti >= 0 ? { formula: "INDEX(" + LB + "," + (ti + 1) + ")", result: r2(days[ti].balance) } : r2(today < first ? st.projection.startingBalance : days[days.length - 1].balance);
    const np = days.find(d => d.pay > 0 && d.iso >= today);
    tile(wsDash, 6, 2, 3, "Balance today", balToday, ti >= 0 ? niceDate(today, true) : today < first ? "Projection starts " + niceDate(first, true) : "Projection ended " + niceDate(last, true), P, MONEY);
    tile(wsDash, 6, 5, 3, "Next payday", np ? r2(np.pay) : "None ahead", np ? niceDate(np.iso, true) : "No paydays left in this projection", P, MONEY, P.income);
    tile(wsDash, 6, 8, 3, "Projected ending balance", { formula: "Ledger!G" + LN, result: r2(days[days.length - 1].balance) }, "On " + niceDate(last, true), P, MONEY);
    tile(wsDash, 6, 11, 3, "Lowest point", { formula: "MIN(" + LB + ")", result: r2(lo.balance) }, { formula: "INDEX(" + LD + ",MATCH(MIN(" + LB + ")," + LB + ",0))", result: isoDate(lo.iso) }, P, MONEY, lo.balance < 0 ? P.neg : P.ink);
    addPic(wb, wsDash, balanceChart(days, today, P), 2, 11, 980, 290);
    /* upcoming 14 days */
    const UP0 = 27;
    label(wsDash, UP0 - 1, 2, "Upcoming transactions (next 14 days)", P);
    const startI = ti >= 0 ? ti : today < first ? 0 : days.length;
    const ups = []; days.slice(startI, startI + 14).forEach(d => d.events.forEach(e => ups.push([d.iso, e])));
    ups.slice(0, 14).forEach(([iso, e], i) => {
      const rr = UP0 + i, f = i % 2 ? P.surface : P.bg;
      put(wsDash, rr, 2, isoDate(iso), S({ fill: f, fmt: "ddd mmm d", color: P.muted, align: { indent: 1 } }));
      put(wsDash, rr, 3, e.name, S({ fill: f })); wsDash.mergeCells(rr, 3, rr, 5);
      put(wsDash, rr, 6, e.category, S({ fill: f, color: P.ink2, font: { size: 9 }, border: { left: { style: "thick", color: argb(catCol(e.category)) } }, align: { indent: 1 } }));
      put(wsDash, rr, 7, r2(e.amount), S({ fill: f, fmt: '+"$"#,##0.00;-"$"#,##0.00', color: e.amount > 0 ? P.good : P.ink, font: { bold: true } }));
    });
    if (!ups.length) put(wsDash, UP0, 2, "Nothing due in the next two weeks.", S({ color: P.muted }));
    /* category breakdown for this month */
    const curK = months.includes(monthKey(today)) ? monthKey(today) : months[0], ca = agg[months.indexOf(curK)];
    const cats = Object.entries(ca.cats).sort((a, b) => b[1] - a[1]), ctot = cats.reduce((s, x) => s + x[1], 0);
    label(wsDash, UP0 - 1, 9, "Category breakdown · " + MONTHS[curK % 12], P);
    cats.forEach(([cat, v], i) => {
      const rr = UP0 + i, f = i % 2 ? P.surface : P.bg;
      put(wsDash, rr, 9, cat, S({ fill: f, border: { left: { style: "thick", color: argb(catCol(cat)) } }, align: { indent: 1 } })); wsDash.mergeCells(rr, 9, rr, 11);
      put(wsDash, rr, 12, { formula: "-SUMIFS(" + TA + "," + between(TD, curK) + "," + TC + ",I" + rr + "," + TA + ",\"<0\")", result: r2(v) }, S({ fill: f, fmt: MONEY0, font: { bold: true } }));
      put(wsDash, rr, 13, { formula: "IF(SUM($L$" + UP0 + ":$L$" + (UP0 + cats.length - 1) + ")=0,\"\",L" + rr + "/SUM($L$" + UP0 + ":$L$" + (UP0 + cats.length - 1) + "))", result: ctot ? v / ctot : "" }, S({ fill: f, fmt: PCT, color: P.muted }));
    });
    const picRow = UP0 + Math.max(cats.length, Math.min(ups.length, 14)) + 2;
    addPic(wb, wsDash, donut(cats.slice(0, 8).map(([n, v]) => [n, v, catCol(n)]).concat(cats.length > 8 ? [["More", cats.slice(8).reduce((s, x) => s + x[1], 0), P.muted]] : []), ctot, MONTHS[curK % 12], P), 9, picRow, 400, 280);
    put(wsDash, picRow + 16, 2, "Charts are pictures of your numbers on the day you exported. The tiles and tables use formulas and update when you change the Transactions tab.", S({ color: P.muted, font: { size: 9, italic: true } }));

    /* ===== Bills & income (import this tab back into the app) ===== */
    title(wsBills, P, "Finance Toolbox · " + exported, "Bills & income", "Edit, add or delete rows here, then use Import from Excel in the app (Settings, Save & sync) to bring the changes back.");
    wsBills.getColumn(1).width = 3;
    const B0 = 7;
    headerRow(wsBills, B0 - 1, 2, ["Name", "Type", "Amount", "How often", "First date", "End date", "Category", "Per month", "ID", "Account", "To account"], P, [32, 10, 13, 13, 16, 16, 18, 13, 14, 20, 20]);
    const items = st.items.slice().sort((a, b) => (a.type === b.type ? 0 : a.type === "Bill" ? -1 : 1) || E.categoryOf(a).localeCompare(E.categoryOf(b)) || a.first.localeCompare(b.first));
    const rowsFor = Math.max(items.length + 50, 60);
    for (let i = 0; i < rowsFor; i++) {
      const it = items[i], rr = B0 + i, f = i % 2 ? P.surface : P.bg;
      put(wsBills, rr, 2, it ? it.name : null, S({ fill: f }));
      put(wsBills, rr, 3, it ? it.type : null, S({ fill: f, color: it && it.type === "Income" ? P.good : P.ink2 }));
      put(wsBills, rr, 4, it ? r2(it.amount) : null, S({ fill: f, fmt: MONEY, font: { bold: true } }));
      put(wsBills, rr, 5, it ? it.frequency : null, S({ fill: f, color: P.ink2 }));
      put(wsBills, rr, 6, it && it.first ? isoDate(it.first) : null, S({ fill: f, fmt: 'mmm d, yyyy' }));
      put(wsBills, rr, 7, it && it.end ? isoDate(it.end) : null, S({ fill: f, fmt: 'mmm d, yyyy', color: P.muted }));
      const cat = it ? E.categoryOf(it) : null;
      put(wsBills, rr, 8, cat, S({ fill: f, color: P.ink2, border: cat ? { left: { style: "thick", color: argb(catCol(cat)) } } : undefined, align: { indent: 1 } }));
      put(wsBills, rr, 9, { formula: "IF(B" + rr + "=\"\",\"\",IF(E" + rr + "=\"Weekly\",D" + rr + "*52/12,IF(E" + rr + "=\"Bi-Weekly\",D" + rr + "*26/12,IF(E" + rr + "=\"Monthly\",D" + rr + ",IF(E" + rr + "=\"Yearly\",D" + rr + "/12,0)))))", result: it ? r2(E.monthlyEquivalent(it)) : "" }, S({ fill: f, fmt: '"$"#,##0;-"$"#,##0;"-"', color: P.muted }));
      put(wsBills, rr, 10, it ? it.id : null, S({ fill: f, color: P.muted, font: { size: 8 } }));
      put(wsBills, rr, 11, it ? accName(it.account) : null, S({ fill: f, color: P.ink2 }));
      put(wsBills, rr, 12, it && it.type === "Transfer" ? accName(it.to) : null, S({ fill: f, color: P.ink2 }));
      const accList = '"' + ACC.map(a => a.name.replace(/[",]/g, " ")).join(",") + '"';
      wsBills.getCell(rr, 11).dataValidation = { type: "list", allowBlank: true, formulae: [accList] };
      wsBills.getCell(rr, 12).dataValidation = { type: "list", allowBlank: true, formulae: [accList] };
      wsBills.getCell(rr, 3).dataValidation = { type: "list", allowBlank: true, formulae: ['"Bill,Income,Transfer"'] };
      wsBills.getCell(rr, 5).dataValidation = { type: "list", allowBlank: true, formulae: ['"' + FREQS.join(",") + '"'] };
      wsBills.getCell(rr, 8).dataValidation = { type: "list", allowBlank: true, formulae: ['"' + E.CATEGORIES.concat(E.INCOME_CATEGORIES).join(",") + '"'] };
    }
    wsBills.views = [{ state: "frozen", ySplit: B0 - 1, showGridLines: false }];
    put(wsBills, 5, 2, "Type: Bill, Income or Transfer (set To account)  ·  How often: One-time, Weekly, Bi-Weekly, Monthly or Yearly  ·  Leave ID blank on new rows", S({ color: P.muted, font: { size: 9, italic: true } }));

    /* ===== Paycheck ===== */
    title(wsPay, P, "Finance Toolbox · " + exported, "Paycheck", "Where each paycheck goes, from your pay and take-home settings in the app.");
    wsPay.getColumn(1).width = 3; wsPay.getColumn(2).width = 34; wsPay.getColumn(3).width = 16; wsPay.getColumn(4).width = 16; wsPay.getColumn(5).width = 12;
    const inc = proj.income;
    let pr = 7;
    if (proj.depositMode) {
      headerRow(wsPay, pr - 1, 2, ["Item", "Per paycheck", "Per year"], P);
      put(wsPay, pr, 2, "Deposited to your bank", S({ fill: P.surface, align: { indent: 1 } }));
      put(wsPay, pr, 3, r2(st.income.depositAmount), S({ fill: P.surface, fmt: MONEY, color: P.good, font: { bold: true, size: 12 } }));
      put(wsPay, pr, 4, { formula: "C" + pr + "*" + inc.paychecksThisYear, result: r2(st.income.depositAmount * inc.paychecksThisYear) }, S({ fill: P.surface, fmt: MONEY0 }));
      pr += 2; put(wsPay, pr, 2, "Taxes and benefits are already taken out of a bank deposit.", S({ color: P.muted, font: { italic: true, size: 9 } })); pr += 2;
    } else {
      const ded = st.deductions, y = E.computeYearPaychecks(st, st.income.year), b = y.typical, n = y.checks.length || inc.paychecksThisYear;
      headerRow(wsPay, pr - 1, 2, ["Item", "Per paycheck", "Per year", "Share"], P);
      const rows = [["Gross pay", b.gross, y.gross, P.ink]];
      if (ded.enabled) {
        [["Federal income tax", b.federal, y.federal], ["Social Security", b.socialSecurity, y.socialSecurity], ["Medicare", b.medicare, y.medicare], ["State income tax", b.state, y.state], ["Local tax", b.local, y.local]]
          .filter(x => x[1] > 0.004).forEach(x => rows.push([x[0], -x[1], -x[2], P.bills]));
        [...b.pretax, ...b.posttax].filter(x => x.amount > 0.004).forEach(x => rows.push([x.name, -x.amount, -x.amount * n, P.ink2]));
      }
      const gr = pr;
      rows.forEach(([l, a, yr, col], i) => {
        const f = i % 2 ? P.surface : P.bg;
        put(wsPay, pr, 2, l, S({ fill: f, align: { indent: i ? 2 : 1 }, font: { bold: !i } }));
        put(wsPay, pr, 3, r2(a), S({ fill: f, fmt: MONEY, color: col }));
        put(wsPay, pr, 4, r2(yr), S({ fill: f, fmt: MONEY0, color: col }));
        put(wsPay, pr, 5, { formula: "IF($C$" + gr + "=0,\"\",ABS(C" + pr + ")/$C$" + gr + ")", result: b.gross ? Math.abs(a) / b.gross : "" }, S({ fill: f, fmt: '0.0%', color: P.muted }));
        pr++;
      });
      put(wsPay, pr, 2, "Take-home pay", S({ fill: P.surface2, font: { bold: true }, align: { indent: 1 }, border: { top: { style: "thin", color: argb(P.line) } } }));
      put(wsPay, pr, 3, { formula: "SUM(C" + gr + ":C" + (pr - 1) + ")", result: r2(ded.enabled ? b.net : b.gross) }, S({ fill: P.surface2, fmt: MONEY, color: P.good, font: { bold: true, size: 12 }, border: { top: { style: "thin", color: argb(P.line) } } }));
      put(wsPay, pr, 4, { formula: "SUM(D" + gr + ":D" + (pr - 1) + ")", result: r2(ded.enabled ? y.net : y.gross) }, S({ fill: P.surface2, fmt: MONEY0, color: P.good, font: { bold: true }, border: { top: { style: "thin", color: argb(P.line) } } }));
      put(wsPay, pr, 5, { formula: "IF($C$" + gr + "=0,\"\",C" + pr + "/$C$" + gr + ")", result: b.gross ? (ded.enabled ? b.net : b.gross) / b.gross : "" }, S({ fill: P.surface2, fmt: '0.0%', color: P.muted, border: { top: { style: "thin", color: argb(P.line) } } }));
      pr += 3;
    }
    label(wsPay, pr, 2, "Income profile", P); pr++;
    const freqName = { "Week": "Every week", "Bi-Week": "Every 2 weeks", "Semi-Month": "Twice a month", "Month": "Monthly" };
    [["Pay type", st.income.payType], ["Paid", freqName[st.income.payFrequency] || st.income.payFrequency], ["Gross per paycheck", r2(inc.paycheck), MONEY], ["Annual gross", r2(inc.annualGross), MONEY0], ["Per hour worked", r2(inc.perHourWorked), MONEY], ["Paychecks in " + st.income.year, inc.paychecksThisYear]]
      .forEach(([l, v, fm], i) => { const f = i % 2 ? P.surface : P.bg; put(wsPay, pr, 2, l, S({ fill: f, color: P.ink2, align: { indent: 1 } })); put(wsPay, pr, 3, v, S({ fill: f, fmt: fm, font: { bold: true }, align: { horizontal: "right" } })); pr++; });

    /* ===== Settings (import this tab back into the app) ===== */
    title(wsSet, P, "Finance Toolbox · " + exported, "Settings", "Your pay and projection settings. The app reads this tab when you import the file. Taxes and deductions are best changed in the app.");
    wsSet.getColumn(1).width = 3; wsSet.getColumn(2).width = 28; wsSet.getColumn(3).width = 22; wsSet.getColumn(4).width = 62;
    headerRow(wsSet, 6, 2, ["Key", "Value", "What it is"], P);
    const setRows = [["app.format", "finance-toolbox-1", "Tells the app this file came from Finance Toolbox"], ["app.exportedAt", new Date().toISOString(), "When this file was made"]]
      .concat(INC.map(k => ["income." + k, /knownPayday|paysFrom/.test(k) ? (st.income[k] ? isoDate(st.income[k]) : "") : st.income[k], LABELS[k] || k]))
      .concat(["startDate", "months", "startingBalance"].map(k => ["projection." + k, k === "startDate" ? isoDate(st.projection.startDate) : st.projection[k], LABELS[k]]))
      .concat([["deductions.json", JSON.stringify(st.deductions), "Taxes, benefits and retirement settings"]])
      .concat([["savings.json", JSON.stringify(st.savings || {}), "Savings and investments: already saved, growth rates, look-ahead"]])
      .concat([["accounts.json", JSON.stringify(E.accountsOf(st)), "Checking accounts (Main checking's starting balance is projection.startingBalance)"], ["income.depositTo", st.income.depositTo || "main", "Account paychecks go into"]]);
    setRows.forEach(([k, v, w], i) => {
      const rr = 7 + i, f = i % 2 ? P.surface : P.bg;
      put(wsSet, rr, 2, k, S({ fill: f, color: P.muted, font: { size: 9 }, align: { indent: 1 } }));
      put(wsSet, rr, 3, v, S({ fill: f, fmt: v instanceof Date ? 'mmm d, yyyy' : undefined, color: P.accent, font: { bold: true }, align: { horizontal: "left", shrinkToFit: true } }));
      put(wsSet, rr, 4, w, S({ fill: f, color: P.ink2, font: { size: 9 } }));
    });

    wb.views = [{ activeTab: 0, firstSheet: 0, visibility: "visible" }];
    const buf = await wb.xlsx.writeBuffer();
    return new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  }

  /* ---------- a small .xlsx reader (works with files saved by Excel, Google Sheets, Numbers or LibreOffice) ---------- */
  async function unzip(buf, want) {
    const u8 = new Uint8Array(buf), dv = new DataView(buf), out = {};
    let eocd = -1; for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error("This isn't an Excel (.xlsx) file.");
    let p = dv.getUint32(eocd + 16, true); const n = dv.getUint16(eocd + 10, true), dec = new TextDecoder();
    for (let k = 0; k < n; k++) {
      const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
      const name = dec.decode(u8.subarray(p + 46, p + 46 + nl)); p += 46 + nl + xl + cl;
      if (!want(name)) continue;
      const start = off + 30 + dv.getUint16(off + 26, true) + dv.getUint16(off + 28, true), data = u8.subarray(start, start + csize);
      if (method === 0) out[name] = dec.decode(data);
      else if (method === 8) {
        if (typeof DecompressionStream === "undefined") throw new Error("This browser is too old to read Excel files. Update it and try again.");
        out[name] = await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).text();
      }
    }
    return out;
  }
  async function readXlsx(buf, names) {
    const files = await unzip(buf, f => /^xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|worksheets\/[^/]+\.xml)$/.test(f));
    const xml = t => new DOMParser().parseFromString(t || "<x/>", "application/xml");
    const kids = (el, tag) => Array.from(el.getElementsByTagName("*")).filter(e => e.localName === tag);
    const shared = kids(xml(files["xl/sharedStrings.xml"]), "si").map(si => kids(si, "t").map(t => t.textContent).join(""));
    const rels = {}; kids(xml(files["xl/_rels/workbook.xml.rels"]), "Relationship").forEach(r => rels[r.getAttribute("Id")] = r.getAttribute("Target"));
    const out = {};
    kids(xml(files["xl/workbook.xml"]), "sheet").forEach(sh => {
      const nm = sh.getAttribute("name"); if (!names.includes(nm)) return;
      const rid = sh.getAttribute("r:id") || sh.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
      let target = (rels[rid] || "").replace(/^\/?xl\//, "").replace(/^\//, ""); const doc = xml(files["xl/" + target]);
      const rows = {};
      kids(doc, "c").forEach(c => {
        const m = /^([A-Z]+)(\d+)$/.exec(c.getAttribute("r") || ""); if (!m) return;
        const t = c.getAttribute("t"), v = kids(c, "v")[0], is = kids(c, "is")[0];
        let val = v ? v.textContent : null;
        if (t === "s") val = shared[+val]; else if (t === "inlineStr") val = is ? kids(is, "t").map(x => x.textContent).join("") : ""; else if (t === "b") val = val === "1"; else if (t !== "str" && t !== "e" && val != null && val !== "") val = Number(val);
        const col = m[1].split("").reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0);
        (rows[+m[2]] = rows[+m[2]] || {})[col] = val;
      });
      out[nm] = rows;
    });
    return out;
  }

  /* ---------- import: read the Bills & income and Settings tabs back ---------- */
  async function importWorkbook(file, current) {
    const data = await readXlsx(await file.arrayBuffer(), [SHEET.bills, SHEET.set]);
    const bills = data[SHEET.bills], set = data[SHEET.set];
    if (!bills || !set) throw new Error("This file doesn't have the Bills & income and Settings tabs. Choose a file made with Export to Excel.");
    const cellOf = (rows, r, c) => (rows[r] || {})[c];
    const toIso = v => typeof v === "number" ? E.fromDay(Math.round(v) - 25569) : /^\d{4}-\d{2}-\d{2}/.test(String(v || "").trim()) ? String(v).trim().slice(0, 10) : (() => { const d = new Date(String(v || "")); return isNaN(d) ? "" : new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())).toISOString().slice(0, 10); })();
    const num = v => typeof v === "number" ? v : parseFloat(String(v == null ? "" : v).replace(/[$,\s]/g, ""));
    const next = JSON.parse(JSON.stringify(current));
    Object.keys(set).map(Number).filter(r => r >= 7).forEach(rn => {
      const k = String(cellOf(set, rn, 2) || "").trim(), v = cellOf(set, rn, 3);
      const [grp, key] = k.split(".");
      if (grp === "income" && INC.includes(key)) next.income[key] = /knownPayday|paysFrom/.test(key) ? (v === "" || v == null ? "" : toIso(v)) : v == null ? "" : v;
      if (grp === "projection" && key === "startDate") next.projection.startDate = toIso(v);
      if (grp === "projection" && (key === "months" || key === "startingBalance")) next.projection[key] = num(v);
      if (k === "deductions.json") { try { next.deductions = JSON.parse(v); } catch (e) {} }
      if (k === "savings.json") { try { next.savings = JSON.parse(v); } catch (e) {} }
      if (k === "accounts.json") { try { next.accounts = JSON.parse(v); } catch (e) {} }
      if (k === "income.depositTo" && v) next.income.depositTo = String(v);
    });
    const items = [], problems = [];
    const accList = E.accountsOf(next), accId = v => { const n = String(v == null ? "" : v).trim().toLowerCase(); const a = accList.find(x => x.name.toLowerCase() === n || x.id === n); return a ? a.id : "main"; };
    Object.keys(bills).map(Number).filter(r => r >= 7).sort((a, b) => a - b).forEach(rn => {
      const g = c => cellOf(bills, rn, c);
      const name = String(g(2) == null ? "" : g(2)).trim(); if (!name) return;
      const type = /^inc/i.test(String(g(3) || "")) ? "Income" : /^tra/i.test(String(g(3) || "")) ? "Transfer" : "Bill";
      const amount = Math.abs(num(g(4)));
      const fq = String(g(5) || "").trim().toLowerCase().replace(/^bi ?weekly$/, "bi-weekly").replace(/^one ?time$/, "one-time");
      const frequency = FREQS.find(f => f.toLowerCase() === fq) || "Monthly";
      const first = g(6) == null || g(6) === "" ? "" : toIso(g(6)), end = g(7) == null || g(7) === "" ? "" : toIso(g(7));
      if (!(amount > 0) || !first) { problems.push(name + " (row " + rn + ")"); return; }
      const it = { id: String(g(10) == null ? "" : g(10)).trim() || ("x" + Math.random().toString(36).slice(2, 10)), name, type, amount, frequency, first, end: frequency === "One-time" ? "" : end, account: accId(g(11)), to: type === "Transfer" ? accId(g(12)) : "" };
      /* keep a category the buyer chose; an automatic one is figured again from the name */
      const cat = String(g(8) || "").trim();
      if (cat && cat !== E.categoryOf({ name, type })) it.category = cat;
      items.push(it);
    });
    next.items = items;
    next.isExample = false; next.updatedAt = Date.now();
    return { state: next, problems, count: items.length };
  }

  root.FTExcel = { exportWorkbook, importWorkbook };
})(window);
