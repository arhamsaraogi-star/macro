"""Market data access: ticker search, symbol resolution and price history.

Everything goes through Yahoo Finance (via ``yfinance``). Indian listings use
Yahoo's suffix convention:

* ``RELIANCE.NS``      – NSE main board
* ``XYZ-SM.NS``        – NSE Emerge (SME) series "SM"
* ``XYZ-ST.NS``        – NSE SME trade-for-trade series "ST"
* ``500325.BO`` / ``RELIANCE.BO`` – BSE (main board and BSE SME share the .BO suffix)
"""

from __future__ import annotations

import re
import time
from dataclasses import dataclass
from threading import Lock
from typing import Any

import pandas as pd

from . import demo

INDIAN_EXCHANGES = {"NSI": "NSE", "BSE": "BSE", "BOM": "BSE"}
BENCHMARKS = {"NSE": ("^NSEI", "NIFTY 50"), "BSE": ("^BSESN", "SENSEX")}


class TTLCache:
    def __init__(self, ttl: float, max_items: int = 256):
        self.ttl = ttl
        self.max_items = max_items
        self._data: dict[Any, tuple[float, Any]] = {}
        self._lock = Lock()

    def get(self, key):
        with self._lock:
            hit = self._data.get(key)
            if hit and time.time() - hit[0] < self.ttl:
                return hit[1]
            self._data.pop(key, None)
            return None

    def set(self, key, value):
        with self._lock:
            if len(self._data) >= self.max_items:
                oldest = min(self._data, key=lambda k: self._data[k][0])
                self._data.pop(oldest, None)
            self._data[key] = (time.time(), value)
        return value


_history_cache = TTLCache(ttl=60 * 60)
_search_cache = TTLCache(ttl=60 * 60 * 6)
_info_cache = TTLCache(ttl=60 * 60 * 12)


def exchange_of(symbol: str) -> dict[str, str]:
    """Classify a Yahoo symbol into exchange / board."""
    s = symbol.upper()
    if s.endswith(".NS"):
        base = s[:-3]
        if base.endswith("-SM") or base.endswith("-ST"):
            return {"exchange": "NSE", "board": "SME"}
        return {"exchange": "NSE", "board": "Main"}
    if s.endswith(".BO"):
        return {"exchange": "BSE", "board": "Main/SME"}
    return {"exchange": "OTHER", "board": ""}


def _looks_like_ticker(q: str) -> bool:
    return bool(re.fullmatch(r"[A-Za-z0-9&\-\.]{2,20}", q.strip()))


def direct_candidates(q: str) -> list[str]:
    """Symbols to try when the user typed something that already looks like a ticker."""
    q = q.strip().upper()
    if not _looks_like_ticker(q):
        return []
    if q.endswith((".NS", ".BO")):
        return [q]
    if q.isdigit() and len(q) == 6:  # BSE scrip code
        return [f"{q}.BO"]
    base = q.split(".")[0]
    return [f"{base}.NS", f"{base}.BO", f"{base}-SM.NS", f"{base}-ST.NS"]


def search(q: str, india_only: bool = True, limit: int = 12) -> list[dict]:
    q = q.strip()
    if not q:
        return []
    key = (q.lower(), india_only)
    cached = _search_cache.get(key)
    if cached is not None:
        return cached

    if demo.enabled():
        return demo.search(q)

    import yfinance as yf

    results: list[dict] = []
    seen: set[str] = set()
    try:
        quotes = yf.Search(
            q, max_results=20, news_count=0, lists_count=0, include_cb=False,
            enable_fuzzy_query=True, raise_errors=False,
        ).quotes or []
    except Exception:
        quotes = []

    for item in quotes:
        sym = item.get("symbol")
        if not sym or sym in seen:
            continue
        if item.get("quoteType") not in (None, "EQUITY"):
            continue
        ex = exchange_of(sym)
        if india_only and ex["exchange"] == "OTHER":
            continue
        seen.add(sym)
        results.append({
            "symbol": sym,
            "name": item.get("longname") or item.get("shortname") or sym,
            "exchange": ex["exchange"] if ex["exchange"] != "OTHER" else (item.get("exchDisp") or item.get("exchange") or ""),
            "board": ex["board"],
            "sector": item.get("sectorDisp") or item.get("sector") or "",
            "industry": item.get("industryDisp") or item.get("industry") or "",
            "source": "search",
        })

    # If the query already looks like a ticker / BSE code, offer it directly too.
    for sym in direct_candidates(q):
        if sym not in seen:
            ex = exchange_of(sym)
            results.append({
                "symbol": sym, "name": f"{q.upper()} (direct ticker)",
                "exchange": ex["exchange"], "board": ex["board"],
                "sector": "", "industry": "", "source": "direct",
            })
            seen.add(sym)

    # NSE first, then BSE, then everything else.
    order = {"NSE": 0, "BSE": 1}
    results.sort(key=lambda r: (r["source"] != "search", order.get(r["exchange"], 2)))
    results = results[:limit]
    return _search_cache.set(key, results)


@dataclass
class History:
    symbol: str
    df: pd.DataFrame  # Open, High, Low, Close, Volume; tz-naive DatetimeIndex


def _clean(df: pd.DataFrame) -> pd.DataFrame:
    if df is None or df.empty:
        return pd.DataFrame()
    df = df.copy()
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.get_level_values(0)
    idx = pd.DatetimeIndex(df.index)
    if idx.tz is not None:
        idx = idx.tz_localize(None)
    df.index = idx.normalize()
    cols = [c for c in ["Open", "High", "Low", "Close", "Volume"] if c in df.columns]
    df = df[cols]
    df = df[~df.index.duplicated(keep="last")].sort_index()
    df = df.dropna(subset=["Close"])
    df = df[df["Close"] > 0]
    if "Volume" in df.columns:
        df["Volume"] = df["Volume"].fillna(0)
    return df


def _download(symbol: str) -> pd.DataFrame:
    if demo.enabled():
        return demo.history(symbol)
    import yfinance as yf

    df = yf.Ticker(symbol).history(period="max", interval="1d", auto_adjust=True, actions=False)
    return _clean(df)


def history(symbol: str) -> pd.DataFrame:
    symbol = symbol.upper()
    cached = _history_cache.get(symbol)
    if cached is not None:
        return cached
    df = _download(symbol)
    if df is not None and not df.empty:
        _history_cache.set(symbol, df)
    return df


def resolve(symbol: str) -> History | None:
    """Fetch history for a symbol, trying NSE/BSE/SME suffixes if none was given."""
    symbol = symbol.strip().upper()
    candidates = [symbol] if symbol.endswith((".NS", ".BO")) or symbol.startswith("^") else direct_candidates(symbol) or [symbol]
    for cand in candidates:
        try:
            df = history(cand)
        except Exception:
            df = None
        if df is not None and len(df) > 5:
            return History(cand, df)
    return None


def info(symbol: str) -> dict:
    cached = _info_cache.get(symbol)
    if cached is not None:
        return cached
    if demo.enabled():
        return _info_cache.set(symbol, demo.info(symbol))
    out = {"name": symbol, "sector": "", "industry": "", "currency": "INR"}
    try:
        import yfinance as yf

        raw = yf.Ticker(symbol).get_info() or {}
        out.update({
            "name": raw.get("longName") or raw.get("shortName") or symbol,
            "sector": raw.get("sector") or "",
            "industry": raw.get("industry") or "",
            "currency": raw.get("currency") or "INR",
            "marketCap": raw.get("marketCap"),
            "website": raw.get("website") or "",
        })
    except Exception:
        pass
    return _info_cache.set(symbol, out)


def benchmark_for(symbol: str) -> tuple[str, str]:
    ex = exchange_of(symbol)["exchange"]
    return BENCHMARKS.get(ex, BENCHMARKS["NSE"])
