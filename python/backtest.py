"""
backtest.py - Single-position strategy simulation engine.

Pipeline (read top to bottom - this order IS the no-look-ahead guarantee):
  1. Parse the strategy config into plain, explicit variables.
  2. Work out which indicators are needed and fetch OHLCV with enough
     warm-up history for them to have converged (indicators.py).
  3. Evaluate entry/exit rules for the WHOLE timeline at once, vectorized -
     one boolean per candle, computed by a single code path. There is no
     separate "fast path" / "slow path" pair that could silently disagree
     with each other on some conditions and not others.
  4. Walk the candles once, single position at a time. Two independent
     no-look-ahead rules apply, for two different kinds of decision:
       a) Rule-based signals (entry_conds/exit_conds): a signal detected
          at the CLOSE of candle N is executed at the OPEN of candle N+1
          (pending_entry/pending_exit below). This is what makes
          look-ahead structurally impossible for signals, rather than a
          convention someone has to remember.
       b) Risk levels (SL/TP/TSL): these are resting orders re-evaluated
          every candle against that same candle's low/high, so they are
          NOT delayed like signals are - but the indicator value used to
          PLACE the level (ATR) must be the one known as of the previous
          candle's close, never the current candle's own ATR (which needs
          that candle's own high/low, not yet known when the order would
          need to already be resting in the market).
  5. Hand the trade log + equity curve to compute_results.build_result()
     for aggregation/serialization. Output shape is unchanged.

Multi-position note: steps 2-3 already operate on the whole timeline and
don't assume a single position anywhere. Step 4 is where "one position at
a time" actually lives (`position: dict | None`). Extending this to
concurrent positions later means turning that into `positions: list[dict]`
and tagging trades with a position id - nothing above it needs to change.
"""

import logging

import numpy as np
import pandas as pd

from indicators import compute_all, resolve_value, column_name, extract_needed
from compute_results import build_result

log = logging.getLogger("snipeit.backtest")

_TF_MINUTES = {
    "1m": 1,
    "3m": 3,
    "5m": 5,
    "15m": 15,
    "30m": 30,
    "1h": 60,
    "2h": 120,
    "4h": 240,
    "6h": 360,
    "8h": 480,
    "12h": 720,
    "1d": 1440,
    "3d": 4320,
    "1w": 10080,
}


def _timeframe_to_minutes(tf: str) -> int:
    return _TF_MINUTES.get(tf, 60)  # default to 1h if unknown


def _inclusive_end(end_date: str) -> str:
    """get_ohlcv() treats its `end` argument as midnight of that day, i.e.
    exclusive of the day itself - a strategy's own endDate is meant to be
    the last day INCLUDED, so callers here always fetch one calendar day
    past it."""
    return (pd.Timestamp(end_date[:10]) + pd.Timedelta(days=1)).strftime("%Y-%m-%d")


def _nan_to_none(x):
    return None if (x is None or np.isnan(x)) else float(x)


# ---------------------------------------------------------------------------
# Rule evaluation - vectorized over the whole DataFrame, single code path.
# ---------------------------------------------------------------------------

OPERATORS = {
    ">": lambda a, b, pa, pb: a > b,
    "<": lambda a, b, pa, pb: a < b,
    ">=": lambda a, b, pa, pb: a >= b,
    "<=": lambda a, b, pa, pb: a <= b,
    "==": lambda a, b, pa, pb: (a - b).abs() < 1e-9,
    # pa/pb are the same refs one candle earlier - NaN comparisons are
    # always False in pandas, so a missing previous value naturally means
    # "no cross detected" without any extra check.
    "cross_above": lambda a, b, pa, pb: (pa <= pb) & (a > b),
    "cross_below": lambda a, b, pa, pb: (pa >= pb) & (a < b),
}

_COMBINE_OPS = {
    "+": lambda a, b: a + b,
    "-": lambda a, b: a - b,
    "*": lambda a, b: a * b,
    "/": lambda a, b: (a / b).where(b != 0),  # division by 0 -> NaN, not inf
}


def _prefixed_keys(prefix: str) -> dict:
    """Maps a sub-reference's logical role to its key in a condition dict.
    prefix="" -> the rule's LHS ref (indicator/period/...).
    prefix="value" -> the RHS ref, when the rule compares against another
    indicator instead of a constant (valueIndicator/valueIndicatorPeriod/...).
    A combine* sub-ref (e.g. CLOSE - OPEN) always shares its parent's
    timeframe, but has its own settings (combineSettings/valueCombineSettings)."""
    p = prefix
    return {
        "indicator": f"{p}Indicator" if p else "indicator",
        "period": f"{p}IndicatorPeriod" if p else "period",
        "source": f"{p}IndicatorSource" if p else "source",
        "offset": f"{p}IndicatorOffset" if p else "offset",
        "timeframe": f"{p}IndicatorTimeframe" if p else "timeframe",
        "settings": f"{p}IndicatorSettings" if p else "settings",
        "combine_op": f"{p}CombineOp" if p else "combineOp",
        "combine_indicator": f"{p}CombineIndicator" if p else "combineIndicator",
        "combine_period": f"{p}CombinePeriod" if p else "combinePeriod",
        "combine_source": f"{p}CombineSource" if p else "combineSource",
        "combine_offset": f"{p}CombineOffset" if p else "combineOffset",
        "combine_settings": f"{p}CombineSettings" if p else "combineSettings",
    }


def _ref_series(
    df: pd.DataFrame,
    indicator: str,
    period,
    source,
    offset: int,
    timeframe,
    settings,
    base_timeframe: str,
) -> pd.Series:
    """One indicator column as a full series, shifted back by `offset`
    candles (0 = current candle, 1 = previous, ...). An unknown indicator,
    a missing HTF-aligned column, or not-enough-history-yet all resolve to
    NaN - which every operator above already treats as 'not satisfied',
    so there's a single place where "no value" is decided.

    A ref's `timeframe` equal to the strategy's own `base_timeframe` means
    exactly the same thing as no timeframe at all - normalized HERE, in
    the one place that decides which column to read, rather than in a
    separate pre-pass whose result this function would otherwise have to
    trust blindly (two representations of the same fact that could drift
    apart is exactly the kind of risk this rewrite exists to remove).

    Note: this is used for RULE conditions only (entry_conds/exit_conds),
    which already get a full candle of execution delay (see module
    docstring, 4a) - reading a rule's own candle's indicator value here is
    correct, not a look-ahead, precisely because of that delay. Risk
    levels (SL/TP/TSL, see run_backtest) are a different case and are
    handled separately with an explicit one-candle ATR lag."""
    col = column_name(indicator, period, source, settings)
    if col is None:
        return pd.Series(np.nan, index=df.index)
    if timeframe and timeframe != base_timeframe:
        col = f"{col}@{timeframe}"
    if col not in df.columns:
        return pd.Series(np.nan, index=df.index)
    series = df[col]
    return series.shift(offset) if offset else series


def _expr_series(df: pd.DataFrame, cond: dict, base_timeframe: str, prefix: str = ""):
    """One side of a rule: a single indicator ref, optionally combined with
    a second ref via +,-,*,/ (e.g. CLOSE - OPEN = candle body).
    Returns (current, previous) series, both float/NaN."""
    k = _prefixed_keys(prefix)
    offset = cond.get(k["offset"]) or 0
    timeframe = cond.get(k["timeframe"])
    settings = cond.get(k["settings"])

    val = _ref_series(
        df,
        cond[k["indicator"]],
        cond.get(k["period"]),
        cond.get(k["source"]),
        offset,
        timeframe,
        settings,
        base_timeframe,
    )
    prev = _ref_series(
        df,
        cond[k["indicator"]],
        cond.get(k["period"]),
        cond.get(k["source"]),
        offset + 1,
        timeframe,
        settings,
        base_timeframe,
    )

    combine_op = cond.get(k["combine_op"])
    if combine_op:
        fn = _COMBINE_OPS.get(combine_op)
        if fn is None:
            nan = pd.Series(np.nan, index=df.index)
            return nan, nan
        c_offset = cond.get(k["combine_offset"]) or 0
        c_settings = cond.get(k["combine_settings"])
        c_val = _ref_series(
            df,
            cond[k["combine_indicator"]],
            cond.get(k["combine_period"]),
            cond.get(k["combine_source"]),
            c_offset,
            timeframe,
            c_settings,
            base_timeframe,
        )
        c_prev = _ref_series(
            df,
            cond[k["combine_indicator"]],
            cond.get(k["combine_period"]),
            cond.get(k["combine_source"]),
            c_offset + 1,
            timeframe,
            c_settings,
            base_timeframe,
        )
        val = fn(val, c_val)
        prev = fn(prev, c_prev)

    return val, prev


def _eval_rule_series(df: pd.DataFrame, cond: dict, base_timeframe: str) -> pd.Series:
    """Boolean series for one rule, evaluated on every candle at once.
    If cond['lookback'] (int > 1) is set, the rule is re-required to hold
    on each of the last N candles and aggregated:
      - lookbackMode "all" (default): every candle in the window satisfies it
      - lookbackMode "any": at least one candle in the window satisfies it
    A window that isn't fully inside the data yet (start of the backtest)
    resolves to False, same as a plain missing indicator value."""
    fn = OPERATORS.get(cond["operator"])
    if fn is None:
        return pd.Series(False, index=df.index)

    val, prev = _expr_series(df, cond, base_timeframe, prefix="")

    if cond.get("valueIndicator"):
        threshold, prev_threshold = _expr_series(
            df, cond, base_timeframe, prefix="value"
        )
        multiplier = float(cond.get("valueMultiplier") or 1.0)
        threshold = threshold * multiplier
        prev_threshold = prev_threshold * multiplier
    else:
        threshold = pd.Series(float(cond["value"]), index=df.index)
        prev_threshold = threshold

    result = fn(val, threshold, prev, prev_threshold).fillna(False)

    lookback = cond.get("lookback") or 1
    if lookback > 1:
        mode = cond.get("lookbackMode", "all")
        rolled = result.astype(int).rolling(lookback)
        agg = rolled.max() if mode == "any" else rolled.min()
        result = agg == 1  # NaN (window not full yet) -> False

    return result


def _eval_conditions_series(
    df: pd.DataFrame, conditions: list, base_timeframe: str
) -> pd.Series:
    """Boolean series for a full entry/exit rule set, over every candle:
    - flat format    [rule, rule, ...]            -> AND of all rules
    - grouped format [[rule, rule], [rule], ...]   -> OR of ANDed groups
    """
    if not conditions:
        return pd.Series(False, index=df.index)

    groups = conditions if isinstance(conditions[0], list) else [conditions]
    combined = pd.Series(False, index=df.index)
    for group in groups:
        if not group:
            continue
        group_result = pd.Series(True, index=df.index)
        for rule in group:
            group_result &= _eval_rule_series(df, rule, base_timeframe)
        combined |= group_result
    return combined


def _resolve_open_position(
    idx,
    ts_arr,
    low_arr,
    high_arr,
    fill_price,
    position,
    sl_type,
    tp_type,
    stop_loss_val,
    take_profit_val,
    trailing_stop_loss_val,
    ltf_resolver,
    date,
    prev_highest_high,
    prev_lowest_low,
):
    """
    For a position that's open going into candle idx: figures out whether
    SL/TP/TSL closes it THIS candle. Returns (exit_price, reason,
    resolution) - exit_price is None if nothing closed it.

    Deliberately not pure: `position`'s trailing_high/highest_high/
    lowest_low are updated in place as part of resolving this, the same
    way the LTF-resolved or base-candle path always has - a position's
    own price-tracking state IS part of what gets resolved here.
    """
    low, high = float(low_arr[idx]), float(high_arr[idx])
    # The SL/TP band is fixed once, at entry (position["entry_atr"]), never
    # recomputed from a later candle's ATR - a resting stop order doesn't
    # move on its own just because volatility changed since.
    sl_price, tp_price = _stop_target_prices(
        position,
        sl_type,
        tp_type,
        stop_loss_val,
        take_profit_val,
        position["entry_atr"],
    )

    ambiguous, trigger = _detect_ambiguous_candle(
        low,
        high,
        sl_price,
        tp_price,
        trailing_stop_loss_val,
        position["trailing_high"],
    )

    exit_price, reason, resolution = None, None, "base"
    if ambiguous and ltf_resolver is not None:
        log.debug(f"LTF lookup {date} - ambiguous candle ({trigger})")
        outcome = ltf_resolver.resolve(
            ts_arr[idx],
            sl_price,
            tp_price,
            trailing_stop_loss_val,
            position["trailing_high"],
        )
        exit_price = outcome["exit_price"]
        reason = outcome["reason"]
        position["trailing_high"] = outcome["trailing_high"]
        resolution = (
            outcome["resolved_at"] if outcome["resolved_at"] != "none" else "base"
        )

        if resolution != "base":
            # The caller's own top-of-candle update used the FULL base
            # candle's high/low, which can include price action after the
            # real intra-candle trigger point. Replace it with the true
            # bound: prior state (or entry price, if the trade entered and
            # exited this same candle) capped by what the LTF walk
            # actually saw up to the trigger.
            entry_price = position["entry_price"]
            prev_hh = (
                prev_highest_high if prev_highest_high is not None else entry_price
            )
            prev_ll = prev_lowest_low if prev_lowest_low is not None else entry_price
            position["highest_high"] = max(prev_hh, outcome["seen_high"])
            position["lowest_low"] = min(prev_ll, outcome["seen_low"])

    if resolution == "base":
        # Either not ambiguous, or ambiguous with no (fully-covering) LTF
        # data available for this window - resolved from the base candle alone.
        effective_high = (
            max(high, position["trailing_high"])
            if trailing_stop_loss_val is not None
            else None
        )
        if effective_high is not None:
            position["trailing_high"] = effective_high
        tsl_price = (
            position["trailing_high"] * (1 - trailing_stop_loss_val / 100)
            if trailing_stop_loss_val is not None
            else None
        )

        stop_outs = []
        if tsl_price is not None and low <= tsl_price:
            stop_outs.append(("tsl", tsl_price))
        if sl_price is not None and low <= sl_price:
            stop_outs.append(("risk", sl_price))
        if stop_outs:
            # Higher level is crossed first as price falls - the one fact
            # a single base candle gives us for free when both a stop-out
            # level and a target sit in its range.
            reason, level = max(stop_outs, key=lambda s: s[1])
            exit_price = min(
                fill_price, level
            )  # gapped through -> fills at the open, never better
        elif tp_price is not None and high >= tp_price:
            exit_price, reason = (
                tp_price,
                "risk",
            )  # a resting limit never fills better than its own level

    return exit_price, reason, resolution


def _uses_cross_operator(conditions: list) -> bool:
    if not conditions:
        return False
    groups = conditions if isinstance(conditions[0], list) else [conditions]
    return any(
        rule.get("operator") in ("cross_above", "cross_below")
        for group in groups
        for rule in group
    )


def _validate_conditions(conditions: list, side: str) -> None:
    """Rejects malformed rules up front instead of letting them fail
    silently or confusingly later:
      - a negative offset would read a FUTURE candle (`series.shift(-n)`) -
        the one input this engine must never accept, since every no-look-
        ahead guarantee elsewhere assumes offset >= 0.
      - lookback must be a sane positive integer (an unbounded or non-
        integer value can make pandas' rolling window fail with an opaque
        error far from here).
      - cross_above/cross_below is true on exactly the one candle where
        the crossing happens - by construction it cannot also be true on
        the candle right before or after (that would require ALSO having
        crossed back in between). lookbackMode "all" over more than one
        candle can therefore never be satisfied - it isn't a rare edge
        case, it's a rule that can never fire, and would otherwise fail
        silently as "0 trades" instead of telling the person why.
    """
    if not conditions:
        return
    groups = conditions if isinstance(conditions[0], list) else [conditions]
    for group in groups:
        for rule in group:
            for prefix in ("", "value"):
                k = _prefixed_keys(prefix)
                for offset_key in (k["offset"], k["combine_offset"]):
                    offset = rule.get(offset_key)
                    if offset is not None and (
                        not isinstance(offset, int) or not (0 <= offset <= 5000)
                    ):
                        raise ValueError(
                            f"{side} condition: {offset_key}={offset!r} is invalid "
                            f"(must be an integer >= 0 - a negative offset would read a future candle)"
                        )
            lookback = rule.get("lookback")
            if lookback is not None and (
                not isinstance(lookback, int) or not (1 <= lookback <= 5000)
            ):
                raise ValueError(
                    f"{side} condition: lookback={lookback!r} is invalid (must be an integer >= 1)"
                )
            if (
                rule.get("operator") in ("cross_above", "cross_below")
                and lookback
                and lookback > 1
                and rule.get("lookbackMode", "all") == "all"
            ):
                raise ValueError(
                    f"{side} condition: operator={rule['operator']!r} with lookback={lookback} "
                    f"and lookbackMode='all' can never be true - a cross cannot repeat on "
                    f"consecutive candles. Use lookbackMode='any', or lookback=1."
                )


# ---------------------------------------------------------------------------
# Warm-up sizing & higher-timeframe (HTF) indicators.
# ---------------------------------------------------------------------------

# RSI/ATR (and STOCH_RSI, built on RSI) use Wilder smoothing (EWM alpha=1/n),
# which converges much slower than a standard EMA (alpha=2/(n+1)): after k
# candles, (1 - alpha)^k of the seed value still lingers. A factor of 8
# leaves e^-8 (~0.03%) of it - a factor of 2 (the old value) leaves e^-2
# (~14%), which shows up as a real, measurable error on the first
# simulated candles, worse on higher timeframes.
_WILDER_INDICATORS = {"RSI", "ATR", "STOCH_RSI_K", "STOCH_RSI_D"}
_WILDER_FACTOR = 8
_EMA_FACTOR = 4  # standard EMA/MACD: same margin, faster convergence


def _warmup_candles(needed_indicators: list) -> int:
    """Number of extra candles to fetch before the requested start date so
    every needed indicator has fully converged by the time the real
    simulation begins. Shared by the base-timeframe warm-up calc in
    run_backtest() and by _compute_htf_columns() (each HTF group needs its
    own warm-up, in that group's own candle size)."""
    from indicators import REGISTRY

    max_warmup = 1
    for indicator, period, _source, _tf, settings in needed_indicators:
        meta = REGISTRY.get(indicator)
        if not meta:
            continue

        if indicator in ("MACD", "MACD_SIGNAL", "MACD_HIST"):
            extra = {
                **meta.get("extra_params", {}),
                **(dict(settings) if settings else {}),
            }
            # The signal line is itself an EMA of the MACD line, which
            # needs `slow` candles to converge - the two convergence
            # times stack, they don't overlap.
            warmup = _EMA_FACTOR * (extra.get("slow", 26) + extra.get("signal", 9))
        elif indicator in ("STOCH_RSI_K", "STOCH_RSI_D"):
            p = period or meta["params"].get("period", 14)
            warmup = (
                _WILDER_FACTOR * p + 3 + 3
            )  # + smooth_k + smooth_d (fixed in indicators.py)
        elif indicator in _WILDER_INDICATORS:
            p = period or meta["params"].get("period", 14)
            warmup = _WILDER_FACTOR * p
        elif indicator == "EMA":
            p = period or meta["params"].get("period", 20)
            warmup = _EMA_FACTOR * p
        else:
            # SMA, Bollinger, VWAP, CLOSE/VOLUME/HIGH/LOW/OPEN: a plain
            # rolling window (or no window at all) is exact right after
            # `period` candles, no asymptotic tail to wait out.
            p = period or meta["params"].get("period", 1) or 1
            warmup = 2 * p

        max_warmup = max(max_warmup, warmup)
    return max_warmup + 1


def _group_needed_by_timeframe(needed_htf: list) -> dict:
    groups: dict = {}
    for item in needed_htf:
        groups.setdefault(item[3], []).append(item)
    return groups


def _merge_htf_column(
    base_ts_arr, htf_timestamps, htf_values, htf_tf_minutes: int
) -> np.ndarray:
    """
    Aligns an HTF-computed column onto the base timeframe's index, without
    look-ahead: for each base candle (open time T), the value used is the
    one from the last HTF candle that had FULLY CLOSED at or before T
    (close_time <= T). A base candle earlier than every closed HTF candle
    gets NaN (resolve_value() then reports it as "no value yet").
    """
    right = pd.DataFrame(
        {
            "close_time": pd.DatetimeIndex(htf_timestamps).astype("datetime64[ns]")
            + pd.Timedelta(minutes=htf_tf_minutes),
            "val": htf_values,
        }
    )
    left = pd.DataFrame(
        {"timestamp": pd.DatetimeIndex(base_ts_arr).astype("datetime64[ns]")}
    )
    merged = pd.merge_asof(
        left, right, left_on="timestamp", right_on="close_time", direction="backward"
    )
    return merged["val"].to_numpy()


def _compute_htf_columns(
    df_base: pd.DataFrame, needed_htf: list, pair: str, exchange: str, start_date: str
):
    """
    For every (indicator, period, source, timeframe) tuple whose timeframe
    differs from the strategy's own, fetches that timeframe's own OHLCV
    (with its own warm-up window), computes the indicator there, and merges
    the result back onto df_base as a column suffixed `@<timeframe>`
    (e.g. RSI_14@4h) - aligned via _merge_htf_column so no base candle ever
    sees an HTF value from a candle that hasn't closed yet.

    Returns (df_base, warnings) - warnings is a list of human-readable
    strings for any timeframe that came back empty, so the caller can
    surface it instead of leaving the person to notice "0 trades" and
    wonder why.
    """
    from ohlcv_cache import get_ohlcv

    if not needed_htf:
        return df_base, []

    df_base = df_base.copy()
    base_ts = df_base["timestamp"].to_numpy()
    real_start = pd.Timestamp(start_date[:10])
    warnings = []

    for tf, items in _group_needed_by_timeframe(needed_htf).items():
        tf_minutes = _timeframe_to_minutes(tf)
        warmup_n = _warmup_candles(items)
        warmup_start = real_start - pd.Timedelta(minutes=tf_minutes * warmup_n)

        htf_df = get_ohlcv(
            pair,
            tf,
            warmup_start.strftime("%Y-%m-%d"),
            df_base["timestamp"].iloc[-1].strftime("%Y-%m-%d"),
            exchange,
        )
        if htf_df.empty:
            msg = f"No {tf} data available for {pair} - conditions using this timeframe stayed inert"
            log.warning(msg)
            warnings.append(msg)
            continue

        htf_df = compute_all(htf_df, items)
        htf_df = htf_df.dropna(subset=["close"]).reset_index(drop=True)

        for indicator, period, source, _tf, settings in items:
            col = column_name(
                indicator, period, source, dict(settings) if settings else None
            )
            if col is None or col not in htf_df.columns:
                continue
            aligned_col = f"{col}@{tf}"
            if aligned_col in df_base.columns:
                continue
            df_base[aligned_col] = _merge_htf_column(
                base_ts,
                htf_df["timestamp"].to_numpy(),
                htf_df[col].to_numpy(),
                tf_minutes,
            )

    return df_base, warnings


# ---------------------------------------------------------------------------
# Trading hours - gates order EXECUTION, not signal detection.
# ---------------------------------------------------------------------------


def _parse_trading_hours(slots: list) -> list:
    """Pre-parses 'HH:MM' strings into integer minutes once."""
    parsed = []
    for slot in slots:
        sh, sm = map(int, slot["start"].split(":"))
        eh, em = map(int, slot["end"].split(":"))
        parsed.append(
            {
                "s_min": sh * 60 + sm,
                "e_min": eh * 60 + em,
                "blockSell": slot.get("blockSell", False),
            }
        )
    return parsed


def _precompute_trading_hours(ts_arr, parsed_slots: list):
    """
    Returns (can_buy_arr, can_sell_arr), one boolean per candle.
    Within any slot -> both True. Outside every slot -> buy False, sell
    False too unless no slot has blockSell=True (then sell stays True).
    """
    n = len(ts_arr)
    if not parsed_slots:
        return np.ones(n, dtype=bool), np.ones(n, dtype=bool)

    idx = pd.DatetimeIndex(ts_arr)
    hhmm = (idx.hour * 60 + idx.minute).to_numpy()

    in_any_slot = np.zeros(n, dtype=bool)
    for slot in parsed_slots:
        in_any_slot |= (hhmm >= slot["s_min"]) & (hhmm < slot["e_min"])

    block_sell = any(s["blockSell"] for s in parsed_slots)
    return in_any_slot, in_any_slot | (not block_sell)


# ---------------------------------------------------------------------------
# Position lifecycle - the single-position state machine.
# ---------------------------------------------------------------------------


def _stop_target_prices(
    position: dict, sl_type: str, tp_type: str, stop_loss_val, take_profit_val, atr_val
):
    """SL/TP price levels for the current candle (percent or ATR terms).
    `atr_val` must be the ATR known as of the PREVIOUS candle's close (see
    run_backtest's `atr_prev_arr`) - never the current candle's own ATR,
    which would need that candle's own high/low to exist first."""
    sl_price = None
    if stop_loss_val is not None:
        if sl_type == "atr" and atr_val:
            sl_price = position["entry_price"] - stop_loss_val * atr_val
        else:
            sl_price = position["entry_price"] * (1 - stop_loss_val / 100)

    tp_price = None
    if take_profit_val is not None:
        if tp_type == "atr" and atr_val:
            tp_price = position["entry_price"] + take_profit_val * atr_val
        else:
            tp_price = position["entry_price"] * (1 + take_profit_val / 100)

    return sl_price, tp_price


def _detect_ambiguous_candle(
    low, high, sl_price, tp_price, trailing_stop_loss_val, trailing_high
):
    """
    A base candle's high/low alone can't always tell which of several
    same-candle triggers happened first. Only these three situations are
    ambiguous - everything else is resolved exactly from the base candle:
      - TSL: a new high THIS candle raises the trailing stop, and the
        candle's low already breaches that raised stop - whether the
        pullback happened before or after the new high is unknown.
      - SL+TSL: a fixed SL and a trailing stop are both breached by this
        candle's low - which one the price actually reached first is
        unknown (this can happen even without a new high this candle, if
        the low simply breaches both already-standing levels at once).
      - SL+TP: both levels sit inside this candle's [low, high] range.
    A wide candle where the low breaches an ALREADY-STANDING TSL level (no
    new high this candle) AND the high also reaches TP is not currently
    flagged - not proven to occur in practice yet. If it does, add it here
    the same way as the other cases.
    """
    effective_high = (
        max(high, trailing_high) if trailing_stop_loss_val is not None else None
    )
    tsl_price = (
        effective_high * (1 - trailing_stop_loss_val / 100)
        if effective_high is not None
        else None
    )
    tsl_could_trigger = tsl_price is not None and low <= tsl_price
    sl_could_trigger = sl_price is not None and low <= sl_price
    tp_could_trigger = tp_price is not None and high >= tp_price

    if (
        trailing_stop_loss_val is not None
        and high > trailing_high
        and tsl_could_trigger
    ):
        return True, "tsl_pullback"
    if tsl_could_trigger and sl_could_trigger:
        return True, "sl_tsl_conflict"
    if sl_could_trigger and tp_could_trigger:
        return True, "sl_tp_conflict"
    return False, None


def _mae(position: dict):
    """Max adverse excursion since entry, in % and in ATR units (fixed at entry)."""
    mae_pct = round(
        (position["lowest_low"] - position["entry_price"])
        / position["entry_price"]
        * 100,
        2,
    )
    mae_atr = (
        round(
            (position["lowest_low"] - position["entry_price"]) / position["entry_atr"],
            2,
        )
        if position.get("entry_atr")
        else None
    )
    return mae_pct, mae_atr


def _mfe(position: dict):
    """Max favorable excursion since entry - the inverse of MAE: how much
    unrealized profit was on the table before the trade turned around."""
    mfe_pct = round(
        (position["highest_high"] - position["entry_price"])
        / position["entry_price"]
        * 100,
        2,
    )
    mfe_atr = (
        round(
            (position["highest_high"] - position["entry_price"])
            / position["entry_atr"],
            2,
        )
        if position.get("entry_atr")
        else None
    )
    return mfe_pct, mfe_atr


def _open_position(
    idx,
    fill_price,
    date,
    capital,
    position_size,
    fee_taker,
    sl_type,
    tp_type,
    entry_atr,
    low_arr,
    high_arr,
):
    """Opens a position sized as a fraction of current capital, filled at
    `fill_price` (the OPEN of this candle - see module docstring, 4a).
    Returns (position, capital); position is None (capital unchanged) if
    the allocation is too small to bother with, OR if an ATR-based SL/TP
    was requested but no valid ATR is available yet - silently reinterpreting
    an ATR multiplier as a percentage would change what the strategy's own
    numbers mean without telling anyone."""
    if (sl_type == "atr" or tp_type == "atr") and not entry_atr:
        log.warning(
            f"{date}: ATR-based SL/TP requested but ATR is unavailable - entry skipped"
        )
        return None, capital
    allocated = capital * position_size
    if allocated < 1:
        return None, capital
    qty = allocated / fill_price
    position = {
        "entry_price": fill_price,
        "qty": qty,
        "allocated": allocated,
        "entry_date": date,
        "trailing_high": fill_price,
        # The rest of the entry candle (from its open, where we filled, to
        # its close) still counts toward MAE/MFE/TSL just like every later
        # candle - otherwise a wide entry-candle wick would move the
        # trailing stop without ever showing up in MFE.
        "lowest_low": min(fill_price, float(low_arr[idx])),
        "highest_high": max(fill_price, float(high_arr[idx])),
        "entry_atr": entry_atr,
    }
    capital -= allocated * (1 + fee_taker)
    return position, capital


def _close_position(
    trades: list,
    position: dict,
    exit_price: float,
    exit_date,
    reason: str,
    capital: float,
    fee_taker: float,
    resolution: str = None,
) -> float:
    """
    Appends the buy+sell trade pair for `position` and returns the updated
    capital. This is the single place a position becomes trade dicts - used
    for signal exits, SL/TP/TSL exits, and the final liquidation alike, so
    those three paths can't quietly drift apart from each other over time.
    """
    buy_fee = position["allocated"] * fee_taker
    sell_fee = position["qty"] * exit_price * fee_taker
    proceeds = position["qty"] * exit_price - sell_fee
    net_entry = position["allocated"] + buy_fee
    pnl_pct = round((proceeds - net_entry) / net_entry * 100, 2)

    trades.append(
        {
            "side": "buy",
            "date": position["entry_date"],
            "price": round(position["entry_price"], 4),
            "quantity": round(position["qty"], 6),
            "value": round(position["allocated"], 2),
            "pnl": None,
        }
    )

    mae_pct, mae_atr = _mae(position)
    mfe_pct, mfe_atr = _mfe(position)
    sell_trade = {
        "side": "sell",
        "date": exit_date,
        "price": round(exit_price, 4),
        "quantity": round(position["qty"], 6),
        "value": round(proceeds, 2),
        "pnl": pnl_pct,
        "entryDate": position["entry_date"],
        "entryPrice": round(position["entry_price"], 4),
        "allocated": round(position["allocated"], 2),
        "reason": reason,
        "mae": mae_pct,
        "maeAtr": mae_atr,
        "mfe": mfe_pct,
        "mfeAtr": mfe_atr,
    }
    if resolution is not None:
        sell_trade["resolution"] = resolution
    trades.append(sell_trade)

    return capital + proceeds


# ---------------------------------------------------------------------------
# Main entry point.
# ---------------------------------------------------------------------------


def run_backtest(strategy: dict) -> dict:
    """Runs the backtest and returns the results dict. Raises on error."""
    from ohlcv_cache import get_ohlcv

    # --- 1. Config -----------------------------------------------------
    pair = strategy["pair"]
    timeframe = strategy["timeframe"]
    start_date = strategy["startDate"]
    end_date = strategy["endDate"]
    initial_capital = float(strategy["initialCapital"])
    position_size = float(strategy["positionSize"]) / 100
    stop_loss_val = float(strategy["stopLoss"]) if strategy.get("stopLoss") else None
    take_profit_val = (
        float(strategy["takeProfit"]) if strategy.get("takeProfit") else None
    )
    trailing_stop_loss_val = (
        float(strategy["trailingStopLoss"])
        if strategy.get("trailingStopLoss")
        else None
    )
    sl_type = strategy.get("slType", "percent")
    tp_type = strategy.get("tpType", "percent")
    if sl_type not in ("percent", "atr"):
        sl_type = "percent"
    if tp_type not in ("percent", "atr"):
        tp_type = "percent"
    atr_period = int(strategy.get("atrPeriod") or 14)
    fee_taker = float(strategy.get("feeTaker", 0.0)) / 100
    trading_hours = strategy.get("tradingHours") or []
    conditions = strategy.get("conditions", {})
    entry_conds = conditions.get("entry", [])
    exit_conds = conditions.get("exit", [])
    _validate_conditions(entry_conds, "entry")
    _validate_conditions(exit_conds, "exit")
    exchange = strategy.get("exchange", "binance")

    log.info(f"OHLCV: {pair} {timeframe} {start_date[:10]} -> {end_date[:10]}")

    # --- 2. Indicators, warm-up, OHLCV ----------------------------------
    needed = extract_needed(conditions)
    # A ref explicitly set to the strategy's own timeframe behaves exactly
    # like "no timeframe specified" - normalize both to None.
    needed = [
        (i, p, s, None if (not tf or tf == timeframe) else tf, se)
        for (i, p, s, tf, se) in needed
    ]

    # Only HTF (slower) refs make sense: the simulation advances once per
    # base candle, so a sub-candle ref would just be a misleading single
    # snapshot per base candle instead of the many updates it implies.
    base_minutes = _timeframe_to_minutes(timeframe)
    for _, _, _, tf, _ in needed:
        if tf and _timeframe_to_minutes(tf) < base_minutes:
            raise ValueError(
                f"Timeframe '{tf}' is finer than the strategy's own '{timeframe}' - "
                f"only higher (slower) timeframes are supported for indicator refs. "
                f"If you need {tf} resolution, set it as the strategy's timeframe instead."
            )

    # ATR is always computed: SL/TP may need it, and it's the reference
    # unit for MAE/MFE expressed in ATR (alongside the % version).
    needed.append(("ATR", atr_period, None, None, None))
    base_needed = [n for n in needed if n[3] is None]
    htf_needed = [n for n in needed if n[3] is not None]

    def _max_lookback(conds: list) -> int:
        m = 1
        for item in conds:
            for rule in (item if isinstance(item, list) else [item]):
                m = max(m, rule.get("lookback") or 1)
        return m

    max_lookback = max(_max_lookback(entry_conds), _max_lookback(exit_conds))
    warmup_n = max(_warmup_candles(base_needed), max_lookback)
    tf_minutes = _timeframe_to_minutes(timeframe)
    real_start = pd.Timestamp(start_date[:10])
    warmup_start = real_start - pd.Timedelta(minutes=tf_minutes * warmup_n)

    df_full = get_ohlcv(
        pair,
        timeframe,
        warmup_start.strftime("%Y-%m-%d"),
        _inclusive_end(end_date),
        exchange,
    )
    log.info(
        f"{len(df_full)} candles (including up to {warmup_n} warmup candles "
        f"before {start_date[:10]})"
    )
    if df_full.empty or len(df_full) < 2:
        raise ValueError("Not enough data for backtest (< 2 candles)")

    df_full = compute_all(df_full, base_needed)
    df_full = df_full.dropna(subset=["close"]).reset_index(drop=True)

    # Risk-management ATR: the level a SL/TP/TSL order sits at must be
    # fixed using the ATR known as of the PREVIOUS candle's close - a
    # resting order can't be placed using a range (today's high/low) that
    # doesn't exist yet. Computed once here, on the full (pre-trim) series,
    # so the very first simulated candle still sees the last warm-up
    # candle's ATR instead of losing it to the trim below.
    atr_col = column_name("ATR", atr_period, None)
    df_full["_atr_prev"] = df_full[atr_col].shift(1)

    # Trim to real start_date. Guard: if the actual data starts *after*
    # real_start (e.g. pair listed later), keep whatever we have instead.
    actual_data_start = df_full["timestamp"].iloc[0]
    if actual_data_start < real_start:
        df = df_full[df_full["timestamp"] >= real_start].reset_index(drop=True)
        log.info(
            f"Warmup trimmed: {len(df_full) - len(df)} candles discarded, "
            f"{len(df)} remain for simulation"
        )
    else:
        df = df_full
        log.info(
            f"Data starts at {actual_data_start.date()} (>= requested "
            f"{real_start.date()}), no warmup trim applied"
        )

    if df.empty or len(df) < 2:
        raise ValueError("Not enough data after warmup trim (< 2 candles)")

    # Trim to end_date's own day, inclusive - regardless of exactly where
    # _inclusive_end()'s one-extra-day fetch draws its own boundary, the
    # simulation itself must never run past the day the strategy asked for.
    real_end = pd.Timestamp(end_date[:10]) + pd.Timedelta(days=1)
    df = df[df["timestamp"] < real_end].reset_index(drop=True)

    if df.empty or len(df) < 2:
        raise ValueError("Not enough data after end-date trim (< 2 candles)")

    # HTF indicators: computed on their own timeframe, aligned onto the
    # base timeframe without look-ahead (see _compute_htf_columns).
    warnings = []
    if htf_needed:
        log.info(f"HTF indicators requested: {sorted({n[3] for n in htf_needed})}")
        df, warnings = _compute_htf_columns(df, htf_needed, pair, exchange, start_date)

    # --- 3. Entry/exit signals, vectorized over the whole timeline -----
    entry_signal_arr = (
        _eval_conditions_series(df, entry_conds, timeframe).to_numpy()
        if entry_conds
        else None
    )
    exit_signal_arr = (
        _eval_conditions_series(df, exit_conds, timeframe).to_numpy()
        if exit_conds
        else None
    )

    ts_arr = df["timestamp"].to_numpy()
    open_arr = df["open"].to_numpy(dtype=float)
    close_arr = df["close"].to_numpy(dtype=float)
    high_arr = df["high"].to_numpy(dtype=float)
    low_arr = df["low"].to_numpy(dtype=float)
    atr_prev_arr = df["_atr_prev"].to_numpy(dtype=float)
    date_arr = [str(pd.Timestamp(t)) for t in ts_arr]

    if trading_hours:
        can_buy_arr, can_sell_arr = _precompute_trading_hours(
            ts_arr, _parse_trading_hours(trading_hours)
        )
    else:
        can_buy_arr = np.ones(len(df), dtype=bool)
        can_sell_arr = np.ones(len(df), dtype=bool)

    # LTF resolver: only needed when SL+TP could conflict within the same
    # candle, or when TSL is active (see ltf_resolver.py). Plain SL-alone
    # or TP-alone doesn't need it - base-timeframe high/low is already exact.
    # No fetch happens here: the resolver only pulls 1m/5m/15m data lazily,
    # per day, the first time an actually-ambiguous candle needs it.
    needs_ltf = trailing_stop_loss_val is not None or (
        stop_loss_val is not None and take_profit_val is not None
    )
    ltf_resolver = None
    if needs_ltf and tf_minutes > 1:
        from ltf_resolver import LtfResolver

        ltf_resolver = LtfResolver(pair, exchange, tf_minutes)

    # --- 4. Single-position simulation ----------------------------------
    capital = initial_capital
    position = None  # dict or None - see module docstring re: multi-position
    trades = []
    equity_dates = []
    equity_raw = []  # accumulated unrounded; rounded once in bulk after the loop

    # Rule-based signals are evaluated on candle [idx] but executed at the
    # OPEN of [idx+1] - a candle must be closed before its signal is acted
    # on, and the fill is the first real price available afterwards. This
    # is what makes signal look-ahead structurally impossible.
    pending_entry = False
    pending_exit = False
    exit_uses_cross = _uses_cross_operator(exit_conds)
    dropped_cross_exit_warned = False

    for idx in range(len(df)):
        mark_price = float(close_arr[idx])  # for mark-to-market equity only
        fill_price = float(open_arr[idx])  # for order execution
        date = date_arr[idx]
        can_buy, can_sell = bool(can_buy_arr[idx]), bool(can_sell_arr[idx])
        atr_prev = _nan_to_none(atr_prev_arr[idx])

        # MAE/MFE tracking: lowest low / highest high reached since entry,
        # updated before any exit path so the exit candle's own low/high
        # is included regardless of which branch closes the trade below.
        # prev_* is kept so an LTF-resolved exit later this candle can
        # correct for price action that happened AFTER the real
        # intra-candle trigger point (see the ambiguous-candle branch).
        prev_highest_high = position["highest_high"] if position else None
        prev_lowest_low = position["lowest_low"] if position else None
        if position:
            position["lowest_low"] = min(position["lowest_low"], float(low_arr[idx]))
            position["highest_high"] = max(
                position["highest_high"], float(high_arr[idx])
            )

        # --- Execute orders decided on the previous candle, at this candle's open ---
        if pending_entry and position is None:
            if can_buy:
                position, capital = _open_position(
                    idx,
                    fill_price,
                    date,
                    capital,
                    position_size,
                    fee_taker,
                    sl_type,
                    tp_type,
                    atr_prev,
                    low_arr,
                    high_arr,
                )
            pending_entry = False  # a blocked buy signal is dropped, not retried

        if pending_exit and position is not None:
            # Executes unconditionally at the open, no exception: a signal
            # is evaluated using candle N (closed) and can only be acted on
            # from the open of N+1 onward - reading N+1's own later low/high
            # to decide whether to honor it would use that candle's future
            # against itself.
            if can_sell:
                capital = _close_position(
                    trades, position, fill_price, date, "signal", capital, fee_taker
                )
                position = None
            else:
                # A blocked sell signal is dropped, not retried - symmetric
                # with the buy side: trading only happens inside trading
                # hours. For a level-based rule (e.g. RSI>70) this is
                # usually harmless, since the same condition is likely to
                # still be true once trading hours reopen. A cross_above/
                # cross_below rule is a ONE-CANDLE event that (by
                # construction, see _validate_conditions) can't repeat on
                # the very next candle - dropping it can mean the position
                # is never signalled out again and rides to a forced
                # liquidation instead.
                if exit_uses_cross and not dropped_cross_exit_warned:
                    warnings.append(
                        f"{date}: a cross_above/cross_below exit signal was blocked by trading "
                        f"hours and dropped - since a cross doesn't repeat on the next candle, "
                        f"this position may end up held until the end of the backtest"
                    )
                    dropped_cross_exit_warned = True
            pending_exit = False

        # --- Detect this candle's signals, and resolve SL/TP/TSL if a
        # position is (still, or newly) open ---
        if position is None:
            if entry_conds and bool(entry_signal_arr[idx]):
                pending_entry = True
        else:
            exit_price, reason, resolution = _resolve_open_position(
                idx,
                ts_arr,
                low_arr,
                high_arr,
                fill_price,
                position,
                sl_type,
                tp_type,
                stop_loss_val,
                take_profit_val,
                trailing_stop_loss_val,
                ltf_resolver,
                date,
                prev_highest_high,
                prev_lowest_low,
            )
            if exit_price is not None:
                capital = _close_position(
                    trades,
                    position,
                    exit_price,
                    date,
                    reason,
                    capital,
                    fee_taker,
                    resolution=resolution,
                )
                log.debug(f"SL/TP {date} @ {exit_price:.4f}")
                position = None
                if entry_conds and bool(entry_signal_arr[idx]):
                    # Same-candle re-entry check, same as after a signal
                    # exit above - a stop firing mid-candle shouldn't cost
                    # an extra candle of delay that a signal exit wouldn't.
                    pending_entry = True
            elif exit_conds and bool(exit_signal_arr[idx]):
                pending_exit = True

        # Equity is marked to market AFTER this candle's events (entry
        # fill, exit resolution) are final, using this candle's close -
        # marking it before would attribute a candle's own price move to
        # the WRONG side of any entry/exit that happened during it.
        current_equity = capital + (position["qty"] * mark_price if position else 0)
        equity_dates.append(date)
        equity_raw.append(current_equity)

    # Liquidate any open position on the last candle (forced mark-to-market
    # close - there is no "next candle" left to open a fill on). This
    # necessarily matches the last equity point above exactly, since both
    # use this same close price for this same still-open position.
    if position:
        last_price, last_date = float(close_arr[-1]), str(date_arr[-1])
        capital = _close_position(
            trades, position, last_price, last_date, "end", capital, fee_taker
        )

    equity_rounded = np.round(np.array(equity_raw, dtype=np.float64), 2)

    # --- 5. Aggregation & serialization ---------------------------------
    result = build_result(
        trades=trades,
        equity_dates=equity_dates,
        equity_raw=equity_rounded,
        ts_arr=ts_arr,
        close_arr=close_arr,
        initial_capital=initial_capital,
        final_capital=capital,
        start_date=start_date,
        end_date=end_date,
        tf_minutes=tf_minutes,
    )
    if warnings:
        result["warnings"] = warnings
    return result
