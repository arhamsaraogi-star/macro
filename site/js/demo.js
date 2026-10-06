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

export function history(symbol) {
  const r = rng(symbol);
  const years = symbol.includes("SM") ? 8 : 20;
  const days = [];
  const d = new Date(Date.UTC(2026, 9, 2));
  while (days.length < 252 * years) {
    if (d.getUTCDay() % 6) days.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() - 1);
  }
  days.reverse();
  const n = days.length;
  const rets = days.map(() => r.n(0.0005, 0.017));
  const vol = days.map(() => Math.exp(r.n(13, 0.35)));
  for (let k = 0; k < n / 180; k++) {
    const i = 80 + Math.floor(r.u() * (n - 90));
    const sign = r.u() < 0.5 ? -1 : 1;
    rets[i] = sign * (0.05 + r.u() * 0.08);
    vol[i] *= 3 + r.u() * 4;
    if (r.u() < 0.5) for (let j = i - 5; j < i; j++) { vol[j] *= 1.6 + r.u(); rets[j] += sign * 0.006; }
  }
  let c = 100;
  const bars = days.map((t, i) => {
    const o = c;
    c *= Math.exp(rets[i]);
    return { t, o, h: Math.max(o, c) * (1 + Math.abs(r.n(0, 0.006))), l: Math.min(o, c) * (1 - Math.abs(r.n(0, 0.006))), c, v: Math.round(vol[i]) };
  });
  return { bars, meta: {} };
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
