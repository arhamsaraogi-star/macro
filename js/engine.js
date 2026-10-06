// The app's data API: same shapes the UI renders, computed entirely in the browser.
import { analyzeBars } from "./analysis.js";
import { FACTORS, basket, factorsFor, makeSeries, sectorIndexFor } from "./context.js";
import { BUCKETS, MACRO_TRIGGERS, TIERS, playbookFor } from "./playbooks.js";
import * as demo from "./demo.js";
import * as market from "./market.js";
import { CATEGORY_LABELS, cleanCompanyName, newsWindow, rankNews } from "./news.js";

export const isDemo = demo.enabled();

// Approximate index weights of heavyweights. A heavyweight's own fall drags its index down, so
// its weight is taken out of the index move before judging "market-wide" / "sector-wide".
const INDEX_WEIGHTS = {
  "^NSEI": { HDFCBANK: 0.12, RELIANCE: 0.09, ICICIBANK: 0.08, INFY: 0.05, BHARTIARTL: 0.045, LT: 0.04, ITC: 0.04, TCS: 0.035, AXISBANK: 0.03, KOTAKBANK: 0.03, SBIN: 0.03, "M&M": 0.025, HINDUNILVR: 0.02, BAJFINANCE: 0.02 },
  "^BSESN": { HDFCBANK: 0.14, RELIANCE: 0.11, ICICIBANK: 0.09, INFY: 0.06, BHARTIARTL: 0.05, LT: 0.045, ITC: 0.045, TCS: 0.04 },
  "^NSEBANK": { HDFCBANK: 0.28, ICICIBANK: 0.25, SBIN: 0.1, KOTAKBANK: 0.09, AXISBANK: 0.09, INDUSINDBK: 0.03 },
  "^CNXIT": { INFY: 0.27, TCS: 0.23, HCLTECH: 0.11, TECHM: 0.1, WIPRO: 0.07, LTIM: 0.06 },
  "^CNXPHARMA": { SUNPHARMA: 0.23, CIPLA: 0.1, DRREDDY: 0.1, DIVISLAB: 0.08 },
};

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
    hist = await market.resolve(symbol, hint.symbol === symbol ? hint.alt : "", hint.symbol === symbol ? hint.board : "");
    if (!hist) throw new Error(`No price history found for '${symbol}'. Use the search box to pick the exact NSE/BSE ticker.`);
    const sameSymbol = hint.symbol?.toUpperCase() === hist.symbol;
    meta = await market.info(hist.symbol, sameSymbol && hint.sector ? hint : { name: (sameSymbol && hint.source === "list" && hint.name) || hist.meta.longName || hist.meta.shortName });
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
    load(benchSym), loadSector(), ...factorDefs.map((f) => (f.basket ? Promise.all(f.basket.map(load)).then(basket) : load(f.symbol))),
  ]);
  const self = hist.symbol.replace(/\.(NS|BO)$/, "");
  const context = {
    market: bench && { name: benchName, bars: bench, selfWeight: INDEX_WEIGHTS[benchSym]?.[self] || 0 },
    sector: sectorBars && { name: sectorIdx.name, bars: sectorBars, selfWeight: (sectorIdx.symbol && INDEX_WEIGHTS[sectorIdx.symbol]?.[self]) || 0 },
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
  // Market news whenever the market itself moved notably or it was market-driven / an episode.
  if (ev.driver === "market" || ev.alsoMoved?.includes("market") || ev.episodes?.length || Math.abs(ev.benchmarkZ ?? 0) >= 1.5) {
    out.push({ query: "Sensex Nifty", scope: "market" });
  }
  // Sector news for every big move: sector-wide triggers often never name the company.
  const q = data.industry?.newsQuery || data.sectorIndex?.query;
  if (q) out.push({ query: q, scope: "sector" });
  // Commodity / theme news when that factor moved unusually.
  for (const f of ev.factors || []) {
    if ((f.notable || f.explains) && f.kind === "factor" && out.length < 5) out.push({ query: factorQuery(f.key), scope: "sector" });
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
    return { window: win, link: market.googleNewsLink(`"${cleanCompanyName(name)}"`, win.from, win.to), ...rankNews(raw, { start, sector, industry, name }), errors: [] };
  }
  return market.news({ symbol, name, start, end, sector, industry, extra });
}

export const { getCustomProxy, setCustomProxy, relayUrl, RelayOutdatedError, getNewsRelay, setNewsRelay, newsRelayUrl } = market;

const pctTxt = (x) => `${x > 0 ? "+" : ""}${(x * 100).toFixed(0)}%`;

/**
 * Best one-line explanation of a move, combining the driver (market / sector / stock),
 * macro or theme factors that explain it, and the company headlines (if loaded).
 */
export function triggerText(e, n, data) {
  const labelOf = (k) => data.categoryLabels?.[k] || k;
  const theme = e.factors?.filter((f) => f.explains).sort((a, b) => Math.abs(b.share ?? 0) - Math.abs(a.share ?? 0))[0];
  const themeTxt = theme ? `${theme.name} ${pctTxt(theme.change)}` : "";
  const word = e.direction === "up" ? "rally" : "sell-off";
  const partial = e.alsoMoved?.length ? ` + ${e.alsoMoved.join(" & ")} ${word}` : "";
  // A Budget day is weak evidence for a single stock's move; only count it for market / sector moves.
  const episode = e.episodes?.find((x) => x.name !== "Union Budget")?.name || (e.driver !== "stock" ? e.episodes?.[0]?.name : "") || "";
  if (e.driver === "market") return { key: "market_wide", text: [episode || "Market-wide move", themeTxt].filter(Boolean).join(" · ") };
  if (e.driver === "sector") return { key: "sector_wide", text: [`${data.sectorIndex?.name || "Sector"} ${word}`, themeTxt].filter(Boolean).join(" · ") };
  const company = n?.likelyTrigger ? labelOf(n.likelyTrigger) : "";
  const earlierTxt = n?.earlierTrigger ? labelOf(n.earlierTrigger) : "";
  if (!n && !theme && !partial && !episode) return null;
  // Fresh company news first, then a matched episode, then an explaining theme; older company
  // news is only mentioned as "earlier".
  const staleCompany = !company && earlierTxt;
  const head = company || episode || themeTxt || (n ? "unclear" : "Stock-specific");
  const extra = [
    staleCompany ? `earlier: ${earlierTxt}` : "",
    episode && head !== episode && company ? episode : "",
    themeTxt && head !== themeTxt ? themeTxt : "",
  ].filter(Boolean);
  return { key: n?.likelyTrigger || (episode ? "episode" : theme ? "macro" : "other"), text: [head, ...extra].join(" · ") + partial };
}
