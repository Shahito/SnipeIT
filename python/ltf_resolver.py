"""
ltf_resolver.py - Resolves the true order of SL/TP/TSL triggers inside a
single base candle, using lower-timeframe (LTF) OHLC data.

Why this exists: a base candle only tells us its low and high, never the
order in which price actually moved. Two situations make that ambiguous:
  - SL and TP both sit inside [low, high] - which one was hit first?
  - TSL: the candle makes a new high (raising the trailing stop) AND its
    low breaches the raised stop - did the pullback happen before or
    after the new high?
Walking the same time window at a finer timeframe (1m, falling back to
5m then 15m when finer data isn't available) resolves this by replaying
price action in its real chronological order instead of guessing.

Two - and only two - assumptions are needed when even the finest data we
have still can't fully disambiguate something. Both favor the WORSE
outcome for the trade, and both are applied nowhere else in this module:
  1. Within one sub-candle, if it still shows both a stop-out and a
     target hit at once, the stop-out is assumed first.
  2. Within one sub-candle, a new high is assumed to raise the trailing
     stop before that same sub-candle's low is checked against it -
     i.e. a pullback is never given the benefit of an as-yet-unraised
     stop. This only matters at the single finest sub-candle where the
     ambiguity was found; every earlier sub-candle's order is exact.
A sub-candle that opens past its trigger level fills at the open, not the
level - the level was already gapped through, so the open is the real
first tradeable price.

If no finer timeframe has any data for the window, resolve() reports
"none" and the caller falls back to its own base-candle logic for that
one candle - this module never fetches more than the specific calendar
day(s) an ambiguous candle actually touches, and only when asked.
"""

import pandas as pd

from ohlcv_cache import get_ohlcv

# Ordered finest to coarsest; only entries strictly finer than the base
# timeframe are ever used (see LtfResolver.__init__).
_FALLBACK_TIMEFRAMES = [("1m", 1), ("5m", 5), ("15m", 15)]


class LtfResolver:
    """Resolves SL/TP/TSL for one base candle at a time via resolve().
    Built once per run_backtest() call and reused across the whole
    simulation loop; fetches+caches whatever LTF day(s) a candle touches,
    lazily, only for candles the caller has flagged as ambiguous."""

    def __init__(self, pair: str, exchange: str, base_minutes: int):
        self._pair = pair
        self._exchange = exchange
        self._base_minutes = base_minutes
        self._timeframes = [tf for tf, minutes in _FALLBACK_TIMEFRAMES if minutes < base_minutes]
        self._days = {}  # (timeframe, "YYYY-MM-DD") -> DataFrame, or None if confirmed empty

    def _day(self, timeframe: str, day: pd.Timestamp):
        key = (timeframe, day.strftime("%Y-%m-%d"))
        if key not in self._days:
            next_day = (day + pd.Timedelta(days=1)).strftime("%Y-%m-%d")
            fetched = get_ohlcv(self._pair, timeframe, key[1], next_day, self._exchange)
            self._days[key] = fetched if not fetched.empty else None
        return self._days[key]

    def _window(self, timeframe: str, start: pd.Timestamp, end: pd.Timestamp):
        """Every sub-candle of `timeframe` inside [start, end), gathered
        across as many calendar days as the window spans, in time order.
        None if not a single day in the window has data at this resolution."""
        frames = []
        day = start.normalize()
        while day < end:
            frame = self._day(timeframe, day)
            if frame is not None:
                frames.append(frame)
            day += pd.Timedelta(days=1)
        if not frames:
            return None
        window = pd.concat(frames, ignore_index=True).sort_values("timestamp")
        window = window[(window["timestamp"] >= start) & (window["timestamp"] < end)]
        return window if not window.empty else None

    def resolve(self, candle_open, sl_price, tp_price, trailing_stop_loss_pct, trailing_high) -> dict:
        """
        Replays one base candle at the finest available timeframe and
        returns the first of TSL/SL/TP that actually triggers, in the
        real chronological order found in the data.

        Returns:
          exit_price, reason  - None, None if nothing triggered this candle.
                                 reason is "tsl" or "risk" (SL and TP share
                                 "risk" - same convention as the base-candle
                                 fallback and as compute_results.REASON_CODES).
          trailing_high        - updated trailing high (unchanged if no TSL).
          resolved_at           - the timeframe actually used ("1m"/"5m"/"15m"),
                                 or "none" if no finer data existed for this
                                 window at all - the caller must then fall
                                 back to its own base-candle logic.
          seen_high, seen_low   - the highest/lowest price actually observed
                                 up to and including the trigger (or across
                                 the whole window if nothing triggered) -
                                 narrower than the base candle's own
                                 high/low whenever the trigger happened
                                 before the window's end. None/None if
                                 resolved_at is "none".
        """
        start = pd.Timestamp(candle_open)
        end = start + pd.Timedelta(minutes=self._base_minutes)

        for timeframe in self._timeframes:
            window = self._window(timeframe, start, end)
            if window is None:
                continue  # no data at this resolution for this window - try coarser

            th = trailing_high
            seen_high, seen_low = float("-inf"), float("inf")
            for _, bar in window.iterrows():
                o, h, l = float(bar["open"]), float(bar["high"]), float(bar["low"])
                seen_high = max(seen_high, h)
                seen_low = min(seen_low, l)

                if trailing_stop_loss_pct is not None and h > th:
                    th = h  # see module docstring, assumption 2
                tsl_price = th * (1 - trailing_stop_loss_pct / 100) if trailing_stop_loss_pct is not None else None

                tsl_hit = tsl_price is not None and l <= tsl_price
                sl_hit = sl_price is not None and l <= sl_price
                tp_hit = tp_price is not None and h >= tp_price

                if tsl_hit or sl_hit or tp_hit:
                    if tsl_hit:
                        price = o if o <= tsl_price else tsl_price
                        return self._outcome(price, "tsl", th, timeframe, seen_high, seen_low)
                    if sl_hit:  # see module docstring, assumption 1
                        price = o if o <= sl_price else sl_price
                        return self._outcome(price, "risk", th, timeframe, seen_high, seen_low)
                    price = o if o >= tp_price else tp_price
                    return self._outcome(price, "risk", th, timeframe, seen_high, seen_low)

            return self._outcome(None, None, th, timeframe, seen_high, seen_low)  # full coverage, nothing hit

        return self._outcome(None, None, trailing_high, "none", None, None)

    @staticmethod
    def _outcome(exit_price, reason, trailing_high, resolved_at, seen_high, seen_low) -> dict:
        return {
            "exit_price": exit_price,
            "reason": reason,
            "trailing_high": trailing_high,
            "resolved_at": resolved_at,
            "seen_high": seen_high,
            "seen_low": seen_low,
        }