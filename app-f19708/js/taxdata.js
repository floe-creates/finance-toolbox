/* Tax tables for estimating paycheck withholding. Tax year 2026.
   Federal: IRS Rev. Proc. 2025-32 (2026 inflation adjustments, including One Big Beautiful Bill changes).
   Social Security / Medicare: SSA 2026 wage base announcement.
   States: Tax Foundation, "State Individual Income Tax Rates and Brackets, as of January 1, 2026".
   Brackets are [threshold, rate]; income below the first threshold is untaxed.
   std = standard deduction, ex = personal exemption, cr = personal credit; each [single, married filing jointly].
   Update these numbers once a year. Local and county taxes are not included (use the "Local tax" field). */
(function (root) {
  "use strict";
  const FEDERAL = {
    year: 2026,
    Single:  { std: 16100, brackets: [[0, .10], [12400, .12], [50400, .22], [105700, .24], [201775, .32], [256225, .35], [640600, .37]] },
    Married: { std: 32200, brackets: [[0, .10], [24800, .12], [100800, .22], [211400, .24], [403550, .32], [512450, .35], [768700, .37]] },
    HoH:     { std: 24150, brackets: [[0, .10], [17700, .12], [67450, .22], [105700, .24], [201775, .32], [256225, .35], [640600, .37]] },
    MFS:     { std: 16100, brackets: [[0, .10], [12400, .12], [50400, .22], [105700, .24], [201775, .32], [256225, .35], [384350, .37]] }
  };
  const FICA = { year: 2026, ssRate: .062, ssWageBase: 184500, medicareRate: .0145, addlMedicareRate: .009, addlMedicareThreshold: 200000 };

  const flat = r => [[0, r]];
  const S = (name, single, married, o = {}) => ({ name, single, married: married || single, std: o.std || [0, 0], ex: o.ex || [0, 0], cr: o.cr || [0, 0], note: o.note || "" });
  const NONE = null;
  const STATES = {
    AL: S("Alabama", [[0, .02], [500, .04], [3000, .05]], [[0, .02], [1000, .04], [6000, .05]], { std: [3000, 8500], ex: [1500, 3000] }),
    AK: S("Alaska", NONE),
    AZ: S("Arizona", flat(.025), 0, { std: [8350, 16700] }),
    AR: S("Arkansas", [[0, .02], [4600, .039]], 0, { std: [2470, 4940], cr: [29, 58] }),
    CA: S("California", [[0, .01], [11079, .02], [26264, .04], [41452, .06], [57542, .08], [72724, .093], [371479, .103], [445771, .113], [742953, .123], [1000000, .133]],
      [[0, .01], [22158, .02], [52528, .04], [82904, .06], [115084, .08], [145448, .093], [742958, .103], [891542, .113], [1000000, .123], [1485906, .133]], { std: [5540, 11080], cr: [153, 306], note: "California SDI (about 1.3%) is not included; add it under Local tax if you want it counted." }),
    CO: S("Colorado", flat(.044), 0, { std: [16100, 32200] }),
    CT: S("Connecticut", [[0, .02], [10000, .045], [50000, .055], [100000, .06], [200000, .065], [250000, .069], [500000, .0699]],
      [[0, .02], [20000, .045], [100000, .055], [200000, .06], [400000, .065], [500000, .069], [1000000, .0699]], { ex: [15000, 24000], note: "Connecticut's exemption phases out at higher incomes." }),
    DE: S("Delaware", [[2000, .022], [5000, .039], [10000, .048], [20000, .052], [25000, .0555], [60000, .066]], 0, { std: [3250, 6500], cr: [110, 220] }),
    DC: S("District of Columbia", [[0, .04], [10000, .06], [40000, .065], [60000, .085], [250000, .0925], [500000, .0975], [1000000, .1075]], 0, { std: [16100, 32200] }),
    FL: S("Florida", NONE),
    GA: S("Georgia", flat(.0519), 0, { std: [12000, 24000] }),
    HI: S("Hawaii", [[0, .014], [9600, .032], [14400, .055], [19200, .064], [24000, .068], [36000, .072], [48000, .076], [125000, .079], [175000, .0825], [225000, .09], [275000, .10], [325000, .11]],
      [[0, .014], [19200, .032], [28800, .055], [38400, .064], [48000, .068], [72000, .072], [96000, .076], [250000, .079], [350000, .0825], [450000, .09], [550000, .10], [650000, .11]], { std: [4400, 8800], ex: [1144, 2288] }),
    ID: S("Idaho", [[4811, .053]], [[9622, .053]], { std: [16100, 32200] }),
    IL: S("Illinois", flat(.0495), 0, { ex: [2925, 5850] }),
    IN: S("Indiana", flat(.0295), 0, { ex: [1000, 2000], note: "Indiana counties add their own income tax; enter yours under Local tax." }),
    IA: S("Iowa", flat(.038), 0, { std: [16100, 32200], cr: [40, 80] }),
    KS: S("Kansas", [[0, .052], [23000, .0558]], [[0, .052], [46000, .0558]], { std: [3605, 8240], ex: [9160, 18320] }),
    KY: S("Kentucky", flat(.035), 0, { std: [3360, 3360], note: "Many Kentucky cities and counties add an occupational tax; enter yours under Local tax." }),
    LA: S("Louisiana", flat(.03), 0, { std: [12875, 25750] }),
    ME: S("Maine", [[0, .058], [27399, .0675], [64849, .0715]], [[0, .058], [54849, .0675], [129749, .0715]], { std: [8350, 16700], ex: [5300, 10600] }),
    MD: S("Maryland", [[0, .02], [1000, .03], [2000, .04], [3000, .0475], [100000, .05], [125000, .0525], [150000, .055], [250000, .0575], [500000, .0625], [1000000, .065]],
      [[0, .02], [1000, .03], [2000, .04], [3000, .0475], [150000, .05], [175000, .0525], [225000, .055], [300000, .0575], [600000, .0625], [1200000, .065]], { std: [3350, 6700], ex: [3200, 6400], note: "Maryland counties add about 2.25% to 3.3%; enter yours under Local tax." }),
    MA: S("Massachusetts", [[0, .05], [1083150, .09]], 0, { ex: [4400, 8800] }),
    MI: S("Michigan", flat(.0425), 0, { ex: [5900, 11800], note: "Some Michigan cities (like Detroit) add a city income tax; enter it under Local tax." }),
    MN: S("Minnesota", [[0, .0535], [33310, .068], [109430, .0785], [203150, .0985]], [[0, .0535], [48700, .068], [193480, .0785], [337930, .0985]], { std: [15300, 30600] }),
    MS: S("Mississippi", [[10000, .04]], 0, { std: [2300, 4600], ex: [6000, 12000] }),
    MO: S("Missouri", [[1348, .02], [2696, .025], [4044, .03], [5392, .035], [6740, .04], [8088, .045], [9436, .047]], 0, { std: [16100, 32200] }),
    MT: S("Montana", [[0, .047], [47500, .0565]], [[0, .047], [95000, .0565]], { std: [16100, 32200] }),
    NE: S("Nebraska", [[0, .0246], [4130, .0351], [24760, .0455]], [[0, .0246], [8250, .0351], [49530, .0455]], { std: [8850, 17700], cr: [176, 352] }),
    NV: S("Nevada", NONE),
    NH: S("New Hampshire", NONE),
    NJ: S("New Jersey", [[0, .014], [20000, .0175], [35000, .035], [40000, .0553], [75000, .0637], [500000, .0897], [1000000, .1075]],
      [[0, .014], [20000, .0175], [50000, .0245], [70000, .035], [80000, .0553], [150000, .0637], [500000, .0897], [1000000, .1075]], { ex: [1000, 2000] }),
    NM: S("New Mexico", [[0, .015], [5500, .032], [16500, .043], [33500, .047], [66500, .049], [210000, .059]], [[0, .015], [8000, .032], [25000, .043], [50000, .047], [100000, .049], [315000, .059]], { std: [16100, 32200] }),
    NY: S("New York", [[0, .039], [8500, .044], [11700, .0515], [13900, .054], [80650, .059], [215400, .0685], [1077550, .0965], [5000000, .103], [25000000, .109]],
      [[0, .039], [17150, .044], [23600, .0515], [27900, .054], [161550, .059], [323200, .0685], [2155350, .0965], [5000000, .103], [25000000, .109]], { std: [8000, 16050], note: "New York City and Yonkers add their own income tax; enter it under Local tax." }),
    NC: S("North Carolina", flat(.0399), 0, { std: [12750, 25500] }),
    ND: S("North Dakota", [[48475, .0195], [244825, .025]], [[80975, .0195], [298075, .025]], { std: [16100, 32200] }),
    OH: S("Ohio", [[26050, .0275]], 0, { ex: [2400, 4800], note: "Most Ohio cities add a municipal income tax; enter yours under Local tax." }),
    OK: S("Oklahoma", [[3750, .025], [4900, .035], [7200, .045]], [[7500, .025], [9800, .035], [14400, .045]], { std: [6350, 12700], ex: [1000, 2000] }),
    OR: S("Oregon", [[0, .0475], [4550, .0675], [11400, .0875], [125000, .099]], [[0, .0475], [9100, .0675], [22800, .0875], [250000, .099]], { std: [2910, 5820], cr: [256, 512] }),
    PA: S("Pennsylvania", flat(.0307), 0, { note: "Most Pennsylvania towns add a local earned income tax (often about 1%); enter yours under Local tax." }),
    RI: S("Rhode Island", [[0, .0375], [82050, .0475], [186450, .0599]], 0, { std: [11200, 22400], ex: [5250, 10500] }),
    SC: S("South Carolina", [[3640, .03], [18230, .06]], 0, { std: [8350, 16700] }),
    SD: S("South Dakota", NONE),
    TN: S("Tennessee", NONE),
    TX: S("Texas", NONE),
    UT: S("Utah", flat(.045), 0, { cr: [966, 1932] }),
    VT: S("Vermont", [[0, .0335], [49400, .066], [119700, .076], [249700, .0875]], [[0, .0335], [82500, .066], [199450, .076], [304000, .0875]], { std: [7650, 15300], ex: [5300, 10600] }),
    VA: S("Virginia", [[0, .02], [3000, .03], [5000, .05], [17000, .0575]], 0, { std: [8750, 17500], ex: [930, 1860] }),
    WA: S("Washington", NONE, 0, { note: "Washington has no tax on wages." }),
    WV: S("West Virginia", [[0, .0222], [10000, .0296], [25000, .0333], [40000, .0444], [60000, .0482]], 0, { ex: [2000, 4000] }),
    WI: S("Wisconsin", [[0, .035], [15110, .044], [51950, .053], [332720, .0765]], [[0, .035], [20150, .044], [69260, .053], [443630, .0765]], { std: [13960, 25840], ex: [700, 1400] }),
    WY: S("Wyoming", NONE)
  };
  root.FTTax = { FEDERAL, FICA, STATES };
})(typeof window !== "undefined" ? window : globalThis);
