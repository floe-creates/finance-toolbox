/* Finance Toolbox calculation engine.
   Pure functions, no DOM. Mirrors the formulas in the Finance Toolbox Google Sheet
   (Income Estimation Calculator + Finance Projection tabs).
   Dates are ISO strings "YYYY-MM-DD"; internally they become whole day numbers. */
(function (root) {
  "use strict";

  const DAY = 86400000;
  const PERIODS_PER_YEAR = { "Week": 52, "Bi-Week": 26, "Semi-Month": 24, "Month": 12 };

  function toDay(iso) {
    const [y, m, d] = String(iso).split("-").map(Number);
    return Math.round(Date.UTC(y, m - 1, d) / DAY);
  }
  function fromDay(n) {
    const dt = new Date(n * DAY);
    return dt.getUTCFullYear() + "-" + String(dt.getUTCMonth() + 1).padStart(2, "0") + "-" + String(dt.getUTCDate()).padStart(2, "0");
  }
  function parts(n) { const dt = new Date(n * DAY); return { y: dt.getUTCFullYear(), m: dt.getUTCMonth(), d: dt.getUTCDate(), dow: dt.getUTCDay() }; }
  function lastDayOfMonth(y, m) { return new Date(Date.UTC(y, m + 1, 0)).getUTCDate(); }
  /* Positive modulo, like Sheets MOD for negative numbers */
  function mod(a, b) { return ((a % b) + b) % b; }
  /* EDATE: same day N months later, clamped to month end */
  function addMonths(iso, months) {
    const p = parts(toDay(iso));
    const tm = p.m + months, y = p.y + Math.floor(tm / 12), m = mod(tm, 12);
    const d = Math.min(p.d, lastDayOfMonth(y, m));
    return fromDay(Math.round(Date.UTC(y, m, d) / DAY));
  }
  /* Mon-Fri days in a calendar year (NETWORKDAYS with no holiday list) */
  function weekdaysInYear(year) {
    const a = Math.round(Date.UTC(year, 0, 1) / DAY), b = Math.round(Date.UTC(year, 11, 31) / DAY);
    let n = 0;
    for (let i = a; i <= b; i++) { const w = parts(i).dow; if (w !== 0 && w !== 6) n++; }
    return n;
  }
  function num(v, dflt = 0) { const n = Number(v); return Number.isFinite(n) ? n : dflt; }

  /* ---------- Income Estimation Calculator ---------- */
  function computeIncome(s) {
    const amount = num(s.amount), hours = num(s.hoursPerWeek), days = num(s.daysPerWeek);
    const holidays = num(s.paidHolidays), pto = num(s.paidPto), unpaid = num(s.unpaidDays);
    const otAfter = num(s.overtimeAfter, 40), mult = num(s.overtimeMultiplier, 1.5);
    const hourly = s.payType === "Hourly";

    const workdays = weekdaysInYear(num(s.year, new Date().getFullYear())) * days / 5;
    const hoursPerDay = days === 0 ? 0 : hours / days;
    const daysWorked = workdays - holidays - pto - unpaid;
    const hoursWorked = daysWorked * hoursPerDay;
    const regularHours = Math.min(hours, otAfter);
    const overtimeHours = Math.max(0, hours - otAfter);
    const weightedHours = regularHours + overtimeHours * mult;

    const perYear = {
      "Hour": (hourly ? weightedHours : hours) * 52, "Day": days * 52, "Week": 52, "Bi-Week": 26,
      "Semi-Month": 24, "Month": 12, "Quarter": 4, "Year": 1
    }[s.per] ?? 1;
    const annual52 = amount * perYear;
    const baseRate = hourly ? (weightedHours === 0 ? 0 : annual52 / (52 * weightedHours))
                            : (hours === 0 ? 0 : annual52 / (52 * hours));
    const leaveHoursPerDay = Math.min(hoursPerDay, days === 0 ? 0 : otAfter / days);
    const annualGross = hourly
      ? baseRate * ((days === 0 ? 0 : daysWorked / days) * weightedHours + (holidays + pto) * leaveHoursPerDay)
      : (workdays === 0 ? 0 : annual52 * (workdays - unpaid) / workdays);

    const periods = PERIODS_PER_YEAR[s.payFrequency] || 26;
    const paycheck = annualGross / periods;
    const paychecksThisYear = countPaydaysInYear(s, num(s.year, new Date().getFullYear()));

    return {
      workdays, hoursPerDay, daysWorked, hoursWorked, regularHours, overtimeHours, weightedHours,
      annual52, baseRate, annualGross, paycheck, paychecksThisYear,
      paidOutThisYear: paycheck * paychecksThisYear,
      perHourWorked: hoursWorked === 0 ? 0 : annualGross / hoursWorked,
      perDayWorked: daysWorked === 0 ? 0 : annualGross / daysWorked,
      weekly: annualGross / 52, biweekly: annualGross / 26, semimonthly: annualGross / 24,
      monthly: annualGross / 12, quarterly: annualGross / 4
    };
  }

  /* ---------- paydays ---------- */
  function isPayday(day, s) {
    const known = toDay(s.knownPayday);
    const p = parts(day), last = lastDayOfMonth(p.y, p.m);
    switch (s.payFrequency) {
      case "Week": return mod(day - known, 7) === 0;
      case "Bi-Week": return mod(day - known, 14) === 0;
      case "Semi-Month": return p.d === 15 || p.d === last;
      case "Month": return p.d === Math.min(parts(known).d, last);
      default: return false;
    }
  }
  function countPaydaysInYear(s, year) {
    const a = Math.round(Date.UTC(year, 0, 1) / DAY), b = Math.round(Date.UTC(year, 11, 31) / DAY);
    let n = 0; for (let i = a; i <= b; i++) if (isPayday(i, s)) n++;
    return n;
  }

  /* ---------- bills and extra income ---------- */
  const FREQUENCIES = ["One-time", "Weekly", "Bi-Weekly", "Monthly", "Yearly"];
  function occursOn(item, day) {
    if (!item.first) return false;
    const f = toDay(item.first);
    if (day < f) return false;
    if (item.end && day > toDay(item.end)) return false;
    const p = parts(day), fp = parts(f), last = lastDayOfMonth(p.y, p.m);
    const dueDay = Math.min(fp.d, last);
    switch (item.frequency) {
      case "One-time": return day === f;
      case "Weekly": return mod(day - f, 7) === 0;
      case "Bi-Weekly": return mod(day - f, 14) === 0;
      case "Monthly": return p.d === dueDay;
      case "Yearly": return p.m === fp.m && p.d === dueDay;
      default: return false;
    }
  }
  function monthlyEquivalent(item) {
    const a = num(item.amount);
    return { "Weekly": a * 52 / 12, "Bi-Weekly": a * 26 / 12, "Monthly": a, "Yearly": a / 12 }[item.frequency] || 0;
  }


  /* ---------- taxes, benefits and retirement taken out of each paycheck ----------
     Estimates use the annualized method: this paycheck's wages x paychecks per year,
     minus the standard deduction, run through the brackets, then divided back per paycheck.
     Treatments: "pretax"     lowers income tax only (traditional 401(k), 403(b), 457)
                 "pretax-all" lowers income tax and Social Security/Medicare (health, dental, vision, HSA, FSA)
                 "posttax"    taken after taxes (Roth 401(k), union dues, life insurance, garnishments) */
  const TREATMENTS = ["pretax", "pretax-all", "posttax"];
  const FILING = ["Single", "Married", "HoH", "MFS"];
  function defaultDeductions() {
    return { enabled: false, filingStatus: "Single",
      federal: { mode: "auto", value: 0, extra: 0, credits: 0 },
      socialSecurity: true, medicare: true,
      state: { mode: "auto", code: "", value: 0, localPercent: 0 },
      items: [] };
  }
  function progressive(income, brackets) {
    if (!brackets || income <= 0) return 0;
    let tax = 0;
    for (let i = 0; i < brackets.length; i++) {
      const [lo, rate] = brackets[i], hi = i + 1 < brackets.length ? brackets[i + 1][0] : Infinity;
      if (income > lo) tax += (Math.min(income, hi) - lo) * rate;
    }
    return tax;
  }
  function dedAmount(it, gross) { return it.unit === "%" ? gross * num(it.value) / 100 : num(it.value); }
  /* ytd = { ss, med } wages already taxed this calendar year (for the Social Security cap and extra Medicare) */
  function computePaycheck(d, gross, periods, ytd = { ss: 0, med: 0 }) {
    const T = root.FTTax, out = { gross, pretax: [], posttax: [], federal: 0, socialSecurity: 0, medicare: 0, state: 0, local: 0 };
    let preIncome = 0, preFica = 0;
    for (const it of d.items || []) {
      const amt = Math.max(0, dedAmount(it, gross)), row = { id: it.id, name: it.name, amount: amt, treatment: it.treatment };
      if (it.treatment === "posttax") out.posttax.push(row);
      else { out.pretax.push(row); preIncome += amt; if (it.treatment === "pretax-all") preFica += amt; }
    }
    const incomeWages = Math.max(0, gross - preIncome), ficaWages = Math.max(0, gross - preFica);
    const status = FILING.includes(d.filingStatus) ? d.filingStatus : "Single";
    const f = d.federal || {};
    if (f.mode === "auto") {
      const fed = T.FEDERAL[status];
      const annual = Math.max(0, progressive(Math.max(0, incomeWages * periods - fed.std), fed.brackets) - num(f.credits));
      out.federal = annual / periods + num(f.extra);
    } else if (f.mode === "percent") out.federal = incomeWages * num(f.value) / 100 + num(f.extra);
    else if (f.mode === "amount") out.federal = num(f.value) + num(f.extra);
    if (d.socialSecurity) out.socialSecurity = Math.min(ficaWages, Math.max(0, T.FICA.ssWageBase - ytd.ss)) * T.FICA.ssRate;
    if (d.medicare) {
      const th = T.FICA.addlMedicareThreshold, over = Math.max(0, ytd.med + ficaWages - th) - Math.max(0, ytd.med - th);
      out.medicare = ficaWages * T.FICA.medicareRate + over * T.FICA.addlMedicareRate;
    }
    const st = d.state || {};
    if (st.mode === "auto") {
      const S = T.STATES[st.code];
      if (S && S.single) {
        const k = status === "Married" ? 1 : 0, br = k ? S.married : S.single;
        const taxable = Math.max(0, incomeWages * periods - S.std[k] - S.ex[k]);
        out.state = Math.max(0, progressive(taxable, br) - S.cr[k]) / periods;
      }
    } else if (st.mode === "percent") out.state = incomeWages * num(st.value) / 100;
    else if (st.mode === "amount") out.state = num(st.value);
    out.local = incomeWages * num(st.localPercent) / 100;
    out.taxes = out.federal + out.socialSecurity + out.medicare + out.state + out.local;
    out.deductions = out.pretax.reduce((a, x) => a + x.amount, 0) + out.posttax.reduce((a, x) => a + x.amount, 0);
    out.net = Math.max(0, gross - out.taxes - out.deductions);
    out.ficaWages = ficaWages;
    return out;
  }
  /* Every paycheck in one calendar year, so the Social Security cap is applied where it really hits */
  function computeYearPaychecks(state, year) {
    const s = state.income, d = state.deductions || defaultDeductions(), inc = computeIncome(s);
    const periods = PERIODS_PER_YEAR[s.payFrequency] || 26, ytd = { ss: 0, med: 0 }, checks = [];
    const a = Math.round(Date.UTC(year, 0, 1) / DAY), b = Math.round(Date.UTC(year, 11, 31) / DAY);
    for (let day = a; day <= b; day++) if (isPayday(day, s)) {
      const pc = computePaycheck(d, inc.paycheck, periods, ytd);
      ytd.ss += pc.ficaWages; ytd.med += pc.ficaWages; checks.push(Object.assign({ iso: fromDay(day) }, pc));
    }
    const sum = k => checks.reduce((t, c) => t + c[k], 0);
    return { checks, typical: computePaycheck(d, inc.paycheck, periods), gross: sum("gross"), net: sum("net"), taxes: sum("taxes"), deductions: sum("deductions"),
      federal: sum("federal"), socialSecurity: sum("socialSecurity"), medicare: sum("medicare"), state: sum("state"), local: sum("local"),
      ssCapDate: d.socialSecurity ? ((checks.find(c => c.socialSecurity < c.ficaWages * root.FTTax.FICA.ssRate - 0.005) || {}).iso || "") : "" };
  }


  /* ---------- savings and investments growth ----------
     Savings = everything in the Savings category (money moved out of checking into savings).
     Investments = paycheck deductions like a 401(k) or HSA, taken from the take-home settings.
     Both grow by a yearly rate, compounded daily. Past the cash projection, the regular monthly
     amount is assumed to continue. */
  const INVEST_RE = /401|403|457|roth|\bira\b|hsa|retire|pension|invest|espp|stock|\btsp\b|brokerage/i;
  const HORIZONS = { proj: 0, "1y": 1, "5y": 5, "10y": 10, "30y": 30 };
  function defaultSavings() { return { start: 0, roi: 4, invStart: 0, invRoi: 7, horizon: "5y", invInclude: {} }; }
  function isInvestment(item, sv) {
    const inc = sv && sv.invInclude || {};
    return Object.prototype.hasOwnProperty.call(inc, item.id) ? !!inc[item.id] : INVEST_RE.test(item.name || "");
  }
  function growSeries(startIso, nDays, start, roi, contribOn, afterDay, perDayAfter) {
    const f = Math.pow(1 + roi / 100, 1 / 365), d0 = toDay(startIso), pts = [];
    const step = Math.max(1, Math.ceil(nDays / 420));
    let total = start, put = start;
    for (let i = 0; i < nDays; i++) {
      const add = i < afterDay ? (contribOn[i] || 0) : perDayAfter;
      total = total * (i ? f : 1) + add; put += add;
      if (i % step === 0 || i === nDays - 1) pts.push({ iso: fromDay(d0 + i), total, put });
    }
    return pts;
  }
  function computeGrowth(state, proj) {
    const sv = Object.assign(defaultSavings(), state.savings || {}), days = proj.days, n0 = days.length;
    const years = HORIZONS[sv.horizon] != null ? HORIZONS[sv.horizon] : 5;
    const nDays = years ? Math.round(years * 365.25) + 1 : n0, endIso = days[n0 - 1].iso;
    /* savings: Savings-category bills in the projection, then their monthly amount */
    const sOn = days.map(d => d.events.reduce((t, e) => t + (e.amount < 0 && e.category === "Savings" ? -e.amount : 0), 0));
    const recurring = (state.items || []).filter(i => i.type === "Bill" && i.frequency !== "One-time" && categoryOf(i) === "Savings" && (!i.end || i.end > endIso));
    const sMonthly = recurring.reduce((t, i) => t + monthlyEquivalent(i), 0);
    /* investments: chosen paycheck deductions on every payday */
    const d = state.deductions || {}, s = state.income || {};
    let perCheck = 0, rows = [];
    if (d.enabled && (d.items || []).length) {
      const pc = computePaycheck(d, computeIncome(s).paycheck, PERIODS_PER_YEAR[s.payFrequency] || 26);
      rows = pc.pretax.concat(pc.posttax).map(r => Object.assign({}, r, { invest: isInvestment(r, sv) }));
      perCheck = rows.filter(r => r.invest).reduce((t, r) => t + r.amount, 0);
    }
    const iOn = days.map(day => day.events.some(e => e.id === "payday") ? perCheck : 0);
    const iMonthly = perCheck * (PERIODS_PER_YEAR[s.payFrequency] || 26) / 12;
    const perDay = m => m * 12 / 365.25;
    const savings = growSeries(days[0].iso, nDays, sv.start, sv.roi, sOn, n0, perDay(sMonthly));
    const invest = growSeries(days[0].iso, nDays, sv.invStart, sv.invRoi, iOn, n0, perDay(iMonthly));
    return { settings: sv, years, endIso, projectionEnd: endIso, nDays,
      savings: { points: savings, monthly: sMonthly, items: recurring, inProjection: sOn.reduce((a, b) => a + b, 0) },
      invest: { points: invest, monthly: iMonthly, perCheck, rows, enabled: !!d.enabled } };
  }

  /* ---------- categories (for the donut, cash flow diagram and grouped lists) ---------- */
  const CATEGORIES = ["Housing", "Food & dining", "Transportation", "Utilities", "Shopping", "Subscriptions", "Debt & loans", "Insurance", "Health", "Personal", "Savings", "Other"];
  const INCOME_CATEGORIES = ["Paychecks", "Side income", "Other income"];
  const CAT_RULES = [
    ["Insurance", /insurance|geico|progressive|state farm|allstate|liberty mutual|usaa/i],
    ["Debt & loans", /\bloan\b|car payment|auto pay(?:ment)?|discover|capital one|cap one|credit card|card pmt|amex|chase card|navient|nelnet|mohela|sallie|affirm|klarna|afterpay/i],
    ["Housing", /\brent\b|mortgage|apartment|\bhoa\b|property|landlord|housing/i],
    ["Utilities", /power|electric|energy|\bwater\b|\bgas co|utilit|internet|comcast|xfinity|spectrum|at&t|\batt\b|verizon|t-?mobile|\bphone\b|wireless|sewer|trash/i],
    ["Subscriptions", /netflix|spotify|hulu|disney|hbo|\bmax\b|apple\.com|icloud|youtube|prime|claude|anthropic|openai|chatgpt|steam|xbox|playstation|patreon|subscription|\bgym\b|fitness|membership|adobe|microsoft|dropbox|canva|climbing|rock/i],
    ["Transportation", /\bcar\b|auto|\bgas\b|fuel|racetrac|marathon|shell|chevron|exxon|\bbp\b|quiktrip|\bqt\b|uber|lyft|parking|toll|transit|marta/i],
    ["Food & dining", /grocer|groceries|kroger|publix|aldi|wm super|walmart|costco|whole foods|trader joe|food|chick|culver|whataburger|mcdonald|starbucks|restaurant|cafe|coffee|pizza|cava|ale house|taco|burger|wendy|chipotle|doordash|grubhub|ubereats|dining/i],
    ["Shopping", /amazon|target|macy|ikea|lowe|home depot|burlington|best buy|etsy|ebay|shop|store|mall|nike|tj ?maxx|marshalls/i],
    ["Health", /pharmacy|\bcvs\b|walgreens|doctor|dental|dentist|medical|health|clinic|hospital|vision/i],
    ["Personal", /zelle|venmo|cash ?app|paypal|gift/i],
    ["Savings", /savings|\bsav\b|invest|brokerage|401k|ira\b/i]
  ];
  function categoryOf(item) {
    if (item.type === "Transfer") return "Transfers";
    if (item.category && (CATEGORIES.includes(item.category) || INCOME_CATEGORIES.includes(item.category))) return item.category;
    /* money moved between your own checking accounts: not spending, not savings */
    if (/\btransfer\b|\bxfer\b/i.test(item.name || "") && !/sav|invest|brokerage/i.test(item.name || "")) return "Transfers";
    if (item.type === "Income") return /payroll|salary|paycheck/i.test(item.name) ? "Paychecks" : /interest|dividend|refund|transfer/i.test(item.name) ? "Other income" : "Side income";
    const hit = CAT_RULES.find(([, re]) => re.test(item.name || ""));
    return hit ? hit[0] : "Other";
  }

  /* ---------- Finance Projection (daily ledger) ---------- */
  /* ---------- checking accounts (up to 3) ----------
     Every bill, income and paycheck belongs to one account ("main" when not set). A Transfer moves money
     from one account to another: it shows as money out of one and money in to the other, and it cancels
     out in the "all accounts" view. */
  const MAX_ACCOUNTS = 3;
  function accountsOf(state) {
    const list = Array.isArray(state.accounts) ? state.accounts.filter(a => a && a.id) : [];
    const main = list.find(a => a.id === "main") || { id: "main", name: "Main checking" };
    return [main].concat(list.filter(a => a.id !== "main")).slice(0, MAX_ACCOUNTS);
  }
  function accountStart(state, id) { return id === "main" ? num(state.projection.startingBalance) : num((accountsOf(state).find(a => a.id === id) || {}).start); }
  function accountOf(state, id) { return accountsOf(state).some(a => a.id === id) ? id : "main"; }

  /* After a statement import: a one-time "transfer out" in one account and a matching "transfer in" to another
     (same amount, same day or one day apart) are really one move between your own accounts. Pair them up
     into a single Transfer so the all-accounts view doesn't count it as both income and a bill. */
  function linkTransfers(items, accounts) {
    const nameOf = id => ((accounts || []).find(a => a.id === id) || {}).name || "another account";
    const isX = i => (i.type === "Bill" || i.type === "Income") && i.frequency === "One-time" && categoryOf(i) === "Transfers";
    const outs = items.filter(i => isX(i) && i.type === "Bill"), ins = items.filter(i => isX(i) && i.type === "Income");
    const used = new Set(), pairs = [];
    for (const o of outs) {
      const from = o.account || "main";
      const cands = ins.filter(x => !used.has(x.id) && (x.account || "main") !== from && Math.abs(num(x.amount) - num(o.amount)) < 0.005 && Math.abs(toDay(x.first) - toDay(o.first)) <= 1);
      cands.sort((a, b) => Math.abs(toDay(a.first) - toDay(o.first)) - Math.abs(toDay(b.first) - toDay(o.first)));
      if (cands.length) { used.add(cands[0].id); pairs.push([o, cands[0]]); }
    }
    if (!pairs.length) return { items, linked: 0 };
    const drop = new Set(); pairs.forEach(([o, m]) => { drop.add(o.id); drop.add(m.id); });
    const merged = pairs.map(([o, m]) => ({ id: o.id, name: "Transfer to " + nameOf(m.account || "main"), type: "Transfer", amount: num(o.amount), frequency: "One-time", first: o.first, end: "", account: o.account || "main", to: m.account || "main" }));
    return { items: items.filter(i => !drop.has(i.id)).concat(merged), linked: pairs.length };
  }

  function computeProjection(state, view) {
    const s = state.income, p = state.projection, items = state.items || [];
    const accts = accountsOf(state), ids = accts.map(a => a.id), nameOf = id => (accts.find(a => a.id === id) || accts[0]).name;
    view = view && ids.includes(view) ? view : "all";
    const inView = id => view === "all" || id === view;
    const income = computeIncome(s);
    const startDay = toDay(p.startDate);
    const endIso = fromDay(toDay(addMonths(p.startDate, Math.max(1, num(p.months, 6)))) - 1);
    const endDay = toDay(endIso);
    let bal = view === "all" ? ids.reduce((t, id) => t + accountStart(state, id), 0) : accountStart(state, view);
    const days = [];
    const ded = state.deductions && state.deductions.enabled ? state.deductions : null;
    const periods = PERIODS_PER_YEAR[s.payFrequency] || 26;
    const payTo = accountOf(state, s.depositTo);
    /* Social Security / Medicare year-to-date: count this year's paychecks before the start date */
    let ytd = { ss: 0, med: 0 }, ytdYear = parts(startDay).y;
    if (ded) for (let d = Math.round(Date.UTC(ytdYear, 0, 1) / DAY); d < startDay; d++) if (isPayday(d, s)) {
      const pc = computePaycheck(ded, income.paycheck, periods, ytd); ytd.ss += pc.ficaWages; ytd.med += pc.ficaWages;
    }
    /* "deposit" pay mode: each paycheck is the amount that actually lands in the bank (already after taxes) */
    const deposit = s.payMode === "deposit" && num(s.depositAmount) > 0 ? num(s.depositAmount) : 0;
    const paysFrom = s.paysFrom ? toDay(s.paysFrom) : -Infinity;
    for (let d = startDay; d <= endDay; d++) {
      let pay = 0, breakdown = null;
      if (isPayday(d, s) && d >= paysFrom) {
        if (deposit) pay = deposit;
        else if (ded) {
          const y = parts(d).y; if (y !== ytdYear) { ytdYear = y; ytd = { ss: 0, med: 0 }; }
          breakdown = computePaycheck(ded, income.paycheck, periods, ytd);
          ytd.ss += breakdown.ficaWages; ytd.med += breakdown.ficaWages;
          pay = breakdown.net;
        } else pay = income.paycheck;
      }
      if (!inView(payTo)) { pay = 0; breakdown = null; }
      let extra = 0, bills = 0;
      const events = [];
      if (pay || breakdown) events.push({ id: "payday", name: deposit ? "Paycheck deposit" : ded ? "Take-home pay" : "Paycheck", kind: "income", amount: pay, frequency: "Payday", breakdown, deposit: !!deposit, category: "Paychecks", account: payTo });
      for (const it of items) {
        if (!occursOn(it, d)) continue;
        const amt = num(it.amount), from = accountOf(state, it.account);
        if (it.type === "Transfer") {
          const to = accountOf(state, it.to);
          if (to === from || view === "all") continue; /* moves cancel out across all accounts */
          if (view === from) { bills += amt; events.push({ id: it.id, name: it.name, kind: "bill", transfer: true, amount: -amt, frequency: it.frequency, category: "Transfers", account: from, other: to, otherName: nameOf(to) }); }
          else if (view === to) { extra += amt; events.push({ id: it.id, name: it.name, kind: "income", transfer: true, amount: amt, frequency: it.frequency, category: "Transfers", account: to, other: from, otherName: nameOf(from) }); }
          continue;
        }
        if (!inView(from)) continue;
        if (it.type === "Bill") bills += amt; else extra += amt;
        events.push({ id: it.id, name: it.name, kind: it.type === "Bill" ? "bill" : "income", amount: it.type === "Bill" ? -amt : amt, frequency: it.frequency, category: categoryOf(it), account: from });
      }
      const net = pay + extra - bills;
      bal += net;
      days.push({ iso: fromDay(d), day: d, pay, extra, bills, net, balance: bal, events });
    }
    let low = days[0];
    for (const x of days) if (x.balance < low.balance) low = x;
    const totals = days.reduce((t, x) => ({ pay: t.pay + x.pay, extra: t.extra + x.extra, bills: t.bills + x.bills }), { pay: 0, extra: 0, bills: 0 });
    const out = { income, takeHome: !!ded || !!deposit, depositMode: !!deposit, days, endDate: endIso, ending: days.length ? days[days.length - 1].balance : bal, low, totals, view, accounts: accts };
    /* with more than one account, the all-accounts view also reports each account on its own */
    if (view === "all" && accts.length > 1) out.byAccount = accts.map(a => { const pr = computeProjection(state, a.id); return { id: a.id, name: a.name, start: accountStart(state, a.id), days: pr.days, ending: pr.ending, low: pr.low }; });
    return out;
  }

  root.FTEngine = {
    computeIncome, computeProjection, linkTransfers, accountsOf, accountStart, MAX_ACCOUNTS, computeGrowth, defaultSavings, isInvestment, HORIZONS, categoryOf, CATEGORIES, INCOME_CATEGORIES, computePaycheck, computeYearPaychecks, defaultDeductions, progressive, TREATMENTS, FILING, isPayday, occursOn, monthlyEquivalent, addMonths,
    toDay, fromDay, parts, weekdaysInYear, FREQUENCIES, PERIODS_PER_YEAR
  };
})(typeof window !== "undefined" ? window : globalThis);
