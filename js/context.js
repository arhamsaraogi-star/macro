// What else was moving? Sector indices, sector-relevant commodities / macro factors,
// and a curated calendar of market-wide episodes (COVID, GFC, elections, budgets…).

/** NIFTY sector index for a Yahoo sector/industry pair (null if none fits). */
const SECTOR_INDICES = [
  [/auto|vehicle|tyre|tire/, "^CNXAUTO", "NIFTY Auto", "auto stocks"],
  [/bank/, "^NSEBANK", "NIFTY Bank", "bank stocks"],
  [/financial|insurance|credit|capital markets|asset management|lending/, "NIFTY_FIN_SERVICE.NS", "NIFTY Financial Services", "financial stocks NBFC"],
  [/software|information technology|it services|technology/, "^CNXIT", "NIFTY IT", "IT stocks"],
  [/drug|pharma|healthcare|medical|biotech|diagnostic/, "^CNXPHARMA", "NIFTY Pharma", "pharma stocks"],
  [/steel|metal|aluminum|aluminium|copper|mining|gold|silver|basic materials/, "^CNXMETAL", "NIFTY Metal", "metal stocks"],
  [/oil|gas|refin|energy|utilities|power|coal/, "^CNXENERGY", "NIFTY Energy", "energy stocks oil"],
  [/real estate|realty|reit/, "^CNXREALTY", "NIFTY Realty", "realty stocks"],
  [/consumer defensive|food|beverage|tobacco|household|personal products|fmcg|packaged/, "^CNXFMCG", "NIFTY FMCG", "FMCG stocks"],
  [/media|entertainment|broadcast/, "^CNXMEDIA", "NIFTY Media", "media stocks"],
  [/industrial|engineering|construction|infrastructure|capital goods|machinery|electrical|cement|building/, "^CNXINFRA", "NIFTY Infrastructure", "infrastructure capital goods stocks"],
];

export function sectorIndexFor(sector = "", industry = "") {
  const text = `${industry} ${sector}`.toLowerCase();
  if (!text.trim()) return null;
  // Industry is more specific than sector: try it first.
  for (const t of [industry.toLowerCase(), sector.toLowerCase()]) {
    if (!t) continue;
    const hit = SECTOR_INDICES.find(([re]) => re.test(t));
    if (hit) return { symbol: hit[1], name: hit[2], query: hit[3] };
  }
  return null;
}

export const FACTORS = {
  crude: { symbol: "BZ=F", name: "Brent crude", query: "crude oil price" },
  gas: { symbol: "NG=F", name: "Natural gas", query: "natural gas price" },
  gold: { symbol: "GC=F", name: "Gold", query: "gold price" },
  copper: { symbol: "HG=F", name: "Copper", query: "copper price" },
  aluminium: { symbol: "ALI=F", name: "Aluminium", query: "aluminium price" },
  steel: { symbol: "HRC=F", name: "Steel (HRC)", query: "steel prices" },
  sugar: { symbol: "SB=F", name: "Sugar", query: "sugar prices" },
  cotton: { symbol: "CT=F", name: "Cotton", query: "cotton prices" },
  inr: { symbol: "INR=X", name: "USD/INR", query: "rupee dollar" },
  usd: { symbol: "DX-Y.NYB", name: "US dollar index", query: "dollar index" },
  rates: { symbol: "^TNX", name: "US 10Y yield", query: "bond yields RBI rate" },
  china: { symbol: "000001.SS", name: "Shanghai Composite", query: "China stimulus" },
  spx: { symbol: "^GSPC", name: "S&P 500", query: "US stocks Wall Street" },
  smallcap: { symbol: "^CNXSC", name: "NIFTY Smallcap", query: "smallcap stocks" },
  vix: { symbol: "^INDIAVIX", name: "India VIX", query: "India VIX" },
};

const ALWAYS = ["crude", "inr", "vix"];

/**
 * Macro factors to check for a company: its industry's sensitivities (from the playbook)
 * plus Brent, USD/INR and India VIX. `sens` = +1 if the factor rising helps the industry,
 * -1 if it hurts, 0 if it's tracked for context only.
 */
export function factorsFor(playbook) {
  const macro = playbook?.macro || {};
  const keys = [...new Set([...Object.keys(macro), ...ALWAYS])].slice(0, 7);
  return keys.map((k) => {
    const sens = macro[k] ?? 0;
    const why = k === "vix" ? "market fear gauge"
      : sens > 0 ? `${FACTORS[k].name} ↑ = tailwind` : sens < 0 ? `${FACTORS[k].name} ↑ = headwind` : "macro context";
    return { key: k, ...FACTORS[k], sens, why, kind: k === "vix" ? "vol" : "factor" };
  });
}

/** Curated market-wide episodes that move Indian stocks broadly. Inclusive date ranges. */
export const EPISODES = [
  ["2006-05-11", "2006-06-14", "May 2006 emerging-market sell-off", "market"],
  ["2008-01-21", "2008-01-25", "Jan 2008 global crash", "market"],
  ["2008-09-15", "2009-03-09", "Global Financial Crisis (Lehman)", "market"],
  ["2009-05-18", "2009-05-18", "2009 election result rally", "politics"],
  ["2011-08-01", "2011-08-31", "US downgrade / Euro debt crisis", "market"],
  ["2013-05-22", "2013-09-04", "Taper tantrum & rupee crash", "market"],
  ["2013-09-18", "2013-09-19", "Fed no-taper surprise", "market"],
  ["2014-05-16", "2014-05-16", "2014 election results (Modi wave)", "politics"],
  ["2014-07-01", "2016-02-11", "Crude oil price collapse", "commodity"],
  ["2015-08-11", "2015-08-24", "China yuan devaluation", "market"],
  ["2016-06-24", "2016-06-24", "Brexit vote", "market"],
  ["2016-11-08", "2016-12-30", "Demonetisation", "policy"],
  ["2017-07-01", "2017-07-01", "GST rollout", "policy"],
  ["2018-01-29", "2018-02-09", "LTCG tax + global volatility spike", "market"],
  ["2018-09-21", "2018-10-31", "IL&FS / NBFC crisis", "market"],
  ["2019-05-23", "2019-05-23", "2019 election results", "politics"],
  ["2019-09-20", "2019-09-23", "Corporate tax cut", "policy"],
  ["2020-02-20", "2020-04-30", "COVID-19 crash & lockdown", "market"],
  ["2020-11-09", "2020-11-30", "COVID vaccine rally", "market"],
  ["2021-04-01", "2021-05-31", "COVID second wave", "market"],
  ["2021-11-26", "2021-11-30", "Omicron scare", "market"],
  ["2022-02-24", "2022-03-08", "Russia–Ukraine war / commodity spike", "market"],
  ["2020-03-27", "2020-03-27", "RBI emergency 75bp rate cut", "policy"],
  ["2020-05-22", "2020-05-22", "RBI surprise rate cut", "policy"],
  ["2022-05-04", "2022-06-17", "RBI & Fed rate-hike shock", "market"],
  ["2025-06-06", "2025-06-06", "RBI 50bp cut + CRR cut", "policy"],
  ["2023-01-24", "2023-02-28", "Adani–Hindenburg episode", "market"],
  ["2023-03-09", "2023-03-20", "US regional bank crisis (SVB)", "market"],
  ["2024-06-03", "2024-06-03", "2024 exit-poll rally", "politics"],
  ["2024-06-04", "2024-06-05", "2024 election results shock", "politics"],
  ["2024-09-24", "2024-10-08", "China stimulus rotation", "market"],
  ["2024-10-01", "2024-11-21", "Record FPI selling", "market"],
  ["2025-04-02", "2025-04-11", "US \"Liberation Day\" tariffs", "market"],
  ["2025-05-07", "2025-05-12", "India–Pakistan conflict", "market"],
  ["2025-08-06", "2025-08-29", "US 50% tariffs on India", "market"],
  // Union Budgets (incl. interim / post-election full budgets)
  ...["2006-02-28", "2007-02-28", "2008-02-29", "2009-02-16", "2009-07-06", "2010-02-26", "2011-02-28", "2012-03-16",
    "2013-02-28", "2014-02-17", "2014-07-10", "2015-02-28", "2016-02-29", "2017-02-01", "2018-02-01", "2019-02-01",
    "2019-07-05", "2020-02-01", "2021-02-01", "2022-02-01", "2023-02-01", "2024-02-01", "2024-07-23", "2025-02-01",
    "2026-02-01"].map((d) => [d, d, "Union Budget", "policy"]),
].map(([from, to, name, kind]) => ({ from, to, name, kind }));

const addDays = (s, n) => { const d = new Date(s + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

/** Episodes overlapping [start - 7 days, end] — i.e. the move or the week before it. */
export function episodesFor(start, end) {
  const from = addDays(start, -7);
  return EPISODES.filter((e) => e.from <= end && e.to >= from).map((e) => ({ name: e.name, kind: e.kind, from: e.from, to: e.to }));
}

/* ---------- factor series helpers ---------- */

/** Pre-compute a factor series for O(log n) as-of lookups and trailing daily σ. */
export function makeSeries(bars, window = 252) {
  const t = bars.map((b) => b.t), c = bars.map((b) => b.c);
  const s1 = [0], s2 = [0];
  for (let i = 1; i < c.length; i++) {
    const r = c[i] > 0 && c[i - 1] > 0 ? Math.log(c[i] / c[i - 1]) : 0;
    s1.push(s1[i - 1] + r); s2.push(s2[i - 1] + r * r);
  }
  const idx = (date) => { // last index with t <= date
    let lo = 0, hi = t.length - 1, ans = -1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (t[m] <= date) { ans = m; lo = m + 1; } else hi = m - 1; }
    return ans;
  };
  const sigmaAt = (i) => { // σ of daily log returns over the `window` sessions ending at i (exclusive of i+1)
    const a = Math.max(1, i - window + 1), n = i - a + 1;
    if (n < 40) return null;
    const m = (s1[i] - s1[a - 1]) / n;
    const v = (s2[i] - s2[a - 1]) / n - m * m;
    return v > 0 ? Math.sqrt((v * n) / (n - 1)) : null;
  };
  return { t, c, idx, sigmaAt };
}

/** Change of a factor from prevDate's close to endDate's close, with a z-score vs its own σ. */
export function changeBetween(series, prevDate, endDate) {
  if (!series) return null;
  const i0 = series.idx(prevDate), i1 = series.idx(endDate);
  if (i0 < 0 || i1 < 0 || i1 <= i0 || !(series.c[i0] > 0)) return null;
  // stale data guard: the factor must have traded near the period
  if ((Date.parse(endDate) - Date.parse(series.t[i1])) / 864e5 > 7) return null;
  const change = series.c[i1] / series.c[i0] - 1;
  const s = series.sigmaAt(i0);
  const z = s ? Math.log(1 + change) / (s * Math.sqrt(i1 - i0)) : null;
  return { change, z };
}
