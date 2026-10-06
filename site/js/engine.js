// The app's data API: same shapes the UI renders, computed entirely in the browser.
import { analyzeBars } from "./analysis.js";
import { FACTORS, basket, factorsFor, makeSeries, sectorIndexFor } from "./context.js";
import { BUCKETS, MACRO_TRIGGERS, TIERS, playbookFor } from "./playbooks.js";
import * as demo from "./demo.js";
import * as market from "./market.js";
import { CATEGORY_LABELS, cleanCompanyName, newsWindow, rankNews } from "./news.js";

export const isDemo = demo.enabled();

export async function search(q) {
  return isDemo ? demo.search(q) : market.search(q);
}

/** @param {{symbol:string, hint?:object, mode:string, thresholds:object, years:string, sigmaYears:number}} p */
export async function analyze({ symbol, hint = {}, mode, thresholds, years, sigmaYears }) {
  let hist, meta;
  if (isDemo) {
    const s = symbol.toUpperCase().includes(".") ? symbol.toUpperCase() : `${symbol.toUpperCase()}.NS`;
    hist = { symbol: s, ...demo.history(s) };
    meta = demo.info(s);
  } else {
    hist = await market.resolve(symbol);
    if (!hist) throw new Error(`No price history found for '${symbol}'. Use the search box to pick the exact NSE/BSE ticker.`);
    const sameSymbol = hint.symbol?.toUpperCase() === hist.symbol;
    meta = await market.info(hist.symbol, sameSymbol && hint.sector ? hint : { name: hist.meta.longName || hist.meta.shortName });
    meta.name = meta.name || hist.meta.longName || hist.symbol;
  }

  // Context series: broad market, the stock's sector index, and sector-relevant commodities / macro.
  const [benchSym, benchName] = market.benchmarkFor(hist.symbol);
  const book = playbookFor(meta.sector, meta.industry, meta.name);
  const factorDefs = factorsFor(book);
  const load = async (sym) => {
    try {
      const h = isDemo ? demo.history(sym) : await market.history(sym);
      return h.bars.length > 50 ? h.bars : null;
    } catch { return null; }
  };
  // Sector: a real NIFTY index where Yahoo has daily history, else an equal-weighted basket
  // of the industry's listed leaders (excluding this stock).
  const loadSector = async () => {
    const idx = book.index || (book.peers ? null : sectorIndexFor(meta.sector, meta.industry));
    if (idx) {
      const bars = await load(idx.symbol);
      if (bars) return [{ ...idx, query: book.newsQuery || idx.query }, bars];
    }
    const self = hist.symbol.replace(/\.(NS|BO)$/, "");
    const peers = (book.peers || []).filter((p) => p.replace(/\.NS$/, "") !== self).slice(0, 5);
    if (!peers.length) return [null, null];
    const lists = await Promise.all(peers.map(load));
    const used = peers.filter((_, i) => lists[i]).map((p) => p.replace(/\.NS$/, ""));
    const bars = basket(lists);
    return bars ? [{ symbol: null, name: `${book.name} peers`, peers: used, query: book.newsQuery }, bars] : [null, null];
  };
  const [bench, [sectorIdx, sectorBars], ...factorBars] = await Promise.all([
    load(benchSym), loadSector(), ...factorDefs.map((f) => load(f.symbol)),
  ]);
  const context = {
    market: bench && { name: benchName, bars: bench },
    sector: sectorBars && { name: sectorIdx.name, bars: sectorBars },
    factors: factorDefs.map((f, i) => factorBars[i] && { ...f, bars: factorBars[i] }).filter(Boolean),
  };

  const ex = market.exchangeOf(hist.symbol);
  if (hint.symbol?.toUpperCase() === hist.symbol && hint.board) ex.board = hint.board;
  return {
    symbol: hist.symbol,
    requested: symbol,
    info: meta,
    exchange: ex.exchange,
    board: ex.board,
    benchmark: { symbol: benchSym, name: benchName, available: !!bench },
    sectorIndex: sectorIdx && { ...sectorIdx, available: !!sectorBars },
    factorsTracked: factorDefs.map((f, i) => ({ key: f.key, name: f.name, why: f.why, symbol: f.symbol, available: !!factorBars[i] })),
    industry: { key: book.key, name: book.name, rally: book.rally, selloff: book.selloff, metrics: book.metrics, newsQuery: book.newsQuery },
    triggerMatrix: triggerMatrix(factorDefs, factorBars, bench, sectorBars, sectorIdx, benchName),
    buckets: Object.fromEntries(Object.entries(BUCKETS).map(([k, b]) => [k, { label: b.label, tier: TIERS[b.tier] }])),
    macroTriggers: MACRO_TRIGGERS,
    params: { mode, thresholds, years, sigmaYears },
    categoryLabels: CATEGORY_LABELS,
    demo: isDemo,
    ...analyzeBars(hist.bars, { thresholds, context, mode, years, sigmaYears }),
  };
}

/**
 * Current trigger matrix: how each tracked factor moved over the last ~3 months and whether
 * that is a tailwind or headwind for this industry (using the playbook's sensitivities).
 */
function triggerMatrix(defs, factorBars, bench, sectorBars, sectorIdx, benchName) {
  const N = 63;
  const row = (name, bars, sens, why) => {
    if (!bars || bars.length < N + 2) return null;
    const s = makeSeries(bars), i1 = bars.length - 1, i0 = i1 - N;
    const change = bars[i1].c / bars[i0].c - 1;
    const sd = s.sigmaAt(i0);
    const z = sd ? Math.log(1 + change) / (sd * Math.sqrt(N)) : null;
    const strong = z != null && Math.abs(z) >= 0.5;
    const status = !sens ? "context" : !strong ? "neutral" : Math.sign(sens * change) > 0 ? "tailwind" : "headwind";
    return { name, change: Math.round(change * 1e4) / 1e4, z: z == null ? null : Math.round(z * 100) / 100, sens, why, status, asOf: bars[i1].t };
  };
  return [
    row(benchName, bench, 0, "broad market"),
    sectorIdx && row(sectorIdx.name, sectorBars, 0, "sector index"),
    ...defs.map((f, i) => row(f.name, factorBars[i], f.sens, f.why)),
  ].filter(Boolean);
}

/** Market / sector / commodity searches worth running for this event. */
export function contextQueries(ev, data) {
  const out = [];
  if (ev.driver === "market" || ev.episodes?.length || Math.abs(ev.benchmarkZ ?? 0) >= 2) out.push({ query: "Sensex Nifty", scope: "market" });
  if (ev.driver === "sector" || Math.abs(ev.sectorZ ?? 0) >= 2) {
    const q = data.industry?.newsQuery || data.sectorIndex?.query;
    if (q) out.push({ query: q, scope: "sector" });
  }
  for (const f of ev.factors || []) {
    if ((f.notable || f.explains) && f.kind === "factor" && out.length < 4) out.push({ query: factorQuery(f.key), scope: "sector" });
  }
  return out;
}
const factorQuery = (k) => FACTORS[k]?.query || k;

export async function news({ symbol, name, start, end, sector, industry, extra = [] }) {
  if (isDemo) {
    const win = newsWindow(start, end);
    const raw = [
      ...demo.news(cleanCompanyName(name), win.from, win.to),
      ...extra.flatMap((x) => demo.contextNews(x.query, x.scope, win.from, win.to)),
    ];
    return { window: win, ...rankNews(raw, { start, sector, industry, name }), errors: [] };
  }
  return market.news({ symbol, name, start, end, sector, industry, extra });
}

export const { getCustomProxy, setCustomProxy, relayUrl } = market;
