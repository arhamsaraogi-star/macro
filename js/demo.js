// Synthetic data for ?demo=1 — lets the UI run with no network access.
import { exchangeOf } from "./market.js";

const COMPANIES = [
  ["LT.NS", "Larsen & Toubro Limited", "Industrials", "Engineering & Construction"],
  ["LT.BO", "Larsen & Toubro Limited", "Industrials", "Engineering & Construction"],
  ["TATAMOTORS.NS", "Tata Motors Limited", "Consumer Cyclical", "Auto Manufacturers"],
  ["SUNPHARMA.NS", "Sun Pharmaceutical Industries Limited", "Healthcare", "Drug Manufacturers"],
  ["KRISHCA-SM.NS", "Krishca Strapping Solutions Limited", "Basic Materials", "Steel"],
  ["500325.BO", "Reliance Industries Limited", "Energy", "Oil & Gas Refining"],
];
const HEADLINES = [
  "{n} bags order worth Rs 2,500 crore from NHAI",
  "{n} Q{q} results: net profit jumps 32% YoY, beats estimates",
  "{n} reports 18% rise in monthly sales",
  "{n} shares tumble after USFDA warning letter",
  "Brokerage upgrades {n}, raises target price",
  "{n} board approves 1:1 bonus issue and record date",
  "Promoter raises stake in {n} via open market",
  "{n} launches QIP to raise Rs 1,000 crore",
  "Sensex, Nifty crash as global markets fall; {n} among top losers",
  "{n} CFO resigns; appoints new chief financial officer",
  "{n} guidance: management sees 20% revenue growth in FY",
];

export const enabled = () => new URLSearchParams(location.search).has("demo");

function rng(seedStr) {
  let a = [...seedStr].reduce((s, c) => (s * 31 + c.charCodeAt(0)) >>> 0, 7);
  const u = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const n = (m = 0, s = 1) => m + s * Math.sqrt(-2 * Math.log(u() || 1e-9)) * Math.cos(2 * Math.PI * u());
  return { u, n };
}

export function search(q) {
  const ql = q.toLowerCase();
  return COMPANIES.filter(([s, n]) => n.toLowerCase().includes(ql) || s.toLowerCase().includes(ql))
    .map(([symbol, name, sector, industry]) => ({ symbol, name, ...exchangeOf(symbol), sector, industry, source: "search" }));
}

export function info(symbol) {
  const c = COMPANIES.find(([s]) => s === symbol);
  return c ? { name: c[1], sector: c[2], industry: c[3] } : { name: symbol, sector: "", industry: "" };
}

const DAYS = (() => {
  const days = [];
  const d = new Date(Date.UTC(2026, 9, 2));
  while (days.length < 252 * 20) {
    if (d.getUTCDay() % 6) days.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return days.reverse();
})();

// Raw daily returns + volumes for one synthetic series.
function rawReturns(symbol, vol = 0.017) {
  const r = rng(symbol);
  const n = DAYS.length;
  const rets = DAYS.map(() => r.n(0.0004, vol));
  const v = DAYS.map(() => Math.exp(r.n(13, 0.35)));
  return { r, rets, v, n };
}

const memo = new Map();
function marketRets() {
  if (!memo.has("mkt")) {
    const { rets } = rawReturns("^NSEI", 0.01);
    DAYS.forEach((t, i) => {
      if (t >= "2020-02-24" && t <= "2020-03-23") rets[i] = -0.025 + (i % 3 === 0 ? 0.03 : 0); // COVID crash
      if (t >= "2008-10-01" && t <= "2008-10-31") rets[i] -= 0.012; // GFC
      if (t === "2019-05-23" || t === "2009-05-18") rets[i] = 0.05; // election rallies
    });
    memo.set("mkt", rets);
  }
  return memo.get("mkt");
}

function toBars(rets, vols, r, start) {
  let c = 100;
  return DAYS.slice(start).map((t, k) => {
    const i = k + start, o = c;
    c *= Math.exp(rets[i]);
    return { t, o, h: Math.max(o, c) * (1 + Math.abs(r.n(0, 0.006))), l: Math.min(o, c) * (1 - Math.abs(r.n(0, 0.006))), c, v: Math.round(vols[i]) };
  });
}

export function history(symbol) {
  const mkt = marketRets();
  if (symbol === "^NSEI" || symbol === "^BSESN") {
    const { r, v } = rawReturns(symbol);
    return { bars: toBars(mkt, v, r, 0), meta: {} };
  }
  const { r, rets, v, n } = rawReturns(symbol, symbol.startsWith("^") || symbol.includes("=") ? 0.012 : 0.013);
  if (symbol.startsWith("^") || symbol.includes("=")) {
    // sector indices follow the market; commodities mostly don't
    const beta = symbol.includes("=") ? 0.1 : 0.9;
    for (let i = 0; i < n; i++) rets[i] = beta * mkt[i] + (symbol.includes("=") ? 1.2 : 0.6) * rets[i];
    return { bars: toBars(rets, v, r, 0), meta: {} };
  }
  // stocks: market beta + sector + company-specific catalysts
  const sec = history("^CNXINFRA").bars;
  const secRets = sec.map((b, i) => (i ? Math.log(b.c / sec[i - 1].c) : 0));
  for (let i = 0; i < n; i++) rets[i] = 0.9 * mkt[i] + 0.5 * (secRets[i] - 0.9 * mkt[i]) + rets[i];
  for (let k = 0; k < n / 180; k++) {
    const i = 80 + Math.floor(r.u() * (n - 90));
    const sign = r.u() < 0.5 ? -1 : 1;
    rets[i] = sign * (0.05 + r.u() * 0.08);
    v[i] *= 3 + r.u() * 4;
    if (r.u() < 0.5) for (let j = i - 5; j < i; j++) { v[j] *= 1.6 + r.u(); rets[j] += sign * 0.006; }
  }
  for (let i = 0; i < n; i++) if (Math.abs(mkt[i]) > 0.02) v[i] *= 2.5; // market panic volume
  return { bars: toBars(rets, v, r, symbol.includes("SM") ? n - 252 * 8 : 0), meta: {} };
}

export function news(name, from, to) {
  const r = rng(name + from);
  const span = (Date.parse(to) - Date.parse(from)) / 864e5;
  return Array.from({ length: 2 + Math.floor(r.u() * 5) }, () => {
    const d = new Date(Date.parse(from) + Math.floor(r.u() * span) * 864e5).toISOString().slice(0, 10);
    const t = HEADLINES[Math.floor(r.u() * HEADLINES.length)].replace("{n}", name).replace("{q}", 1 + Math.floor(r.u() * 4));
    return { title: `${t} (demo)`, url: "https://news.google.com/", source: "Demo Wire", date: d };
  });
}

const CONTEXT_HEADLINES = {
  market: ["Sensex tanks 1,800 points as global sell-off deepens", "Nifty surges to record high on strong FPI inflows", "Markets crash as COVID-19 lockdown fears grip investors"],
  sector: ["{q}: prices jump to multi-month high", "{q} slump weighs on sector", "Sector stocks rally as {q} eases"],
};
export function contextNews(query, scope, from, to) {
  const r = rng(query + from);
  return Array.from({ length: 2 }, () => ({
    title: CONTEXT_HEADLINES[scope][Math.floor(r.u() * 3)].replace("{q}", query) + " (demo)",
    url: "https://news.google.com/", source: "Demo Wire", date: from, scope,
  }));
}
