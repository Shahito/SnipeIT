"""
compute_results.py - Post-simulation aggregation & serialization.

Takes raw simulation output and produces the final result dict.
Call build_result() at the end of run_backtest().
"""

import math
from collections import Counter
import numpy as np
import pandas as pd
import json
import logging

log = logging.getLogger("snipeit.backtest")

# Helpers
def _lttb_idx(x_arr, y_arr, threshold):
    """
    Largest-Triangle-Three-Buckets downsampling.
    Falls back to uniform stride if lttbc isn't installed.
    Returns a list of indices into the original arrays.
    """
    try:
        import lttbc
        if len(x_arr) <= threshold:
            return list(range(len(x_arr)))
        xs, _ = lttbc.downsample(
            np.array(x_arr, dtype=np.float64),
            np.array(y_arr, dtype=np.float64),
            threshold,
        )
        return np.searchsorted(np.array(x_arr, dtype=np.float64), xs).tolist()
    except ImportError:
        step = max(1, len(x_arr) // threshold)
        return list(range(0, len(x_arr), step))


CURVE_THRESHOLD = 300

REASON_LABELS = {"risk": "risk", "tsl": "tsl", "signal": "signal", "end": "end"}

# Pnl buckets (histogram) 
def _pnl_buckets(sell_trades: list, bucket_count: int = 30) -> list:
    """
    Returns a list of dicts: [{label, count, wins, losses, lo}, ...]
    """
    vals   = [t["pnl"] for t in sell_trades if t.get("pnl") is not None]
    if not vals:
        return []

    losses = [v for v in vals if v < 0]
    wins   = [v for v in vals if v >= 0]
    fmt    = lambda v: ('+' if v >= 0 else '') + f"{v:.1f}%"
    buckets = []

    def _make_buckets(series, half):
        if not series:
            return
        mn, mx = min(series), max(series)
        size   = (mx - mn) / half or 1
        is_win = series is wins
        for i in range(half):
            lo      = mn + i * size
            hi      = lo + size
            last    = i == half - 1
            in_buck = (lambda v: v >= lo and v <= mx) if last else (lambda v: v >= lo and v < hi)
            cnt     = sum(1 for v in series if in_buck(v))
            if cnt:
                buckets.append({
                    "label":  f"{fmt(lo)} · {fmt(hi)}",
                    "count":  cnt,
                    "wins":   cnt if is_win else 0,
                    "losses": 0   if is_win else cnt,
                    "lo":     lo,
                })

    half = math.ceil(bucket_count / 2)
    _make_buckets(losses, half)
    _make_buckets(wins,   half)
    buckets.sort(key=lambda b: b["lo"])
    return buckets


# Exit reasons
def _exit_reasons(sell_trades: list) -> dict:
    total  = len(sell_trades)
    result = {}
    for t in sell_trades:
        r = t.get("reason", "signal")
        if r not in result:
            result[r] = {"total": 0, "wins": 0, "losses": 0}
        result[r]["total"] += 1
        pnl = t.get("pnl")
        if pnl is not None and pnl > 0:
            result[r]["wins"] += 1
        elif pnl is not None and pnl < 0:
            result[r]["losses"] += 1
    for r, v in result.items():
        v["winPct"]   = round(v["wins"]   / total * 100, 1) if total else 0.0
        v["lossPct"]  = round(v["losses"] / total * 100, 1) if total else 0.0
        v["totalPct"] = round(v["total"]  / total * 100, 1) if total else 0.0
    return result


# Curves
def _equity_curve_ds(equity_dates: list, equity_raw: np.ndarray) -> list:
    n    = len(equity_raw)
    idx  = _lttb_idx(np.arange(n, dtype=np.float64), equity_raw, CURVE_THRESHOLD)
    return [
        {"t": int(pd.Timestamp(equity_dates[i]).timestamp()), "e": float(equity_raw[i])}
        for i in idx
    ]

def _price_curve_ds(ts_arr, close_arr: np.ndarray) -> list:
    n   = len(close_arr)
    idx = _lttb_idx(np.arange(n, dtype=np.float64), close_arr, CURVE_THRESHOLD)
    return [
        {"t": int(pd.Timestamp(ts_arr[i]).timestamp()), "c": round(float(close_arr[i]), 4)}
        for i in idx
    ]

def _drawdown_curve_ds(equity_raw: np.ndarray) -> list:
    n         = len(equity_raw)
    dd        = np.empty(n, dtype=np.float64)
    peak      = equity_raw[0] if n else 1.0
    for i, e in enumerate(equity_raw):
        if e > peak:
            peak = e
        dd[i] = round(-(peak - e) / peak * 100, 2) if peak > 0 else 0.0
    idx = _lttb_idx(np.arange(n, dtype=np.float64), dd, CURVE_THRESHOLD)
    return [
        {"x": round(i / (n - 1), 6) if n > 1 else 0.0, "dd": float(dd[i])}
        for i in idx
    ]

def _pnl_curve_ds(equity_dates: list, sell_trades: list) -> list:
    if not equity_dates:
        return []
    t0       = pd.Timestamp(equity_dates[0])
    t1       = pd.Timestamp(equity_dates[-1])
    span     = (t1 - t0).total_seconds() or 1
    cum      = 0.0
    pts      = [{"x": 0.0, "pnl": 0.0}]
    for t in sell_trades:
        cum += t.get("pnl") or 0
        x    = min(1.0, max(0.0, (pd.Timestamp(t["date"]) - t0).total_seconds() / span))
        pts.append({"x": round(x, 4), "pnl": round(cum, 2)})
    pts.append({"x": 1.0, "pnl": round(cum, 2)})
    xs  = np.array([p["x"]   for p in pts], dtype=np.float64)
    ys  = np.array([p["pnl"] for p in pts], dtype=np.float64)
    idx = _lttb_idx(xs, ys, CURVE_THRESHOLD)
    return [{"x": pts[i]["x"], "p": pts[i]["pnl"]} for i in idx]

# Monthly perf (strat vs asset)
def _monthly_perf(sell_trades: list, ts_arr, close_arr: np.ndarray) -> list:
    """
    Returns list of { month: 'YYYY-MM', strat: float, asset: float }
    strat  = sum of pnl% of sell_trades closed in that calendar month
    asset  = % change of close price between first and last candle of that month
    Months with no trades are included with strat=0.
    """
    if not sell_trades:
        return []

    # Build a close price Series indexed by timestamp
    close_s = pd.Series(
        close_arr.astype(float),
        index=pd.DatetimeIndex(ts_arr),
    ).sort_index()

    # Determine month range from backtest span
    first_month = close_s.index[0].to_period('M')
    last_month  = close_s.index[-1].to_period('M')
    periods     = pd.period_range(first_month, last_month, freq='M')

    # Aggregate strat pnl per month
    strat_by_month: dict[str, float] = {}
    for t in sell_trades:
        key = pd.Timestamp(t["date"]).strftime('%Y-%m')
        strat_by_month[key] = round(strat_by_month.get(key, 0.0) + (t.get("pnl") or 0.0), 2)

    result = []
    for period in periods:
        key    = str(period) # 'YYYY-MM'
        month  = period.to_timestamp()

        # Asset perf: first vs last close of the month
        mask   = (close_s.index >= month) & (close_s.index < month + pd.offsets.MonthBegin(1))
        subset = close_s[mask]
        if len(subset) >= 2:
            asset_pct = round((subset.iloc[-1] / subset.iloc[0] - 1) * 100, 2)
        elif len(subset) == 1:
            asset_pct = 0.0
        else:
            asset_pct = None # month outside price data (shouldn't happen)

        result.append({
            "month": key,
            "strat": strat_by_month.get(key, 0.0),
            "asset": asset_pct,
        })

    return result

# Exposure
def _exposure_pct(trades: list, equity_dates: list) -> float:
    sell_trades = [t for t in trades if t["side"] == "sell"]
    n_ec        = len(equity_dates)
    if not sell_trades or not n_ec:
        return 0.0

    buy_arr  = np.array([pd.Timestamp(t["date"]) for t in trades if t["side"] == "buy"],  dtype="datetime64[ns]")
    sell_arr = np.array([pd.Timestamp(t["date"]) for t in trades if t["side"] == "sell"], dtype="datetime64[ns]")
    ec_ts    = pd.DatetimeIndex(equity_dates).to_numpy(dtype="datetime64[ns]")
    idx_arr  = np.searchsorted(buy_arr, ec_ts, side="right") - 1
    valid    = idx_arr >= 0
    clipped  = np.clip(idx_arr, 0, len(sell_arr) - 1)
    in_pos   = valid & (ec_ts <= sell_arr[clipped])
    return round(int(in_pos.sum()) / n_ec * 100, 1)


# Trade list (paginated-ready, columnar)
def _pack_trades(sell_trades: list, max_bytes: int = 90_000) -> dict:
    """
    Columnar encoding of all sell trades.
    Cols: [entryDateOffset, exitDateOffset, entryPrice, exitPrice, qty, pnl, reasonCode]
    Offsets are integer seconds relative to t0 (first entry date).
    Falls back to stride-sampling only if the full set exceeds max_bytes.
    """
    REASON_CODES = {"risk": 0, "tsl": 1, "signal": 2, "end": 3}

    if not sell_trades:
        return {"t0": 0, "cols": ["eOff","xOff","ep","xp","a","r"], "rows": [], "sampled": False, "rate": 1}

    t0 = int(pd.Timestamp(sell_trades[0]["entryDate"]).timestamp())

    def _row(t):
        return [
            int(pd.Timestamp(t["entryDate"]).timestamp()) - t0,
            int(pd.Timestamp(t["date"]).timestamp()) - t0,
            t["entryPrice"],
            t["price"],
            t["allocated"],
            REASON_CODES.get(t.get("reason", "signal"), 2),
        ]

    def _encode(stride):
        sel = sell_trades[::stride]
        if sel[-1] is not sell_trades[-1]:
            sel = sel + [sell_trades[-1]]
        return [_row(t) for t in sel]

    def _size(stride):
        rows = _encode(stride)
        return len(json.dumps({"t0": t0, "cols": ["eOff","xOff","ep","xp","a","r"], "rows": rows}, separators=(",", ":")))

    # binary search sur le stride optimal
    if _size(1) <= max_bytes:
        stride = 1
    else:
        lo, hi = 1, len(sell_trades)
        while lo < hi - 1:
            mid = (lo + hi) // 2
            if _size(mid) <= max_bytes:
                hi = mid
            else:
                lo = mid
        stride = hi

    rows = _encode(stride)
    return {
        "t0": t0,
        "cols": ["eOff","xOff","ep","xp","a","r"],
        "rows": rows,
        "sampled": stride > 1,
        "rate": stride,
    }

# Scalar metrics
def _scalar_metrics(
    sell_trades:     list,
    equity_raw:      np.ndarray,
    initial_capital: float,
    final_capital:   float,
    start_date:      str,
    end_date:        str,
    close_arr:       np.ndarray,
    tf_minutes:      int = 1440,
) -> dict:
    total_trades = len(sell_trades)
    wins         = [t for t in sell_trades if t.get("pnl") and t["pnl"] > 0]
    win_rate     = round(len(wins) / total_trades * 100, 1) if total_trades else 0.0

    gross_profit = sum(t["pnl"] for t in sell_trades if t.get("pnl") and t["pnl"] > 0)
    gross_loss   = abs(sum(t["pnl"] for t in sell_trades if t.get("pnl") and t["pnl"] < 0))
    profit_factor = round(gross_profit / gross_loss, 2) if gross_loss else None

    pnl_abs = round(final_capital - initial_capital, 2)
    pnl_pct = round(pnl_abs / initial_capital * 100, 2)
    cumul_pnl = round(sum(t["pnl"] for t in sell_trades if t.get("pnl") is not None), 2)
    bh_pct  = round((float(close_arr[-1]) / float(close_arr[0]) - 1) * 100, 2)

    peak, max_dd = equity_raw[0] if len(equity_raw) else initial_capital, 0.0
    for e in equity_raw:
        if e > peak: peak = e
        dd = (peak - e) / peak * 100
        if dd > max_dd: max_dd = dd
    max_dd = round(max_dd, 2)
    
    sharpe = 0.0
    if len(equity_raw) > 1:
        ret = pd.Series(equity_raw).pct_change().dropna()
        if ret.std() > 0:
            periods_per_year = (365 * 1440) / tf_minutes
            sharpe = round(ret.mean() / ret.std() * math.sqrt(periods_per_year), 2)

    duration_days = (pd.Timestamp(end_date[:10]) - pd.Timestamp(start_date[:10])).days

    return {
        "pnlPercent":     pnl_pct,
        "pnlAbsolute":    pnl_abs,
        "initialCapital": initial_capital,
        "finalCapital":   round(final_capital, 2),
        "totalTrades":    total_trades,
        "cumulativePnl":  cumul_pnl,
        "buyHoldPercent": bh_pct,
        "winRate":        win_rate,
        "maxDrawdown":    max_dd,
        "sharpeRatio":    sharpe,
        "profitFactor":   profit_factor,
        "durationDays":   duration_days,
    }


# Main entry point
def build_result(
    *,
    trades:          list,
    equity_dates:    list,
    equity_raw:      np.ndarray,
    ts_arr,
    close_arr:       np.ndarray,
    initial_capital: float,
    final_capital:   float,
    start_date:      str,
    end_date:        str,
    tf_minutes:      int = 1440,
) -> dict:
    sell_trades = [t for t in trades if t["side"] == "sell"]

    metrics = _scalar_metrics(
        sell_trades, equity_raw, initial_capital, final_capital,
        start_date, end_date, close_arr, tf_minutes,
    )

    result = {
        **metrics,
        "exposurePct":       _exposure_pct(trades, equity_dates),
        "exitReasons":       _exit_reasons(sell_trades),
        "monthlyPerf":       _monthly_perf(sell_trades, ts_arr, close_arr),
        "pnlBuckets":        _pnl_buckets(sell_trades),
        "equityCurve":       _equity_curve_ds(equity_dates, equity_raw),
        "priceCurve":        _price_curve_ds(ts_arr, close_arr),
        # uncomment if needed:
        # "drawdownCurve":     _drawdown_curve_ds(equity_raw),
        # "pnlCurve":          _pnl_curve_ds(equity_dates, sell_trades),
    }

    result_size = sum(len(json.dumps(v, separators=(",", ":"), default=str)) for v in result.values())
    log.debug(f"Results size (no trades) (B): {result_size}")

    result["trades"] = _pack_trades(sell_trades, max_bytes=90_000-result_size)

    trades_size = len(json.dumps(result["trades"], separators=(",", ":"), default=str))
    log.debug(f"Results trades size (B): {trades_size}/{90_000-result_size}")

    return result