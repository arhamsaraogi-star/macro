// The app's data API: same shapes the UI renders, computed entirely in the browser.
import { analyzeBars } from "./analysis.js";
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

  const [benchSym, benchName] = market.benchmarkFor(hist.symbol);
  let bench = null;
  try { bench = (isDemo ? demo.history(benchSym) : await market.history(benchSym)).bars; } catch { /* optional */ }

  const ex = market.exchangeOf(hist.symbol);
  return {
    symbol: hist.symbol,
    requested: symbol,
    info: meta,
    exchange: ex.exchange,
    board: ex.board,
    benchmark: { symbol: benchSym, name: benchName, available: !!bench?.length },
    playbook: playbook(meta.sector, meta.industry).map((k) => ({ key: k, label: CATEGORY_LABELS[k] })),
    params: { mode, thresholds, years, sigmaYears },
    categoryLabels: CATEGORY_LABELS,
    demo: isDemo,
    ...analyzeBars(hist.bars, { thresholds, bench, mode, years, sigmaYears }),
  };
}

export async function news({ symbol, name, start, end, sector, industry }) {
  if (isDemo) {
    const win = newsWindow(start, end);
    return { window: win, ...rankNews(demo.news(cleanCompanyName(name), win.from, win.to), { start, sector, industry }), errors: [] };
  }
  return market.news({ symbol, name, start, end, sector, industry });
}

export const { getCustomProxy, setCustomProxy } = market;
