"""
ltf_resolver.py - Intra-candle TP/SL/TSL resolution using lower-timeframe data.

TP/SL/TSL are exchange-side orders, independent of the strategy's own
candle timeframe. Above 1m, resolving them from the base candle's
high/low alone can misorder simultaneous SL/TP hits and, for a trailing
stop, can let the trailing high advance past a pullback that would
already have triggered it. This module walks the real sub-timeframe
price path (1m, falling back to 5m/15m when 1m is unavailable) to
resolve the exact trigger and fill price.

Fetching is lazy and per-day: resolve() is only ever called by the
caller for candles it has already flagged as ambiguous, so only the
calendar day(s) touching those specific candles get fetched - never the
full backtest range up front. Each day is fetched once (via ohlcv_cache,
so it's also disk-cached across runs) and kept in memory for the rest
of this resolver's lifetime in case another candle the same day needs it.
"""

import logging

import numpy as np
import pandas as pd

from ohlcv_cache import get_ohlcv

log = logging.getLogger("snipeit.ltf")

_FALLBACK_CHAIN = [("1m", 1), ("5m", 5), ("15m", 15)]


class LtfResolver:
    """
    Resolves TP/SL/TSL for one base candle at a time via resolve(),
    lazily fetching+caching whatever LTF day(s) that candle touches.
    Built once per run_backtest() call, reused across the whole loop.
    """

    def __init__(self, pair: str, exchange: str, base_minutes: int):
        self.pair = pair
        self.exchange = exchange
        self.base_minutes = base_minutes
        self._chain = [tf for tf, m in _FALLBACK_CHAIN if m < base_minutes]
        self._day_cache = {}  # (tf, "YYYY-MM-DD") -> (ts_arr, open, high, low)
        self._empty_days = set()  # (tf, "YYYY-MM-DD") confirmed to have no data

    def _day_frame(self, tf: str, day: pd.Timestamp):
        day_str = day.strftime("%Y-%m-%d")
        key = (tf, day_str)
        if key in self._day_cache:
            return self._day_cache[key]
        if key in self._empty_days:
            return None

        # end_date = next day so the fetch covers the full day's candles
        # (ohlcv_cache's day-granularity range is inclusive on both ends).
        next_day = (day + pd.Timedelta(days=1)).strftime("%Y-%m-%d")
        df = get_ohlcv(self.pair, tf, day_str, next_day, self.exchange)
        if df.empty:
            self._empty_days.add(key)
            return None

        frame = (
            pd.DatetimeIndex(df["timestamp"]).astype("datetime64[ns]").to_numpy(),
            df["open"].to_numpy(dtype=float),
            df["high"].to_numpy(dtype=float),
            df["low"].to_numpy(dtype=float),
        )
        self._day_cache[key] = frame
        return frame

    def _slice(self, tf: str, start: np.datetime64, end: np.datetime64):
        """Gathers every day spanned by [start, end) for this tf, lazily
        fetching+caching each one, then slices to the exact window."""
        first_day = pd.Timestamp(start).normalize()
        last_day = pd.Timestamp(end - np.timedelta64(1, "s")).normalize()

        ts_chunks, o_chunks, h_chunks, l_chunks = [], [], [], []
        day = first_day
        while day <= last_day:
            frame = self._day_frame(tf, day)
            if frame is not None:
                ts_chunks.append(frame[0])
                o_chunks.append(frame[1])
                h_chunks.append(frame[2])
                l_chunks.append(frame[3])
            day += pd.Timedelta(days=1)

        if not ts_chunks:
            return None

        ts_arr = np.concatenate(ts_chunks)
        order = np.argsort(ts_arr)
        ts_arr = ts_arr[order]
        o = np.concatenate(o_chunks)[order]
        h = np.concatenate(h_chunks)[order]
        l = np.concatenate(l_chunks)[order]

        start_i = ts_arr.searchsorted(start, side="left")
        end_i = ts_arr.searchsorted(end, side="left")
        return o[start_i:end_i], h[start_i:end_i], l[start_i:end_i]

    def resolve(self, candle_start, sl_price, tp_price, tsl_pct, trailing_high):
        """
        Walks the finest available LTF inside [candle_start, candle_start +
        base_minutes) in chronological order, updating the trailing high as
        it goes, and returns the first of TSL/SL/TP that triggers.

        Returns (exit_price, reason, new_trailing_high, resolution, mfe_high, mae_low):
          - exit_price/reason are None if nothing triggered this candle
          - resolution is the LTF timeframe actually used ("1m"/"5m"/"15m"),
            or "base" if this window falls in a gap on every LTF in the
            fallback chain - the caller then falls back to its own
            base-timeframe high/low logic for this candle only (mfe_high/
            mae_low are also None in that case)
          - mfe_high/mae_low are the highest high / lowest low actually
            reached up to and including the trigger point (or across the
            whole window if nothing triggered) - NOT the full base candle,
            which could include price action after the real exit moment
        """
        start = pd.Timestamp(candle_start).to_datetime64().astype("datetime64[ns]")
        end = (start + pd.Timedelta(minutes=self.base_minutes)).to_datetime64().astype(
            "datetime64[ns]"
        )

        for tf in self._chain:
            sliced = self._slice(tf, start, end)
            if sliced is None or len(sliced[0]) == 0:
                continue  # gap in this tf for this window - try coarser
            o, h, l = sliced

            th = trailing_high
            mfe_high = float("-inf")
            mae_low = float("inf")
            for i in range(len(o)):
                oi, hi, li = float(o[i]), float(h[i]), float(l[i])
                mfe_high = max(mfe_high, hi)
                mae_low = min(mae_low, li)

                if tsl_pct is not None and hi > th:
                    th = hi
                tsl_price = th * (1 - tsl_pct / 100) if tsl_pct is not None else None

                tsl_hit = tsl_price is not None and li <= tsl_price
                sl_hit = sl_price is not None and li <= sl_price
                tp_hit = tp_price is not None and hi >= tp_price

                if tsl_hit or sl_hit or tp_hit:
                    # Gap slippage: if the sub-candle opened past the
                    # trigger, the real fill is the open, not the level.
                    if tsl_hit:
                        exit_price = oi if oi <= tsl_price else tsl_price
                        return exit_price, "tsl", th, tf, mfe_high, mae_low
                    if sl_hit:
                        exit_price = oi if oi <= sl_price else sl_price
                        return exit_price, "risk", th, tf, mfe_high, mae_low
                    exit_price = oi if oi >= tp_price else tp_price
                    return exit_price, "risk", th, tf, mfe_high, mae_low

            return None, None, th, tf, mfe_high, mae_low  # full coverage, nothing hit

        return None, None, trailing_high, "base", None, None