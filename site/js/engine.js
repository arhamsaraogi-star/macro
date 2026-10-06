// The app's data API: same shapes the UI renders, computed entirely in the browser.
import { analyzeBars } from "./analysis.js";
import { FACTORS, factorsFor, sectorIndexFor } from "./context.js";
import * as demo from "./demo.js";
import * as market from "./market.js";
import { CATEGORY_LABELS, cleanCompanyName, newsWindow, playbook, rankNews } from "./news.js";

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
  const sectorIdx = sectorIndexFor(meta.sector, meta.industry);
  const factorDefs = factorsFor(meta.sector, meta.industry);
  const load = async (sym) => {
    try {
      const h = isDemo ? demo.history(sym) : await market.history(sym);
      return h.bars.length > 50 ? h.bars : null;
    } catch { return null; }
  };
  const [bench, sectorBars, ...factorBars] = await Promise.all([
    load(benchSym), sectorIdx ? load(sectorIdx.symbol) : null, ...factorDefs.map((f) => load(f.symbol)),
  ]);
  const context = {
    market: bench && { name: benchName, bars: bench },
    sector: sectorBars && { name: sectorIdx.name, bars: sectorBars },
    factors: factorDefs.map((f, i) => factorBars[i] && { ...f, bars: factorBars[i] }).filter(Boolean),
  };

  const ex = market.exchangeOf(hist.symbol);
  return {
    symbol: hist.symbol,
    requested: symbol,
    info: meta,
    exchange: ex.exchange,
    board: ex.board,
    benchmark: { symbol: benchSym, name: benchName, available: !!bench },
    sectorIndex: sectorIdx && { ...sectorIdx, available: !!sectorBars },
    factorsTracked: factorDefs.map((f, i) => ({ key: f.key, name: f.name, why: f.why, symbol: f.symbol, available: !!factorBars[i] })),
    playbook: playbook(meta.sector, meta.industry).map((k) => ({ key: k, label: CATEGORY_LABELS[k] })),
    params: { mode, thresholds, years, sigmaYears },
    categoryLabels: CATEGORY_LABELS,
    demo: isDemo,
    ...analyzeBars(hist.bars, { thresholds, context, mode, years, sigmaYears }),
  };
}

/** Market / sector / commodity searches worth running for this event. */
export function contextQueries(ev, data) {
  const out = [];
  if (ev.driver === "market" || ev.episodes?.length || Math.abs(ev.benchmarkZ ?? 0) >= 2) out.push({ query: "Sensex Nifty", scope: "market" });
  if (data.sectorIndex && (ev.driver === "sector" || Math.abs(ev.sectorZ ?? 0) >= 2)) out.push({ query: data.sectorIndex.query, scope: "sector" });
  for (const f of ev.factors || []) {
    if (f.notable && f.kind === "factor" && out.length < 4) out.push({ query: factorQuery(f.key), scope: "sector" });
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
    return { window: win, ...rankNews(raw, { start, sector, industry }), errors: [] };
  }
  return market.news({ symbol, name, start, end, sector, industry, extra });
}

export const { getCustomProxy, setCustomProxy } = market;
