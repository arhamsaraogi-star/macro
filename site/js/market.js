// Market data straight from the browser: Yahoo Finance (search + chart API) and
// Google News RSS. Those hosts don't send CORS headers, so requests go through a
// relay: a tiny Cloudflare Worker (relay/worker.js). The relay URL comes from, in order,
// a ?relay= link (saved), the user's Settings (localStorage), or the site default in config.js.

import { cleanCompanyName, newsWindow, rankNews } from "./news.js";

const PROXY_KEY = "macro.proxy";

export function getCustomProxy() {
  try { return localStorage.getItem(PROXY_KEY) || ""; } catch { return ""; }
}
export function setCustomProxy(url) {
  try { url ? localStorage.setItem(PROXY_KEY, url.trim()) : localStorage.removeItem(PROXY_KEY); } catch { /* storage blocked */ }
}
// A shared link like ?relay=https://… configures the relay for this browser.
try {
  const fromLink = new URLSearchParams(globalThis.location?.search || "").get("relay");
  if (fromLink && /^https:\/\//.test(fromLink)) setCustomProxy(fromLink);
} catch { /* not in a browser */ }

export function relayUrl() {
  return getCustomProxy() || globalThis.MACRO_CONFIG?.relay || "";
}

export class RelayError extends Error {}
export class NeedsRelayError extends RelayError {}

// Free relays rate-limit bursts, so keep at most a few requests in flight.
const MAX_IN_FLIGHT = 4;
let inFlight = 0;
const waiting = [];
async function limited(fn) {
  if (inFlight >= MAX_IN_FLIGHT) await new Promise((r) => waiting.push(r));
  inFlight++;
  try { return await fn(); } finally { inFlight--; waiting.shift()?.(); }
}

function relayFetch(url, opts) {
  return limited(() => relayFetchNow(url, opts));
}

async function relayFetchNow(url, { type = "json", timeout = 20000 } = {}) {
  const relay = relayUrl();
  if (!relay) throw new NeedsRelayError("No data relay connected yet.");
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  try {
    const res = await fetch(`${relay.replace(/\/+$/, "")}/?url=${encodeURIComponent(url)}`, { signal: ctl.signal });
    if (res.status === 404 && /\/v8\/finance\/chart\//.test(url)) return type === "json" ? { chart: { result: null } } : "";
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    return type === "json" ? JSON.parse(text) : text;
  } catch (e) {
    if (e instanceof RelayError) throw e;
    throw new RelayError(`Your data relay couldn't reach ${new URL(url).host} (${e.name === "AbortError" ? "timeout" : e.message}).`);
  } finally {
    clearTimeout(timer);
  }
}

const cache = new Map();
async function cached(key, fn) {
  if (cache.has(key)) return cache.get(key);
  const p = fn();
  cache.set(key, p);
  try { return await p; } catch (e) { cache.delete(key); throw e; }
}

/* ---------- symbols ---------- */

export function exchangeOf(symbol) {
  const s = symbol.toUpperCase();
  if (s.endsWith(".NS")) {
    const base = s.slice(0, -3);
    return { exchange: "NSE", board: base.endsWith("-SM") || base.endsWith("-ST") ? "SME" : "Main" };
  }
  if (s.endsWith(".BO")) return { exchange: "BSE", board: "Main/SME" };
  return { exchange: "OTHER", board: "" };
}

export function directCandidates(q) {
  q = q.trim().toUpperCase();
  if (!/^[A-Z0-9&\-.]{2,20}$/.test(q)) return [];
  if (q.endsWith(".NS") || q.endsWith(".BO")) return [q];
  if (/^\d{6}$/.test(q)) return [`${q}.BO`];
  const base = q.split(".")[0];
  return [`${base}.NS`, `${base}.BO`, `${base}-SM.NS`, `${base}-ST.NS`];
}

export const BENCHMARKS = { NSE: ["^NSEI", "NIFTY 50"], BSE: ["^BSESN", "SENSEX"] };
export const benchmarkFor = (symbol) => BENCHMARKS[exchangeOf(symbol).exchange] || BENCHMARKS.NSE;

/* ---------- search ---------- */

async function yahooSearch(q) {
  const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=20&newsCount=0&listsCount=0&enableFuzzyQuery=true`;
  const body = await relayFetch(url);
  return body.quotes || [];
}

/* ---------- local ticker list (official NSE / BSE lists, built in CI) ---------- */

let listPromise = null;
function loadTickerList() {
  listPromise ||= fetch(new URL("../data/tickers.json", import.meta.url))
    .then((r) => (r.ok ? r.json() : { rows: [] }))
    .then((d) => (d.rows || []).map((r) => ({ ...r, key: `${r.n} ${r.s} ${r.id || ""}`.toLowerCase() })))
    .catch(() => []);
  return listPromise;
}

/** Yahoo symbol for an official-list row. */
export function yahooSymbol(row) {
  if (row.x === "NSE") return row.b === "SME" ? `${row.s}-SM.NS` : `${row.s}.NS`;
  return `${row.s}.BO`;
}

/** Rank official-list rows for a query: every word must prefix-match a word of the name/symbol. */
export function matchTickers(rows, q, limit = 12) {
  const words = q.toLowerCase().replace(/[^a-z0-9& ]+/g, " ").split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const qs = q.trim().toLowerCase();
  const scored = [];
  for (const r of rows) {
    const tokens = r.key.replace(/[^a-z0-9& ]+/g, " ").split(/\s+/);
    if (!words.every((w) => tokens.some((t) => t.startsWith(w)))) continue;
    let score = 0;
    if (r.s.toLowerCase() === qs || (r.id || "").toLowerCase() === qs) score += 100;
    if (r.n.toLowerCase().startsWith(qs)) score += 40;
    if (tokens[0].startsWith(words[0])) score += 10;
    score -= r.n.length / 100;
    if (r.x === "NSE") score += 1;
    scored.push([score, r]);
  }
  return scored.sort((a, b) => b[0] - a[0]).slice(0, limit).map(([, r]) => r);
}

async function localSearch(q, limit) {
  const rows = await loadTickerList();
  return matchTickers(rows, q, limit).map((r) => ({
    symbol: yahooSymbol(r), name: r.n, exchange: r.x, board: r.b,
    sector: "", industry: r.ind || "", isin: r.i || "",
    code: r.x === "BSE" ? `${r.id || ""}${r.id ? " · " : ""}${r.s}` : r.s, source: "list",
  }));
}

export async function search(q, { indiaOnly = true, limit = 12 } = {}) {
  q = q.trim();
  if (!q) return [];
  return cached(`s:${q.toLowerCase()}:${indiaOnly}`, async () => {
    // The official NSE list answers instantly with no relay; Yahoo search (via the relay)
    // adds BSE-only listings and anything the list misses.
    const local = await localSearch(q, limit);
    let quotes = [];
    if (relayUrl()) {
      try { quotes = await Promise.race([yahooSearch(q), new Promise((_, rej) => setTimeout(() => rej(new Error("slow")), 6000))]); } catch { /* list results are enough */ }
    }
    if (!local.length && !quotes.length && !directCandidates(q).length && !relayUrl()) throw new NeedsRelayError("No data relay connected yet.");
    const seen = new Set(local.map((r) => r.symbol)), out = [...local];
    for (const it of quotes) {
      const sym = it.symbol;
      if (!sym || seen.has(sym) || (it.quoteType && it.quoteType !== "EQUITY")) continue;
      const ex = exchangeOf(sym);
      if (indiaOnly && ex.exchange === "OTHER") continue;
      seen.add(sym);
      out.push({
        symbol: sym, name: it.longname || it.shortname || sym,
        exchange: ex.exchange !== "OTHER" ? ex.exchange : it.exchDisp || it.exchange || "",
        board: ex.board, sector: it.sectorDisp || it.sector || "", industry: it.industryDisp || it.industry || "",
        source: "search",
      });
    }
    // Offer the raw input as a ticker only when it looks like one (typed in caps / a BSE code)
    // or when search found nothing.
    const tickerish = q === q.toUpperCase() || /^\d{6}$/.test(q);
    for (const sym of out.length && (!tickerish || local.length) ? [] : directCandidates(q)) {
      if (seen.has(sym)) continue;
      const ex = exchangeOf(sym);
      out.push({ symbol: sym, name: `${q.toUpperCase()} (direct ticker)`, ...ex, sector: "", industry: "", source: "direct" });
      seen.add(sym);
    }
    const order = { NSE: 0, BSE: 1 };
    const rank = { list: 0, search: 1, direct: 2 };
    out.sort((a, b) => rank[a.source] - rank[b.source] || (order[a.exchange] ?? 2) - (order[b.exchange] ?? 2));
    return out.slice(0, limit + 4);
  });
}

/* ---------- history ---------- */

/** Parse Yahoo's v8 chart payload into adjusted daily bars (same as yfinance auto_adjust). */
export function parseChart(body) {
  const r = body?.chart?.result?.[0];
  if (!r || !r.timestamp) return { bars: [], meta: r?.meta || {} };
  const q = r.indicators?.quote?.[0] || {};
  const adj = r.indicators?.adjclose?.[0]?.adjclose;
  const off = r.meta?.gmtoffset ?? 19800;
  const byDate = new Map();
  r.timestamp.forEach((ts, i) => {
    const c = q.close?.[i];
    if (c == null || !(c > 0)) return;
    const f = adj && adj[i] > 0 ? adj[i] / c : 1;
    const t = new Date((ts + off) * 1000).toISOString().slice(0, 10);
    byDate.set(t, {
      t, o: (q.open?.[i] ?? c) * f, h: (q.high?.[i] ?? c) * f, l: (q.low?.[i] ?? c) * f, c: c * f, v: q.volume?.[i] ?? 0,
    });
  });
  const bars = [...byDate.values()].sort((a, b) => a.t.localeCompare(b.t));
  return { bars, meta: r.meta || {} };
}

export function history(symbol) {
  symbol = symbol.toUpperCase();
  return cached(`h:${symbol}`, async () => {
    const now = Math.floor(Date.now() / 1000) + 86400;
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=0&period2=${now}&interval=1d&events=div%2Csplit&includeAdjustedClose=true`;
    let body;
    try { body = await relayFetch(url); } catch (e) {
      if (e instanceof RelayError) throw e;
      return { bars: [], meta: {} };
    }
    return parseChart(body);
  });
}

/** History for a symbol, trying NSE / BSE / SME suffixes when none was given. */
export async function resolve(symbol) {
  symbol = symbol.trim().toUpperCase();
  let cands = symbol.endsWith(".NS") || symbol.endsWith(".BO") || symbol.startsWith("^") ? [symbol] : directCandidates(symbol);
  if (symbol.endsWith("-SM.NS")) cands = [symbol, symbol.replace("-SM.NS", "-ST.NS"), symbol.replace("-SM.NS", ".NS")];
  for (const c of cands.length ? cands : [symbol]) {
    const h = await history(c).catch((e) => { if (e instanceof RelayError) throw e; return { bars: [] }; });
    if (h.bars.length > 5) return { symbol: c, ...h };
  }
  return null;
}

export async function info(symbol, hint = {}) {
  if (hint.sector) return hint;
  try {
    const quotes = await yahooSearch(symbol);
    const q = quotes.find((x) => x.symbol?.toUpperCase() === symbol.toUpperCase()) || {};
    return {
      name: hint.name || q.longname || q.shortname || symbol,
      sector: q.sectorDisp || q.sector || "", industry: q.industryDisp || q.industry || "",
    };
  } catch {
    return { name: hint.name || symbol, sector: "", industry: "" };
  }
}

/* ---------- news ---------- */

async function googleNews(query, from, to) {
  const q = `${query} after:${from} before:${to}`;
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-IN&gl=IN&ceid=IN:en`;
  const xml = await relayFetch(url, { type: "text" });
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  return [...doc.querySelectorAll("item")].map((it) => {
    let title = it.querySelector("title")?.textContent || "";
    const source = it.querySelector("source")?.textContent || "";
    if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3));
    const pub = it.querySelector("pubDate")?.textContent;
    const d = pub ? new Date(pub) : null;
    return { title, url: it.querySelector("link")?.textContent || "", source, date: d && !isNaN(d) ? d.toISOString().slice(0, 10) : null };
  });
}

/**
 * Headlines around a move. `extra` adds market / sector / commodity searches,
 * e.g. [{ query: "Sensex Nifty", scope: "market" }, { query: "crude oil price", scope: "sector" }].
 */
export function news({ symbol, name, start, end, sector = "", industry = "", extra = [] }) {
  const win = newsWindow(start, end);
  const clean = cleanCompanyName(name || symbol);
  const key = `n:${symbol}:${win.from}:${win.to}:${extra.map((x) => x.query).join("|")}`;
  return cached(key, async () => {
    const base = symbol.split(".")[0].replace(/-S[MT]$/, "");
    const queries = [clean && `"${clean}"`, !/^\d+$/.test(base) && `"${base}" share`].filter(Boolean);
    const raw = [], errors = [];
    for (const q of queries) {
      try { raw.push(...(await googleNews(q, win.from, win.to))); } catch (e) { errors.push(e.message); }
      if (raw.length >= 8) break;
    }
    const ctx = await Promise.all(extra.map(({ query, scope }) =>
      googleNews(query, win.from, win.to).then((items) => items.slice(0, 6).map((it) => ({ ...it, scope }))).catch((e) => { errors.push(e.message); return []; })));
    raw.push(...ctx.flat());
    if (!raw.length && errors.length) throw new RelayError(errors[0]);
    return { window: win, ...rankNews(raw, { start, sector, industry, name: name || symbol, ticker: base }), errors };
  });
}
