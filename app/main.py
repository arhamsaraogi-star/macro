"""FastAPI app: JSON API + the static single-page frontend."""

from __future__ import annotations

from pathlib import Path

import pandas as pd
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from starlette.concurrency import run_in_threadpool

from . import analysis, demo, market, news

STATIC = Path(__file__).resolve().parent.parent / "static"

app = FastAPI(title="Macro — Stock Move Forensics")


@app.get("/api/health")
def health():
    return {"ok": True, "demo": demo.enabled()}


@app.get("/api/search")
async def search(q: str = Query(..., min_length=1), india_only: bool = True):
    return {"results": await run_in_threadpool(market.search, q, india_only)}


def _analyze(symbol, mode, daily, weekly, monthly, years, sigma_years):
    hist = market.resolve(symbol)
    if hist is None:
        raise HTTPException(404, f"No price history found for '{symbol}'. Try the search box to pick the exact NSE/BSE ticker.")
    df = hist.df
    meta = market.info(hist.symbol)
    bench_sym, bench_name = market.benchmark_for(hist.symbol)
    try:
        bench = market.history(bench_sym)
        bench_close = bench["Close"] if bench is not None and not bench.empty else None
    except Exception:
        bench_close = None

    thresholds = {"daily": daily, "weekly": weekly, "monthly": monthly}
    events = analysis.find_events(df, thresholds, bench_close, mode=mode, sigma_years=sigma_years)

    # Analyse on full history (so σ / volume baselines are warm), then clip the view.
    if years != "max":
        cutoff = df.index[-1] - pd.DateOffset(years=int(years))
        view = df[df.index >= cutoff]
        events = [e for e in events if e["end"] >= cutoff.strftime("%Y-%m-%d")]
    else:
        view = df

    # Daily return vs trailing σ, for the "returns vs σ bands" chart.
    per = analysis.periods(df, "daily", sigma_years).loc[view.index[1:] if len(view) > 1 else view.index]
    returns = [
        {"t": d.strftime("%Y-%m-%d"), "r": analysis._f(r), "s": analysis._f(s)}
        for d, r, s in zip(per.index, per["ret"], per["sigma"])
    ]
    current_sigma = {}
    for frame in analysis.FRAMES:
        p = analysis.periods(df, frame, sigma_years)
        last = p["ret"].iloc[-analysis.PERIODS_PER_YEAR[frame] * max(int(sigma_years), 1):]
        current_sigma[frame] = analysis._f(last.std()) if len(last) > 2 else None

    ex = market.exchange_of(hist.symbol)
    return {
        "symbol": hist.symbol,
        "requested": symbol,
        "info": meta,
        "exchange": ex["exchange"],
        "board": ex["board"],
        "benchmark": {"symbol": bench_sym, "name": bench_name, "available": bench_close is not None},
        "playbook": [{"key": k, "label": news.CATEGORY_LABELS[k]} for k in news.playbook(meta.get("sector", ""), meta.get("industry", ""))],
        "params": {"mode": mode, "thresholds": thresholds, "years": years, "sigmaYears": sigma_years},
        "firstDate": df.index[0].strftime("%Y-%m-%d"),
        "lastDate": df.index[-1].strftime("%Y-%m-%d"),
        "listedYears": round((df.index[-1] - df.index[0]).days / 365.25, 1),
        "currentSigma": current_sigma,
        "series": analysis.price_series(view),
        "returns": returns,
        "events": events,
        "summary": analysis.summarize(events),
        "categoryLabels": news.CATEGORY_LABELS,
        "demo": demo.enabled(),
    }


@app.get("/api/analyze")
async def analyze(
    symbol: str = Query(..., min_length=1),
    mode: str = Query("percent", pattern="^(percent|sigma)$"),
    daily: float = Query(5.0, ge=0),
    weekly: float = Query(5.0, ge=0),
    monthly: float = Query(5.0, ge=0),
    years: str = Query("20", pattern=r"^(max|\d{1,2})$"),
    sigma_years: float = Query(1.0, gt=0, le=10),
):
    return await run_in_threadpool(_analyze, symbol, mode, daily, weekly, monthly, years, sigma_years)


@app.get("/api/news")
async def get_news(
    symbol: str,
    name: str = "",
    start: str = Query(..., pattern=r"^\d{4}-\d{2}-\d{2}$"),
    end: str = Query(..., pattern=r"^\d{4}-\d{2}-\d{2}$"),
    sector: str = "",
    industry: str = "",
):
    return await run_in_threadpool(news.fetch, name or symbol, symbol, start, end, sector, industry)


@app.get("/")
def index():
    return FileResponse(STATIC / "index.html")


app.mount("/static", StaticFiles(directory=STATIC), name="static")
