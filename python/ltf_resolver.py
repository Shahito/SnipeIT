"""
ltf_resolver.py - Resolves the true order of SL/TP/TSL triggers inside a
single base candle, using lower-timeframe (LTF) OHLC data.

Why this exists: a base candle only tells us its low and high, never the
order in which price actually moved. That makes some situations genuinely
ambiguous (see backtest.py's _detect_ambiguous_candle for the exact list -
TSL pullback after a new high, SL+TP both in range, SL+TSL both in range).
Walking the same time window at a finer timeframe (1m, falling back to 5m
then 15m when finer data isn't available) resolves this by replaying price
action in its real chronological order instead of guessing.

Two rules handle whatever even the finest data we have still can't show
directly - both are applied nowhere else in this module and both favor
the reading that is fully supported by what we DID observe:
  1. Within one sub-candle, if BOTH a TSL/SL-type stop-out and a TP-type
     target are hit at once, the stop-out is assumed first (worse outcome).
  2. Within one sub-candle, if BOTH the trailing stop and the fixed stop
     are hit at once, whichever level is numerically HIGHER is assumed
     first - the only fact a falling price guarantees: it crosses the
     higher of two sell-side levels before the lower one, however fast it
     moves within that one sub-candle.
A level that was already in effect BEFORE a sub-candle opened (a fixed SL,
or a TSL whose raise happened in an earlier sub-candle) and that the
sub-candle's OPEN has already gapped past fills at that open price - the
level was skipped over, so the open is the real first tradeable price.
A level that a sub-candle's OWN high raises for the first time this same
sub-candle cannot have been gapped through at that same sub-candle's open
(the level didn't exist yet at that instant) - it fills exactly at the
newly-raised level instead. TP never fills better than its own level: a
resting limit order does not benefit from a favorable gap the way a
stop-turned-market order suffers from an unfavorable one.

If no finer timeframe has enough data to fully cover the window, resolve()
reports "none" and the caller falls back to its own base-candle logic for
that one candle - this module never fetches more than the specific
calendar day(s) an ambiguous candle actually touches, and only when asked.
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
        self._timeframes = [(tf, minutes) for tf, minutes in _FALLBACK_TIMEFRAMES if minutes < base_minutes]
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
        Replays one base candle at the finest available FULLY-COVERING
        timeframe and returns the first of TSL/SL/TP that actually
        triggers, in the real chronological order found in the data.

        Returns:
          exit_price, reason  - None, None if nothing triggered this candle.
                                 reason is "tsl" or "risk" (SL and TP share
                                 "risk" - same convention as the base-candle
                                 fallback and as compute_results.REASON_CODES).
          trailing_high        - updated trailing high (unchanged if no TSL).
          resolved_at           - the timeframe actually used ("1m"/"5m"/"15m"),
                                 or "none" if no finer timeframe had enough
                                 data to fully cover this window - the caller
                                 must then fall back to its own base-candle
                                 logic. A PARTIAL window (data gap) is treated
                                 the same as no data: it is never trusted to
                                 report "nothing happened" when the missing
                                 minutes are exactly where it could have.
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

        for timeframe, tf_minutes in self._timeframes:
            window = self._window(timeframe, start, end)
            expected_bars = self._base_minutes // tf_minutes
            if window is None or len(window) < expected_bars:
                continue  # no data, or a gap leaves this window incomplete - try coarser

            th = trailing_high
            seen_high, seen_low = float("-inf"), float("inf")
            for _, bar in window.iterrows():
                o, h, l = float(bar["open"]), float(bar["high"]), float(bar["low"])
                seen_high = max(seen_high, h)
                seen_low = min(seen_low, l)

                # Levels already in effect BEFORE this sub-candle opened:
                # a real gap-through fills at the open.
                old_tsl_price = th * (1 - trailing_stop_loss_pct / 100) if trailing_stop_loss_pct is not None else None
                gapped = []
                if old_tsl_price is not None and o <= old_tsl_price:
                    gapped.append(("tsl", old_tsl_price))
                if sl_price is not None and o <= sl_price:
                    gapped.append(("risk", sl_price))
                if gapped:
                    reason, _ = max(gapped, key=lambda g: g[1])  # higher level = struck first on the way down
                    return self._outcome(o, reason, th, timeframe, seen_high, seen_low)

                # No pre-existing gap: this sub-candle's own high may raise
                # the trailing stop for the first time - it cannot have been
                # gapped through at an open that predates it.
                if trailing_stop_loss_pct is not None and h > th:
                    th = h
                tsl_price = th * (1 - trailing_stop_loss_pct / 100) if trailing_stop_loss_pct is not None else None

                tsl_hit = tsl_price is not None and l <= tsl_price
                sl_hit = sl_price is not None and l <= sl_price
                tp_hit = tp_price is not None and h >= tp_price

                stop_outs = []
                if tsl_hit:
                    stop_outs.append(("tsl", tsl_price))
                if sl_hit:
                    stop_outs.append(("risk", sl_price))
                if stop_outs:
                    reason, level = max(stop_outs, key=lambda s: s[1])  # see module docstring, rule 2
                    return self._outcome(level, reason, th, timeframe, seen_high, seen_low)
                if tp_hit:
                    return self._outcome(tp_price, "risk", th, timeframe, seen_high, seen_low)  # never better than the level

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