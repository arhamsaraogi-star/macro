"""Offline demo data (set MACRO_DEMO=1). Lets the UI run without network access."""

from __future__ import annotations

import os
import random
from datetime import date, timedelta

import numpy as np
import pandas as pd

_COMPANIES = [
    ("LT.NS", "Larsen & Toubro Limited", "Industrials", "Engineering & Construction"),
    ("LT.BO", "Larsen & Toubro Limited", "Industrials", "Engineering & Construction"),
    ("TATAMOTORS.NS", "Tata Motors Limited", "Consumer Cyclical", "Auto Manufacturers"),
    ("SUNPHARMA.NS", "Sun Pharmaceutical Industries Limited", "Healthcare", "Drug Manufacturers"),
    ("KRISHCA-SM.NS", "Krishca Strapping Solutions Limited", "Basic Materials", "Steel"),
    ("500325.BO", "Reliance Industries Limited", "Energy", "Oil & Gas Refining"),
]

_HEADLINES = [
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
]


def enabled() -> bool:
    return os.environ.get("MACRO_DEMO", "").lower() in {"1", "true", "yes"}


def search(q: str) -> list[dict]:
    from .market import exchange_of

    ql = q.lower()
    out = []
    for sym, name, sector, industry in _COMPANIES:
        if ql in name.lower() or ql in sym.lower():
            ex = exchange_of(sym)
            out.append({"symbol": sym, "name": name, "exchange": ex["exchange"], "board": ex["board"],
                        "sector": sector, "industry": industry, "source": "search"})
    return out


def info(symbol: str) -> dict:
    for sym, name, sector, industry in _COMPANIES:
        if sym == symbol:
            return {"name": name, "sector": sector, "industry": industry, "currency": "INR"}
    return {"name": symbol, "sector": "", "industry": "", "currency": "INR"}


def history(symbol: str) -> pd.DataFrame:
    seed = sum(map(ord, symbol))
    rng = np.random.default_rng(seed)
    years = 8 if "SM" in symbol else 20
    idx = pd.bdate_range(end=pd.Timestamp("2026-10-02"), periods=252 * years)
    rets = rng.normal(0.0005, 0.017, len(idx))
    vol = rng.lognormal(13, 0.35, len(idx))
    # inject catalysts with a volume build-up the week before
    for i in rng.choice(np.arange(80, len(idx) - 10), size=len(idx) // 180, replace=False):
        rets[i] = rng.choice([-1, 1]) * rng.uniform(0.05, 0.13)
        vol[i] *= rng.uniform(3, 7)
        if rng.random() < 0.5:
            vol[i - 5:i] *= rng.uniform(1.6, 2.5)
            rets[i - 5:i] += np.sign(rets[i]) * 0.006
    close = 100 * np.exp(np.cumsum(rets))
    opn = close / np.exp(rets * rng.uniform(0.3, 0.8, len(idx)))
    high = np.maximum(opn, close) * (1 + np.abs(rng.normal(0, 0.006, len(idx))))
    low = np.minimum(opn, close) * (1 - np.abs(rng.normal(0, 0.006, len(idx))))
    return pd.DataFrame({"Open": opn, "High": high, "Low": low, "Close": close, "Volume": vol.round()}, index=idx)


def news(name: str, d0: date, d1: date) -> list[dict]:
    rnd = random.Random(f"{name}{d0}")
    out = []
    for _ in range(rnd.randint(2, 6)):
        d = d0 + timedelta(days=rnd.randint(0, max((d1 - d0).days, 0)))
        out.append({"title": rnd.choice(_HEADLINES).format(n=name, q=rnd.randint(1, 4)) + " (demo)",
                    "url": "https://news.google.com/", "source": "Demo Wire", "date": d.isoformat()})
    return out
