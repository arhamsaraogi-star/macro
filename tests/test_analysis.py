import numpy as np
import pandas as pd

from app import analysis, market, news


def make_df(n=400, jump_at=300, jump=0.08, buildup=True):
    idx = pd.bdate_range("2020-01-01", periods=n)
    rng = np.random.default_rng(0)
    rets = rng.normal(0, 0.01, n)
    rets[jump_at] = jump
    vol = np.full(n, 1000.0)
    if buildup:
        vol[jump_at - 5:jump_at] = 3000.0
    close = 100 * np.exp(np.cumsum(rets))
    return pd.DataFrame({"Open": close, "High": close * 1.01, "Low": close * 0.99, "Close": close, "Volume": vol}, index=idx), idx[jump_at]


def test_percent_threshold_finds_jump_with_volume_buildup():
    df, day = make_df()
    evs = analysis.find_events(df, {"daily": 5})
    hit = [e for e in evs if e["end"] == day.strftime("%Y-%m-%d")]
    assert len(hit) == 1
    e = hit[0]
    assert e["direction"] == "up"
    assert abs(e["change"] - (np.exp(0.08) - 1)) < 1e-3
    assert e["pre"]["volumeRatio"] == 3.0
    assert "volume_buildup" in e["flags"]
    assert len(e["pre"]["series"]) == 5


def test_sigma_mode_uses_trailing_std():
    df, day = make_df(jump=0.04)  # 4% move on ~1% daily sigma -> ~4 sigma
    pct = analysis.find_events(df, {"daily": 5})
    assert not any(e["end"] == day.strftime("%Y-%m-%d") for e in pct)
    sig = analysis.find_events(df, {"daily": 3}, mode="sigma")
    hit = [e for e in sig if e["end"] == day.strftime("%Y-%m-%d")]
    assert hit and hit[0]["zScore"] > 3
    assert all(abs(e["zScore"]) >= 3 for e in sig)


def test_weekly_and_monthly_periods():
    df, _ = make_df()
    for frame in ("weekly", "monthly"):
        per = analysis.periods(df, frame)
        assert (per["end"] >= per["start"]).all()
        evs = analysis.find_events(df, {frame: 5})
        assert all(e["frame"] == frame for e in evs)
    summ = analysis.summarize(analysis.find_events(df, {"daily": 5, "weekly": 5, "monthly": 5}))
    assert set(summ) == {"daily", "weekly", "monthly"}


def test_benchmark_flags():
    df, day = make_df()
    bench = df["Close"].copy()  # identical benchmark => market-driven
    evs = analysis.find_events(df, {"daily": 5}, bench_close=bench)
    e = next(e for e in evs if e["end"] == day.strftime("%Y-%m-%d"))
    assert "market_driven" in e["flags"]


def test_symbols():
    assert market.exchange_of("ABC-SM.NS") == {"exchange": "NSE", "board": "SME"}
    assert market.exchange_of("LT.NS")["exchange"] == "NSE"
    assert market.exchange_of("500325.BO")["exchange"] == "BSE"
    assert market.direct_candidates("500325") == ["500325.BO"]
    assert market.direct_candidates("tatamotors")[:2] == ["TATAMOTORS.NS", "TATAMOTORS.BO"]
    assert market.direct_candidates("larsen and toubro") == []


def test_news_classification():
    assert news.classify("L&T bags mega order from NHAI")[0] == "orders"
    assert news.classify("Maruti Suzuki October sales rise 12%")[0] == "sales"
    assert news.classify("Sun Pharma gets USFDA warning letter")[0] == "regulatory"
    assert news.classify("Infosys Q2 results: net profit up 5%")[0] == "results"
    assert news.classify("Board approves 1:1 bonus issue")[0] == "corporate_action"
    assert news.clean_company_name("Larsen & Toubro Limited") == "Larsen & Toubro"
    assert news.playbook("Consumer Cyclical", "Auto Manufacturers")[0] == "sales"
