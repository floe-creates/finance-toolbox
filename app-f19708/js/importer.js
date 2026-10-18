/* Statement import: reads bank statements (PDF, CSV, OFX/QFX/QBO) entirely in the browser.
   Nothing is uploaded. Produces accounts with transactions, then suggests what to add to the app:
   pay schedule updates, repeating bills and income, spending patterns, and one-time items. */
(function (root) {
  "use strict";
  const E = root.FTEngine;
  const MON3 = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

  /* ---------- small helpers ---------- */
  const iso = (y, m, d) => y + "-" + String(m).padStart(2, "0") + "-" + String(d).padStart(2, "0");
  const validDate = (y, m, d) => m >= 1 && m <= 12 && d >= 1 && d <= 31 && y > 1970 && y < 2100;
  const round2 = n => Math.round(n * 100) / 100;
  function parseDate(s, fallbackYear) {
    s = String(s || "").trim();
    let m;
    if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return validDate(+m[1], +m[2], +m[3]) ? iso(+m[1], +m[2], +m[3]) : null;
    if ((m = s.match(/^(\d{4})(\d{2})(\d{2})/))) return validDate(+m[1], +m[2], +m[3]) ? iso(+m[1], +m[2], +m[3]) : null;
    if ((m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})(?:[\/\-.](\d{2,4}))?/))) {
      let y = m[3] ? +m[3] : fallbackYear; if (y < 100) y += 2000;
      return y && validDate(y, +m[1], +m[2]) ? iso(y, +m[1], +m[2]) : null;
    }
    if ((m = s.match(/^(\d{1,2})[\s\-]([A-Za-z]{3})[a-z]*\.?[\s\-,]*(\d{2,4})?/))) {
      const mo = MON3.indexOf(m[2].toLowerCase()) + 1; let y = m[3] ? +m[3] : fallbackYear; if (y < 100) y += 2000;
      return mo && y && validDate(y, mo, +m[1]) ? iso(y, mo, +m[1]) : null;
    }
    if ((m = s.match(/^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2})(?:,?\s+(\d{4}))?/))) {
      const mo = MON3.indexOf(m[1].toLowerCase()) + 1; const y = m[3] ? +m[3] : fallbackYear;
      return mo && y && validDate(y, mo, +m[2]) ? iso(y, mo, +m[2]) : null;
    }
    return null;
  }
  /* "$1,234.56", "-$12.00", "(45.10)", "45.10 CR", "12.00-" -> signed number, sign: +1 / -1 / 0 (no explicit sign) */
  const MONEY = /\(?-?\s?\$?\s?-?\d{1,3}(?:,\d{3})*\.\d{2}\)?(?:\s?(?:CR|DR|-)(?![\d$]))?/gi;
  function money(tok) {
    const t = String(tok).trim(); if (!t) return null;
    const n = parseFloat(t.replace(/[^\d.]/g, "")); if (!isFinite(n)) return null;
    const neg = /^\(|^-|-\s*\$|\$\s*-|DR$|-$/i.test(t), pos = /CR$/i.test(t) || /^\+/.test(t);
    return { value: neg ? -n : n, explicit: neg ? -1 : pos ? 1 : 0 };
  }
  const daysBetween = (a, b) => E.toDay(b) - E.toDay(a);

  /* ---------- merchant name cleanup ---------- */
  const STOP = /^(inc|llc|ltd|corp|co|the|us|usa|pos|purchase|debit|card|visa|mc|checkcard|recurring|payment|online|pymt|pmt|ach|web|id|ppd|ccd|des|subscription|bill|billpay|pay)$/i;
  function titleCase(w) { return w.length <= 2 && /^[A-Z]+$/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase(); }
  function cleanName(raw, typeLabel) {
    let s = String(raw || "").replace(/\s+/g, " ").trim();
    let m;
    if ((m = s.match(/zelle\b.*?\bto\s+([A-Za-z][A-Za-z .'-]{1,40})$/i))) return "Zelle to " + m[1].trim().split(" ").map(titleCase).join(" ");
    if ((m = s.match(/zelle\b.*?\bfrom\s+([A-Za-z][A-Za-z .'-]{1,40})$/i))) return "Zelle from " + m[1].trim().split(" ").map(titleCase).join(" ");
    if ((m = s.match(/transfer\s+(to|from)\s+([A-Za-z]+)?.*?(?:x{2,}|\*+|ending in\s*)(\d{4})\b/i))) return "Transfer " + m[1].toLowerCase() + (m[2] && !/account/i.test(m[2]) ? " " + titleCase(m[2]) : "") + " ••" + m[3];
    if ((m = s.match(/^(.+?)\s+(?:payroll|dir dep|direct dep|salary)/i))) return m[1].replace(/\b(company|co|inc|corp|llc)\b\.?/gi, "").trim().split(" ").filter(Boolean).slice(0, 3).map(titleCase).join(" ") + " payroll";
    s = s.replace(/^(check card purchase|debit card purchase|pos purchase|point of sale|card purchase|purchase authorized on \S+|recurring (?:card )?purchase)\s*/i, "");
    s = s.replace(/^(sq|tst|sp|pp|paypal|py|dd|in)\s?\*\s?/i, "");
    /* "STORE NAME CITY, GA, US": drop the city word right before the state */
    const cityState = s.match(/^([^,\d]+?)\s+[A-Za-z.']+,\s*[A-Z]{2}(?:,?\s*(?:US|USA))?,?\s*$/);
    if (cityState && cityState[1].trim().split(/\s+/).length >= 1) s = cityState[1];
    s = s.replace(/\s+[A-Z]{2}\s+\d{5}(-\d{4})?$/, "").replace(/(?:,\s*|\s+)[A-Z]{2}(?:,?\s*(?:US|USA))?,?\s*$/, "").replace(/,\s*(?:US|USA)\s*$/, "");
    const words = s.split(/[\s,*#]+/).filter(Boolean);
    while (words.length && /\d/.test(words[0])) words.shift(); /* store numbers at the front */
    const out = [];
    for (const w of words) { if (/\d/.test(w) || /^(www|http)/i.test(w) || /\//.test(w) || (out.length && /\.(com|net|org|io)\b/i.test(w))) break; if (!STOP.test(w.replace(/\.$/, ""))) out.push(w.replace(/[.'’]+$/, "")); if (out.length === 3) break; }
    const name = out.map(titleCase).join(" ").trim();
    return name || String(typeLabel || raw || "Transaction").trim().split(" ").slice(0, 4).map(titleCase).join(" ");
  }
  const groupKey = name => { const w = name.toUpperCase().replace(/[^A-Z0-9 ]/g, "").split(" ").filter(x => x && !STOP.test(x)); return (w[0] === "ZELLE" ? w.slice(0, 3) : w.slice(0, 1)).join(" ") || name.toUpperCase(); };
  function groupName(g) {
    const ws = g.map(t => t.name.split(" "));
    const common = [];
    for (let i = 0; i < ws[0].length; i++) { if (ws.every(w => w[i] && w[i].toLowerCase() === ws[0][i].toLowerCase())) common.push(ws[0][i]); else break; }
    return common.join(" ") || titleCase(groupKey(g[0].name).toLowerCase());
  }
  const PAY_RE = /payroll|direct dep|dir dep|salary|paycheck|pay ?roll/i;
  const XFER_RE = /\btransfer\b|\bxfer\b|bank\/invest|to savings|from savings|to checking|from checking|online banking transfer|internal transfer|funds transfer/i;
  const INTEREST_RE = /interest paid|interest earned|interest credit|dividend/i;
  const BILL_RE = /netflix|spotify|hulu|disney|hbo|\bmax\b|apple\.com|icloud|youtube|prime video|amazon prime|audible|xbox|playstation|verizon|t-mobile|tmobile|at&t|\batt\b|comcast|xfinity|spectrum|\bpower\b|electric|\benergy\b|\bwater\b|utility|utilities|insurance|\bsub\b|claude|anthropic|patreon|github|dropbox|canva|geico|progressive|state farm|allstate|\brent\b|mortgage|\bloan\b|navient|nelnet|sallie|mohela|planet fitness|la fitness|ymca|gym|membership|subscription|google \*|microsoft|adobe|chatgpt|openai/i;

  /* ---------- PDF ---------- */
  /* Opened straight from disk (file://) the page has no real origin. Safari then refuses to start pdf.js's
     background worker and the read never finishes, so in that case the PDF reader runs inside the page instead:
     loading the worker script as a normal script makes pdf.js use it directly (no Worker, no importScripts). */
  const fromDisk = () => { try { return location.protocol === "file:" || location.origin === "null"; } catch (e) { return true; } };
  function loadPdfJs() {
    return root.FTLazy.load("pdf", "pdfjsLib", "PDF reader").then(lib => {
      lib.GlobalWorkerOptions.workerSrc = root.FTLazy.url("pdfWorker");
      return fromDisk() ? root.FTLazy.load("pdfWorker", "pdfjsWorker", "PDF reader").then(() => lib) : lib;
    });
  }
  const timeLimit = (promise, ms, msg) => Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error(msg)), ms))]);
  async function pdfLines(buf) {
    const lib = await loadPdfJs();
    const doc = await timeLimit(lib.getDocument({ data: buf, isEvalSupported: false }).promise, 45000,
      "This PDF took too long to open. Try again, or download a CSV or OFX file from your bank instead.");
    const lines = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const tc = await (await doc.getPage(p)).getTextContent();
      const rows = [];
      for (const it of tc.items) {
        if (!it.str || !it.str.trim()) continue;
        const x = it.transform[4], y = it.transform[5];
        let row = rows.find(r => Math.abs(r.y - y) < 2.5);
        if (!row) { row = { y, items: [] }; rows.push(row); }
        row.items.push({ x, w: it.width || 0, s: it.str });
      }
      rows.sort((a, b) => b.y - a.y);
      for (const r of rows) {
        r.items.sort((a, b) => a.x - b.x);
        let text = "", end = null;
        for (const it of r.items) { if (end !== null) text += it.x - end > 6 ? "   " : it.x - end > 0.8 ? " " : ""; text += it.s; end = it.x + it.w; }
        lines.push({ text: text.replace(/\s+$/, ""), x: r.items[0].x, page: p });
      }
    }
    if (!lines.some(l => /\d/.test(l.text))) throw new Error("This PDF has no readable text (it may be a scanned image). Download the statement as CSV or OFX from your bank instead.");
    return lines;
  }
  const FOOTER = /page \d|member fdic|statement date|customer care|customer service|www\.|toll free|^\s*date\s+description|^\s*activity\s*$|continued|^\s*\d{5,}[\/-]|\d{12,}|summary for|account number|^\s*balance\s*$/i;

  function parseLines(lines, fileName) {
    const all = lines.map(l => l.text).join("\n");
    let yearHint = null, m;
    if ((m = all.match(/statement (?:date|period|closing date)[^\d]{0,40}(\d{1,2}\/\d{1,2}\/(\d{2,4}))/i))) yearHint = +m[2] < 100 ? 2000 + +m[2] : +m[2];
    if (!yearHint && (m = all.match(/\b\d{1,2}\/\d{1,2}\/(20\d{2})\b/))) yearHint = +m[1];
    if (!yearHint && (m = all.match(/\b(20\d{2})\b/))) yearHint = +m[1];
    const accounts = []; let acct = null, last = null;
    const newAcct = (num) => { acct = { id: "a" + accounts.length, number: num || "", label: "", transactions: [], beginBalance: null, beginDate: null, endBalance: null, endDate: null, prevBal: null }; accounts.push(acct); last = null; return acct; };
    for (let i = 0; i < lines.length; i++) {
      const L = lines[i], t = L.text.trim();
      if ((m = t.match(/account\s*(?:number|no\.?|#)\s*:?\s*([x*•\d][x*•\d\- ]*\d{3,4})/i))) { newAcct(m[1].replace(/\D/g, "").slice(-4)); continue; }
      if (acct && !acct.label && (m = t.match(/^(?:product|account type)\s*:\s*(.+?)(?:\s{3,}|$)/i))) { acct.label = m[1].trim(); continue; }
      const date = parseDate(t, yearHint);
      const toks = t.match(MONEY) || [];
      if (!date) {
        if ((m = t.match(/(ending|closing|new) balance[^$\d-]*(?:as of\s*)?(\d{1,2}\/\d{1,2}\/\d{2,4})?.*?(-?\$?-?[\d,]+\.\d{2})\s*$/i))) { if (!acct) newAcct(""); if (acct.endBalance == null) { acct.endBalance = money(m[3]).value; if (m[2]) acct.endDate = parseDate(m[2], yearHint); } }
        /* description continues on the next lines, indented past the date */
        if (last && !toks.length && L.x > last.x + 15 && !FOOTER.test(t) && last.cont < 4 && t.length < 90) { last.tx.raw += " " + t; last.cont++; }
        else if (last && (FOOTER.test(t) || toks.length)) last = null;
        continue;
      }
      if (!toks.length) { last = null; continue; }
      if (!acct) newAcct("");
      const dateTok = t.match(/^\S+(?:\s+\d{1,2},?\s+\d{4})?/)[0];
      const firstMoney = t.indexOf(toks[0], dateTok.length);
      const desc = t.slice(dateTok.length, firstMoney).replace(/\s{2,}/g, " ").trim();
      const vals = toks.map(money).filter(Boolean);
      if (/beginning balance|previous balance|opening balance|starting balance|balance forward/i.test(desc)) { acct.beginBalance = vals[vals.length - 1].value; acct.beginDate = date; acct.prevBal = acct.beginBalance; last = null; continue; }
      if (/ending balance|closing balance|new balance/i.test(desc)) { acct.endBalance = vals[vals.length - 1].value; acct.endDate = date; last = null; continue; }
      if (/^total|^subtotal/i.test(desc)) { last = null; continue; }
      let amount = null, balance = null;
      if (vals.length >= 2) {
        balance = vals[vals.length - 1].value;
        if (acct.prevBal != null) { const diff = round2(balance - acct.prevBal); if (vals.slice(0, -1).some(v => Math.abs(Math.abs(v.value) - Math.abs(diff)) < 0.015 || Math.abs(Math.abs(vals[0].value) - Math.abs(vals[1] ? vals[1].value : 0) - Math.abs(diff)) < 0.015)) amount = diff; }
        if (amount == null) amount = vals.length >= 3 ? round2(Math.abs(vals[0].value) - Math.abs(vals[1].value)) : vals[0].value;
      } else amount = vals[0].value;
      if (vals.length < 2 && !vals[0].explicit) amount = (PAY_RE.test(desc) || /deposit|credit|refund|interest/i.test(desc) ? 1 : -1) * Math.abs(amount);
      if (balance != null) acct.prevBal = balance;
      if (Math.abs(amount) < 0.005) { last = null; continue; }
      const tx = { date, type: desc, raw: "", amount: round2(amount), balance };
      acct.transactions.push(tx);
      last = { tx, x: L.x, cont: 0 };
    }
    return finishAccounts(accounts.filter(a => a.transactions.length || a.endBalance != null), fileName);
  }

  /* ---------- CSV ---------- */
  function csvRows(text) {
    const rows = []; let row = [], f = "", q = false;
    const delim = (text.split("\n")[0].match(/\t/g) || []).length > (text.split("\n")[0].match(/,/g) || []).length ? "\t" : (text.split("\n")[0].match(/;/g) || []).length > (text.split("\n")[0].match(/,/g) || []).length ? ";" : ",";
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
      else if (c === '"') q = true;
      else if (c === delim) { row.push(f.trim()); f = ""; }
      else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(f.trim()); rows.push(row); row = []; f = ""; }
      else f += c;
    }
    if (f || row.length) { row.push(f.trim()); rows.push(row); }
    return rows.filter(r => r.some(x => x));
  }
  function parseCsv(text, fileName) {
    const rows = csvRows(text);
    let hi = rows.findIndex((r, i) => i < 15 && r.some(c => /date/i.test(c)) && r.some(c => /amount|debit|credit|withdraw|deposit/i.test(c)));
    if (hi < 0) throw new Error("Couldn't find the column headers (Date, Description, Amount) in this CSV.");
    const h = rows[hi].map(c => c.toLowerCase());
    const find = (re, not) => h.findIndex(c => re.test(c) && !(not && not.test(c)));
    let di = find(/posted|post date|posting date/); if (di < 0) di = find(/date/);
    let ni = find(/description/); if (ni < 0) ni = find(/payee|merchant|^name$|narrative|^transaction$/); if (ni < 0) ni = find(/details/); if (ni < 0) ni = find(/memo/);
    const mi = find(/memo|note/, /description/);
    const ai = find(/^amount$|^amount \(|transaction amount|^amt$|^value$/);
    const wi = find(/debit|withdraw|money out|paid out|^charge/, /credit.*debit|indicator|type/);
    const ci = find(/credit|deposit|money in|paid in/, /credit.*debit|indicator|type|card/);
    const ti = find(/indicator|credit\/debit|debit\/credit|^type$|transaction type/);
    const bi = find(/balance/);
    if (di < 0 || (ai < 0 && wi < 0 && ci < 0)) throw new Error("This CSV needs a date column and an amount (or debit and credit) column.");
    const acct = { id: "a0", number: "", label: (fileName || "CSV").replace(/\.[^.]+$/, ""), transactions: [], beginBalance: null, beginDate: null, endBalance: null, endDate: null };
    const body = rows.slice(hi + 1);
    for (const r of body) {
      const date = parseDate(r[di]); if (!date) continue;
      let amount;
      if (ai >= 0 && r[ai] !== undefined && r[ai] !== "") { const v = money(r[ai].includes(".") ? r[ai] : r[ai] + ".00"); amount = v ? v.value : null; if (ti >= 0 && /debit|withdraw|dr\b/i.test(r[ti] || "")) amount = -Math.abs(amount); else if (ti >= 0 && /credit|deposit|cr\b/i.test(r[ti] || "")) amount = Math.abs(amount); }
      else { const w = wi >= 0 ? money(r[wi] && !r[wi].includes(".") ? r[wi] + ".00" : r[wi]) : null, c = ci >= 0 ? money(r[ci] && !r[ci].includes(".") ? r[ci] + ".00" : r[ci]) : null; amount = (c ? Math.abs(c.value) : 0) - (w ? Math.abs(w.value) : 0); }
      if (amount == null || Math.abs(amount) < 0.005) continue;
      const desc = [ni >= 0 ? r[ni] : "", mi >= 0 && mi !== ni ? r[mi] : ""].filter(Boolean).join(" ");
      const bal = bi >= 0 ? money(r[bi]) : null;
      acct.transactions.push({ date, type: ti >= 0 ? r[ti] || "" : "", raw: desc, amount: round2(amount), balance: bal ? bal.value : null });
    }
    if (bi >= 0 && acct.transactions.length) {
      const tx = acct.transactions, desc = tx[0].date > tx[tx.length - 1].date;
      const newest = desc ? tx[0] : tx[tx.length - 1], oldest = desc ? tx[tx.length - 1] : tx[0];
      if (newest.balance != null) { acct.endBalance = newest.balance; acct.endDate = newest.date; }
      if (oldest.balance != null) { acct.beginBalance = round2(oldest.balance - oldest.amount); acct.beginDate = oldest.date; }
    }
    return finishAccounts([acct], fileName);
  }

  /* ---------- OFX / QFX / QBO ---------- */
  function parseOfx(text, fileName) {
    const tag = (blk, t) => { const m = blk.match(new RegExp("<" + t + ">([^<\\r\\n]*)", "i")); return m ? m[1].trim() : ""; };
    const blocks = text.split(/<(?:STMTRS|CCSTMTRS)>/i).slice(1);
    if (!blocks.length) throw new Error("This doesn't look like an OFX, QFX or QBO file.");
    const accounts = blocks.map((b, i) => {
      const acct = { id: "a" + i, number: tag(b, "ACCTID").slice(-4), label: tag(b, "ACCTTYPE") ? titleCase(tag(b, "ACCTTYPE")) : /CCSTMTRS/i.test(text) ? "Credit card" : "", transactions: [], beginBalance: null, beginDate: null, endBalance: null, endDate: null };
      for (const t of b.split(/<STMTTRN>/i).slice(1)) {
        const date = parseDate(tag(t, "DTPOSTED")), amt = parseFloat(tag(t, "TRNAMT"));
        if (!date || !isFinite(amt) || Math.abs(amt) < 0.005) continue;
        acct.transactions.push({ date, type: titleCase(tag(t, "TRNTYPE") || ""), raw: [tag(t, "NAME"), tag(t, "MEMO")].filter(Boolean).join(" "), amount: round2(amt), balance: null });
      }
      const lb = b.split(/<LEDGERBAL>/i)[1];
      if (lb) { acct.endBalance = parseFloat(tag(lb, "BALAMT")); acct.endDate = parseDate(tag(lb, "DTASOF")); }
      const end = parseDate(tag(b, "DTEND")), start = parseDate(tag(b, "DTSTART"));
      if (end && !acct.endDate) acct.endDate = end;
      if (acct.endBalance != null && isFinite(acct.endBalance)) { acct.beginBalance = round2(acct.endBalance - acct.transactions.reduce((s, t) => s + t.amount, 0)); acct.beginDate = start || null; }
      return acct;
    });
    return finishAccounts(accounts, fileName);
  }

  /* ---------- shared finishing: names, ids, period, totals check ---------- */
  function finishAccounts(accounts, fileName) {
    accounts.forEach((a, i) => {
      a.transactions.sort((x, y) => x.date < y.date ? -1 : x.date > y.date ? 1 : 0);
      a.transactions.forEach((t, j) => { t.id = a.id + "-" + j; t.name = cleanName(t.raw || t.type, t.type); t.text = (t.type + " " + t.raw).trim(); });
      const tx = a.transactions;
      a.firstDate = a.beginDate || (tx[0] && tx[0].date) || null;
      a.lastDate = a.endDate || (tx.length && tx[tx.length - 1].date) || null;
      a.moneyIn = round2(tx.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0));
      a.moneyOut = round2(-tx.filter(t => t.amount < 0).reduce((s, t) => s + t.amount, 0));
      a.balanced = a.beginBalance != null && a.endBalance != null ? Math.abs(a.beginBalance + a.moneyIn - a.moneyOut - a.endBalance) < 0.015 : null;
      a.label = (a.label || (accounts.length > 1 ? "Account" : (fileName || "Account").replace(/\.[^.]+$/, ""))) + (a.number && !String(a.label || "").includes("••" + a.number) ? " ••" + a.number : "");
      a.file = fileName; delete a.prevBal;
    });
    return accounts;
  }

  async function readFile(file) {
    const name = file.name || "statement", ext = (name.split(".").pop() || "").toLowerCase();
    const head = new Uint8Array(await file.slice(0, 5).arrayBuffer());
    const isPdf = head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46;
    if (isPdf || ext === "pdf") return parseLines(await pdfLines(await file.arrayBuffer()), name);
    const text = await file.text();
    if (/<OFX>|OFXHEADER|<STMTTRN>/i.test(text) || /^(ofx|qfx|qbo)$/.test(ext)) return parseOfx(text, name);
    if (/^(csv|tsv|txt)$/.test(ext) || text.split("\n")[0].split(",").length > 2) return parseCsv(text, name);
    throw new Error("“" + name + "” isn't a supported statement. Use a PDF, CSV, OFX, QFX or QBO file.");
  }
  /* Several files: same account numbers merge, duplicate transactions are dropped */
  async function readFiles(files) {
    const out = [], errors = [];
    for (const f of files) { try { out.push(...await readFile(f)); } catch (e) { errors.push((f.name || "File") + ": " + e.message); } }
    const merged = [];
    for (const a of out) {
      const twin = merged.find(b => (a.number && b.number === a.number) || (!a.number && !b.number && a.label === b.label));
      if (!twin) { merged.push(a); continue; }
      const seen = new Set(twin.transactions.map(t => t.date + "|" + t.amount + "|" + t.text));
      a.transactions.forEach(t => { const k = t.date + "|" + t.amount + "|" + t.text; if (!seen.has(k)) { seen.add(k); twin.transactions.push(t); } });
      if (a.lastDate > twin.lastDate) { twin.lastDate = a.lastDate; twin.endBalance = a.endBalance; twin.endDate = a.endDate; }
      if (a.firstDate < twin.firstDate) { twin.firstDate = a.firstDate; twin.beginBalance = a.beginBalance; twin.beginDate = a.beginDate; }
      twin.file += ", " + a.file;
      finishAccounts([twin], twin.file);
    }
    merged.forEach((a, i) => { a.id = "a" + i; a.transactions.forEach((t, j) => t.id = a.id + "-" + j); });
    return { accounts: merged, errors };
  }

  /* ---------- suggestions ---------- */
  const FREQ_DAYS = [["Weekly", 7, 2], ["Bi-Weekly", 14, 2], ["Monthly", 30.4, 4], ["Yearly", 365, 10]];
  function nextDate(dateIso, freq) {
    if (freq === "Weekly") return E.fromDay(E.toDay(dateIso) + 7);
    if (freq === "Bi-Weekly") return E.fromDay(E.toDay(dateIso) + 14);
    if (freq === "Monthly") return E.addMonths(dateIso, 1);
    if (freq === "Yearly") return E.addMonths(dateIso, 12);
    return dateIso;
  }
  const median = a => { const s = a.slice().sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0; };
  function analyze(acct) {
    const tx = acct.transactions, rows = [];
    const periodDays = Math.max(7, (acct.firstDate && acct.lastDate ? daysBetween(acct.firstDate, acct.lastDate) + 1 : 30));
    const used = new Set();
    /* paychecks */
    const pays = tx.filter(t => t.amount > 0 && PAY_RE.test(t.text));
    if (pays.length) {
      const gaps = pays.slice(1).map((t, i) => daysBetween(pays[i].date, t.date));
      const g = median(gaps);
      const freq = !gaps.length ? null : Math.abs(g - 7) <= 2 ? "Week" : Math.abs(g - 14) <= 2 ? "Bi-Week" : g >= 13 && g <= 17 ? "Semi-Month" : g >= 26 && g <= 35 ? "Month" : null;
      rows.push({ id: "pay", group: "pay", name: pays[0].name, amount: round2(pays.reduce((s, t) => s + t.amount, 0) / pays.length), count: pays.length, dates: pays.map(t => t.date), txs: pays, payFreq: freq, last: pays[pays.length - 1].date, action: "deposit" });
      pays.forEach(t => used.add(t.id));
    }
    /* transfers between accounts */
    tx.filter(t => !used.has(t.id) && XFER_RE.test(t.text)).forEach(t => { used.add(t.id); rows.push({ id: t.id, group: "transfer", name: t.name === t.type ? "Transfer" : t.name, type: t.amount > 0 ? "Income" : "Bill", amount: Math.abs(t.amount), count: 1, dates: [t.date], txs: [t], last: t.date, action: "skip" }); });
    /* repeating: same merchant, same direction */
    const groups = {};
    tx.filter(t => !used.has(t.id)).forEach(t => { const k = (t.amount > 0 ? "+" : "-") + groupKey(t.name); (groups[k] = groups[k] || []).push(t); });
    Object.values(groups).forEach(g => {
      if (g.length < 2) return;
      const amts = g.map(t => Math.abs(t.amount)), gaps = g.slice(1).map((t, i) => daysBetween(g[i].date, t.date)), gap = median(gaps);
      const steady = Math.max(...amts) / Math.max(0.01, Math.min(...amts)) < 1.15;
      const fit = FREQ_DAYS.find(([, d, tol]) => gaps.every(x => Math.abs(x - d) <= tol + (d > 20 ? 1 : 0)));
      const type = g[0].amount > 0 ? "Income" : "Bill";
      if (fit && steady) {
        g.forEach(t => used.add(t.id));
        rows.push({ id: "r" + g[0].id, group: "repeat", name: groupName(g), type, amount: round2(median(amts)), count: g.length, dates: g.map(t => t.date), txs: g, last: g[g.length - 1].date, action: fit[0], suggested: fit[0] });
      } else if (g.length >= 3) {
        g.forEach(t => used.add(t.id));
        const total = amts.reduce((s, a) => s + a, 0);
        rows.push({ id: "p" + g[0].id, group: "pattern", name: groupName(g), type, amount: round2(total * 7 / periodDays), total: round2(total), count: g.length, dates: g.map(t => t.date), txs: g, last: acct.lastDate, action: "Weekly", suggested: "Weekly", avg: true });
      }
    });
    /* everything else */
    tx.filter(t => !used.has(t.id)).forEach(t => {
      const billLike = BILL_RE.test(t.text) || /ach withdrawal|ach debit|autopay|auto pay|bill pay/i.test(t.text);
      rows.push({ id: t.id, group: INTEREST_RE.test(t.text) ? "other" : billLike ? "likely" : "other", name: t.name, type: t.amount > 0 ? "Income" : "Bill", amount: Math.abs(t.amount), count: 1, dates: [t.date], txs: [t], last: t.date, action: billLike ? "Monthly" : "skip", suggested: billLike ? "Monthly" : null });
    });
    /* one weekly average for all the one-off spending, so the projection doesn't assume it stops */
    const singles = rows.filter(r => r.group === "other" && r.type === "Bill");
    if (singles.length >= 3) {
      const total = singles.reduce((s, r) => s + r.amount, 0);
      rows.push({ id: "misc", group: "pattern", name: "Other spending", type: "Bill", amount: round2(total * 7 / periodDays), total: round2(total), count: singles.length, dates: [], txs: [], last: acct.lastDate, action: "Weekly", suggested: "Weekly", avg: true, misc: true });
    }
    return { rows, periodDays };
  }

  /* Turn the reviewed rows into changes to the app's data */
  function buildPlan(acct, rows, opts) {
    const items = [], plan = { items, setPay: null, projection: null };
    const replay = opts.start === "replay";
    for (const r of rows) {
      if (r.group === "pay") {
        if (r.action === "skip") continue;
        const useDeposit = r.action === "deposit";
        plan.setPay = { knownPayday: r.last, payFrequency: r.payFreq || null, deposit: useDeposit ? round2(r.amount) : null, paysFrom: "" };
        /* replay: the real deposits play back as they happened, projected paychecks start after the statement */
        if (replay && useDeposit) { r.txs.forEach(t => items.push({ name: r.name, type: "Income", amount: Math.abs(t.amount), frequency: "One-time", first: t.date })); plan.setPay.paysFrom = E.fromDay(E.toDay(acct.lastDate) + 1); }
        continue;
      }
      if (r.action === "skip") continue;
      if (replay) r.txs.forEach(t => items.push({ name: r.name, type: t.amount > 0 ? "Income" : "Bill", amount: Math.abs(t.amount), frequency: "One-time", first: t.date }));
      if (r.action !== "One-time") {
        const first = r.avg ? E.fromDay(E.toDay(acct.lastDate) + 1) : nextDate(r.last, r.action);
        items.push({ name: r.name, type: r.type, amount: r.amount, frequency: r.action, first });
      } else if (!replay) r.txs.forEach(t => items.push({ name: r.name, type: t.amount > 0 ? "Income" : "Bill", amount: Math.abs(t.amount), frequency: "One-time", first: t.date }));
    }
    if (opts.start === "end" && acct.endBalance != null && acct.lastDate) plan.projection = { startDate: E.fromDay(E.toDay(acct.lastDate) + 1), startingBalance: acct.endBalance };
    if (replay && acct.beginBalance != null && acct.firstDate) plan.projection = { startDate: acct.firstDate, startingBalance: acct.beginBalance };
    return plan;
  }

  root.FTImport = { readFile, readFiles, analyze, buildPlan, cleanName, parseCsv, parseOfx, parseLines, parseDate, nextDate };
})(typeof window !== "undefined" ? window : globalThis);
