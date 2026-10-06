"""Big-move detection and pre-move (1 week prior) price/volume forensics."""

from __future__ import annotations

import math

import numpy as np
import pandas as pd

FRAMES = {
    "daily": None,
    "weekly": "W-FRI",
    "monthly": "ME",
}
PRE_DAYS = 5          # one trading week before the move
POST_DAYS = 5         # follow-through window after the move
BASELINE_DAYS = 50    # "normal" volume, measured before the pre-window
VOLUME_BUILDUP = 1.5  # pre-window volume / baseline that counts as a build-up
PERIODS_PER_YEAR = {"daily": 252, "weekly": 52, "monthly": 12}
MIN_SIGMA_OBS = {"daily": 60, "weekly": 26, "monthly": 12}


def _f(x, nd=4):
    if x is None:
        return None
    try:
        x = float(x)
    except (TypeError, ValueError):
        return None
    if math.isnan(x) or math.isinf(x):
        return None
    return round(x, nd)


def periods(df: pd.DataFrame, frame: str, sigma_years: float = 1.0) -> pd.DataFrame:
    """One row per period with start/end trading-day positions, period return and
    the trailing standard deviation of that frame's returns (excluding the period itself)."""
    pos = pd.Series(np.arange(len(df)), index=df.index)
    if FRAMES[frame] is None:
        out = pd.DataFrame({"start": pos.values, "end": pos.values}, index=df.index)
    else:
        g = pos.resample(FRAMES[frame])
        out = pd.DataFrame({"start": g.first(), "end": g.last()}).dropna().astype(int)
    close = df["Close"].to_numpy()
    end_close = close[out["end"].to_numpy()]
    prev_close = np.concatenate([[np.nan], end_close[:-1]])
    out["ret"] = end_close / prev_close - 1
    window = max(int(round(PERIODS_PER_YEAR[frame] * sigma_years)), MIN_SIGMA_OBS[frame])
    out["sigma"] = out["ret"].rolling(window, min_periods=MIN_SIGMA_OBS[frame]).std().shift(1)
    out["z"] = out["ret"] / out["sigma"]
    return out.iloc[1:]


def _window(df: pd.DataFrame, a: int, b: int) -> pd.DataFrame:
    return df.iloc[max(a, 0):max(b, 0)]


def _benchmark_return(bench: pd.Series | None, start_date, end_date, prev_date):
    if bench is None or bench.empty:
        return None
    try:
        p0 = bench.asof(prev_date)
        p1 = bench.asof(end_date)
        if pd.isna(p0) or pd.isna(p1) or p0 <= 0:
            return None
        return p1 / p0 - 1
    except Exception:
        return None


def find_events(
    df: pd.DataFrame,
    thresholds: dict[str, float],
    bench_close: pd.Series | None = None,
    mode: str = "percent",
    sigma_years: float = 1.0,
) -> list[dict]:
    """Return every period whose absolute move crosses the threshold.

    mode="percent": threshold is a % move (5 -> +/-5%).
    mode="sigma":   threshold is a multiple of the trailing standard deviation of
                    that frame's returns over ``sigma_years`` (2 -> a 2-sigma move).
    """
    close = df["Close"].to_numpy()
    vol = df["Volume"].to_numpy(dtype=float) if "Volume" in df else np.zeros(len(df))
    dates = df.index
    daily_ret = np.concatenate([[np.nan], close[1:] / close[:-1] - 1])
    events: list[dict] = []

    for frame, thr in thresholds.items():
        if thr is None or thr <= 0 or frame not in FRAMES:
            continue
        per = periods(df, frame, sigma_years)
        if mode == "sigma":
            hits = per[per["z"].abs() >= thr]
        else:
            hits = per[per["ret"].abs() >= thr / 100.0]
        for period_label, row in hits.iterrows():
            s, e = int(row["start"]), int(row["end"])
            pre_a, pre_b = s - PRE_DAYS, s            # 5 sessions before the period starts
            base_a, base_b = pre_a - BASELINE_DAYS, pre_a

            pre = _window(df, pre_a, pre_b)
            base_vol = vol[max(base_a, 0):max(base_b, 0)]
            base_vol = base_vol[base_vol > 0]
            baseline = float(base_vol.mean()) if len(base_vol) >= 10 else None

            pre_vol = float(pre["Volume"].mean()) if len(pre) and "Volume" in pre else None
            ev_vol = float(vol[s:e + 1].mean())
            pre_ret = (close[pre_b - 1] / close[pre_a - 1] - 1) if pre_a >= 1 else None
            pre_moves = daily_ret[max(pre_a, 1):pre_b]
            pre_max_abs = float(np.nanmax(np.abs(pre_moves))) if len(pre_moves) else None
            pre_range = (float(pre["High"].max() / pre["Low"].min() - 1)
                         if len(pre) and "High" in pre and pre["Low"].min() > 0 else None)

            post_ret = (close[min(e + POST_DAYS, len(close) - 1)] / close[e] - 1) if e + 1 < len(close) else None

            prev_date = dates[s - 1] if s >= 1 else dates[s]
            bench_ret = _benchmark_return(bench_close, dates[s], dates[e], prev_date)

            vol_ratio_pre = pre_vol / baseline if baseline and pre_vol is not None else None
            vol_ratio_event = ev_vol / baseline if baseline else None
            direction = "up" if row["ret"] > 0 else "down"

            flags = []
            if vol_ratio_pre is not None and vol_ratio_pre >= VOLUME_BUILDUP:
                flags.append("volume_buildup")
            move_thr = abs(row["ret"]) if mode == "sigma" else thr / 100.0
            if pre_ret is not None and abs(pre_ret) >= max(move_thr / 2.0, 0.02):
                same = (pre_ret > 0) == (row["ret"] > 0)
                flags.append("pre_drift_same" if same else "pre_drift_opposite")
            if vol_ratio_event is not None and vol_ratio_event >= 2:
                flags.append("event_volume_spike")
            if bench_ret is not None:
                if abs(bench_ret) >= abs(row["ret"]) * 0.5 and (bench_ret > 0) == (row["ret"] > 0):
                    flags.append("market_driven")
                else:
                    flags.append("stock_specific")
            if post_ret is not None:
                flags.append("follow_through" if (post_ret > 0) == (row["ret"] > 0) else "reversal")

            events.append({
                "id": f"{frame}-{dates[e].strftime('%Y-%m-%d')}",
                "frame": frame,
                "direction": direction,
                "start": dates[s].strftime("%Y-%m-%d"),
                "end": dates[e].strftime("%Y-%m-%d"),
                "change": _f(row["ret"]),
                "sigma": _f(row["sigma"]),
                "zScore": _f(row["z"], 2),
                "close": _f(close[e], 2),
                "prevClose": _f(close[s - 1], 2) if s >= 1 else None,
                "benchmarkChange": _f(bench_ret),
                "relativeChange": _f(row["ret"] - bench_ret) if bench_ret is not None else None,
                "pre": {
                    "from": dates[max(pre_a, 0)].strftime("%Y-%m-%d") if pre_b > 0 else None,
                    "to": dates[pre_b - 1].strftime("%Y-%m-%d") if pre_b > 0 else None,
                    "change": _f(pre_ret),
                    "maxDailyMove": _f(pre_max_abs),
                    "range": _f(pre_range),
                    "avgVolume": _f(pre_vol, 0),
                    "volumeRatio": _f(vol_ratio_pre, 2),
                    "series": [
                        {"d": d.strftime("%Y-%m-%d"), "c": _f(c, 2), "v": _f(v, 0)}
                        for d, c, v in zip(pre.index, pre["Close"], pre.get("Volume", pd.Series(0, index=pre.index)))
                    ],
                },
                "eventVolumeRatio": _f(vol_ratio_event, 2),
                "baselineVolume": _f(baseline, 0),
                "postChange": _f(post_ret),
                "flags": flags,
            })

    events.sort(key=lambda ev: ev["end"])
    return events


def summarize(events: list[dict]) -> dict:
    out: dict[str, dict] = {}
    for frame in FRAMES:
        evs = [e for e in events if e["frame"] == frame]
        if not evs:
            out[frame] = {"count": 0}
            continue
        up = [e for e in evs if e["direction"] == "up"]
        down = [e for e in evs if e["direction"] == "down"]

        def share(group, flag):
            return _f(sum(flag in e["flags"] for e in group) / len(group), 3) if group else None

        def avg(group, getter):
            vals = [getter(e) for e in group if getter(e) is not None]
            return _f(sum(vals) / len(vals)) if vals else None

        out[frame] = {
            "count": len(evs),
            "up": len(up),
            "down": len(down),
            "biggestUp": max((e["change"] for e in up), default=None),
            "biggestDown": min((e["change"] for e in down), default=None),
            "maxAbsZ": max((abs(e["zScore"]) for e in evs if e["zScore"] is not None), default=None),
            "volumeBuildupShare": share(evs, "volume_buildup"),
            "volumeBuildupShareUp": share(up, "volume_buildup"),
            "volumeBuildupShareDown": share(down, "volume_buildup"),
            "stockSpecificShare": share(evs, "stock_specific"),
            "followThroughShare": share(evs, "follow_through"),
            "avgPreChangeUp": avg(up, lambda e: e["pre"]["change"]),
            "avgPreChangeDown": avg(down, lambda e: e["pre"]["change"]),
            "avgPreVolumeRatio": avg(evs, lambda e: e["pre"]["volumeRatio"]),
            "byYear": _by_year(evs),
        }
    return out


def _by_year(evs: list[dict]) -> list[dict]:
    years: dict[str, dict] = {}
    for e in evs:
        y = e["end"][:4]
        years.setdefault(y, {"year": y, "up": 0, "down": 0})
        years[y][e["direction"]] += 1
    return [years[k] for k in sorted(years)]


def price_series(df: pd.DataFrame) -> list[dict]:
    vol = df["Volume"] if "Volume" in df else pd.Series(0, index=df.index)
    return [
        {"t": d.strftime("%Y-%m-%d"), "o": _f(o, 2), "h": _f(h, 2), "l": _f(l, 2), "c": _f(c, 2), "v": _f(v, 0)}
        for d, o, h, l, c, v in zip(df.index, df["Open"], df["High"], df["Low"], df["Close"], vol)
    ]
