"""
backtest.py - Strategy simulation engine (OPTIMIZED)

Separated from the worker to be independently testable.
"""

import math
import logging
import numpy as np
import pandas as pd
from indicators import compute_all, resolve_value, extract_needed
from time import perf_counter

from compute_results import build_result

_last = perf_counter()
def timer(label=""):
    global _last
    now = perf_counter()
    elapsed = now - _last
    _last = now
    log.debug(f"[TIMER] {label}: {elapsed:.3f}s")

try:
    import lttbc
    def _lttb(timestamps, values, threshold):
        ts = np.array(timestamps, dtype=np.float64)
        vs = np.array(values,     dtype=np.float64)
        if len(ts) <= threshold:
            return list(range(len(ts)))
        # lttbc.downsample returns (x_sampled, y_sampled) - not indices
        # recover original indices via searchsorted on the x array
        x_sampled, _ = lttbc.downsample(ts, vs, threshold)
        return np.searchsorted(ts, x_sampled).tolist()
except ImportError:
    def _lttb(timestamps, values, threshold):
        step = max(1, len(timestamps) // threshold)
        return list(range(0, len(timestamps), step))

log = logging.getLogger("snipeit.backtest")

CURVE_THRESHOLD = 300

_TF_MINUTES = {
    "1m": 1, "3m": 3, "5m": 5, "15m": 15, "30m": 30,
    "1h": 60, "2h": 120, "4h": 240, "6h": 360, "8h": 480, "12h": 720,
    "1d": 1440, "3d": 4320, "1w": 10080,
}

def _timeframe_to_minutes(tf: str) -> int:
    """Converts a timeframe string (e.g. '4h', '1d') to minutes."""
    return _TF_MINUTES.get(tf, 60)  # default to 1h if unknown
OPERATORS = {
    ">":           lambda a, b, pa, pb: a > b,
    "<":           lambda a, b, pa, pb: a < b,
    ">=":          lambda a, b, pa, pb: a >= b,
    "<=":          lambda a, b, pa, pb: a <= b,
    "==":          lambda a, b, pa, pb: abs(a - b) < 1e-9,
    "cross_above": lambda a, b, pa, pb: pa is not None and pb is not None and pa <= pb and a > b,
    "cross_below": lambda a, b, pa, pb: pa is not None and pb is not None and pa >= pb and a < b,
}

_COMBINE_OPS = {
    "+": lambda a, b: a + b,
    "-": lambda a, b: a - b,
    "*": lambda a, b: a * b,
    "/": lambda a, b: (a / b) if b != 0 else None,
}


def _resolve_ref(df: pd.DataFrame, indicator: str, period, idx: int, source=None, offset: int = 0, timeframe=None, settings=None):
    """
    Resolves an indicator ref at `idx`, shifted back by `offset` candles
    (offset=0 -> current candle, offset=1 -> previous candle, ...).
    Returns None if the offset points before the start of the DataFrame
    (not enough history yet - same "not ready" semantics as lookback).
    `timeframe`, when set, reads the HTF/LTF-aligned column populated by
    _compute_htf_columns() instead of the base-timeframe one.
    `settings`, when set, overrides an indicator's extra params (e.g.
    MACD's fast/slow/signal) on top of REGISTRY's defaults.
    """
    i = idx - (offset or 0)
    if i < 0:
        return None
    return resolve_value(df, indicator, period, i, source, timeframe, settings)


def _resolve_expr(df: pd.DataFrame, cond: dict, idx: int, prefix: str = ""):
    """
    Resolves one side of a condition: a single indicator ref, optionally
    combined with a second ref via +,-,*,/ (e.g. CLOSE - OPEN = candle body).
    `prefix` selects which set of keys to read:
      ""      -> indicator/period/source/offset/timeframe/settings/combine*          (LHS)
      "value" -> valueIndicator/valueIndicatorPeriod/.../valueCombine* (RHS)
    The combine* sub-ref always shares its parent's timeframe (no separate
    combineTimeframe/valueCombineTimeframe key), but has its own settings
    (combineSettings/valueCombineSettings).
    Returns (current_value, previous_value), both float or None.
    """
    ind_key    = f"{prefix}Indicator" if prefix else "indicator"
    per_key    = f"{prefix}IndicatorPeriod" if prefix else "period"
    src_key    = f"{prefix}IndicatorSource" if prefix else "source"
    off_key    = f"{prefix}IndicatorOffset" if prefix else "offset"
    tf_key     = f"{prefix}IndicatorTimeframe" if prefix else "timeframe"
    set_key    = f"{prefix}IndicatorSettings" if prefix else "settings"
    cop_key    = f"{prefix}CombineOp" if prefix else "combineOp"
    cind_key   = f"{prefix}CombineIndicator" if prefix else "combineIndicator"
    cper_key   = f"{prefix}CombinePeriod" if prefix else "combinePeriod"
    csrc_key   = f"{prefix}CombineSource" if prefix else "combineSource"
    coff_key   = f"{prefix}CombineOffset" if prefix else "combineOffset"
    cset_key   = f"{prefix}CombineSettings" if prefix else "combineSettings"

    offset    = cond.get(off_key) or 0
    timeframe = cond.get(tf_key)
    settings  = cond.get(set_key)
    val  = _resolve_ref(df, cond[ind_key], cond.get(per_key), idx,     cond.get(src_key), offset, timeframe, settings)
    prev = _resolve_ref(df, cond[ind_key], cond.get(per_key), idx - 1, cond.get(src_key), offset, timeframe, settings)

    if val is None:
        return None, None

    combine_op = cond.get(cop_key)
    if combine_op:
        c_offset   = cond.get(coff_key) or 0
        c_settings = cond.get(cset_key)
        c_val  = _resolve_ref(df, cond[cind_key], cond.get(cper_key), idx,     cond.get(csrc_key), c_offset, timeframe, c_settings)
        c_prev = _resolve_ref(df, cond[cind_key], cond.get(cper_key), idx - 1, cond.get(csrc_key), c_offset, timeframe, c_settings)
        fn = _COMBINE_OPS.get(combine_op)
        if fn is None or c_val is None:
            return None, None
        val  = fn(val, c_val)
        prev = fn(prev, c_prev) if (prev is not None and c_prev is not None) else None
        if val is None:
            return None, None

    return val, prev


def _eval_single(df: pd.DataFrame, cond: dict, idx: int) -> bool:
    operator = cond["operator"]

    val, prev = _resolve_expr(df, cond, idx, prefix="")
    if val is None:
        return False

    if cond.get("valueIndicator"):
        threshold, prev_b = _resolve_expr(df, cond, idx, prefix="value")
        if threshold is None:
            return False
        value_multiplier = float(cond.get("valueMultiplier") or 1.0)
        threshold *= value_multiplier
        if prev_b is not None:
            prev_b *= value_multiplier
    else:
        threshold = float(cond["value"])
        prev_b    = threshold

    fn = OPERATORS.get(operator)
    if not fn:
        return False

    try:
        return fn(val, threshold, prev, prev_b)
    except Exception:
        return False


def eval_condition(df: pd.DataFrame, cond: dict, idx: int) -> bool:
    """
    Evaluates a single rule on candle idx.
    If cond['lookback'] (int > 1) is set, the rule is re-evaluated on each of
    the last N candles (idx-N+1 .. idx) and aggregated:
      - lookbackMode "all" (default): every candle in the window must satisfy it
      - lookbackMode "any": at least one candle in the window must satisfy it
    Ex: {"indicator": "LOW", "operator": ">", "valueIndicator": "BB_MID", "lookback": 5}
        -> the last 5 lows are all above BB_MID
    """
    lookback = cond.get("lookback") or 1
    if lookback <= 1:
        return _eval_single(df, cond, idx)

    mode      = cond.get("lookbackMode", "all")
    start     = idx - lookback + 1
    if start < 0:
        return False  # not enough history yet for the full window

    window = range(start, idx + 1)
    if mode == "any":
        return any(_eval_single(df, cond, i) for i in window)
    return all(_eval_single(df, cond, i) for i in window)


def eval_conditions(df: pd.DataFrame, conditions: list, idx: int) -> bool:
    """
    Evaluates conditions with OR/AND logic:
      - Flat format  [rule, rule, ...]             -> implicit AND (backward compat)
      - Grouped format [[rule, rule], [rule], ...] -> OR between groups, AND within each group
    """
    if not conditions:
        return False
    # Detect format: if first element is a list -> grouped format
    if isinstance(conditions[0], list):
        return any(
            all(eval_condition(df, rule, idx) for rule in group)
            for group in conditions
            if group
        )
    # Flat backward-compat format -> AND
    return all(eval_condition(df, c, idx) for c in conditions)


_VECTORIZABLE_OPS = {">", "<", ">=", "<=", "=="}


def _try_vectorize_conditions(df: pd.DataFrame, conditions: list):
    """
    Returns a boolean numpy array (one value per candle) if `conditions`
    is simple enough to pre-compute in one vectorized pass, else None.

    Bails out to None (-> caller falls back to per-candle eval_conditions)
    whenever a condition uses something the vectorized path doesn't model:
      - grouped OR/AND format
      - lookback > 1 (rolling-window aggregation, not just elementwise)
      - cross_above / cross_below (needs the previous-candle value)
      - indicator-vs-indicator comparisons (valueIndicator set, possibly
        with valueMultiplier)
      - unknown indicator / operator / missing column
    """
    if not conditions:
        return None
    if isinstance(conditions[0], list):
        return None  # grouped OR format: not vectorized

    from indicators import REGISTRY, column_name

    result = np.ones(len(df), dtype=bool)

    for cond in conditions:
        op = cond.get("operator", "")
        if op not in _VECTORIZABLE_OPS:
            return None
        if cond.get("valueIndicator"):
            return None
        if cond.get("offset") or cond.get("combineOp") or cond.get("timeframe") or cond.get("settings"):
            return None
        lookback = cond.get("lookback") or 1
        if lookback > 1:
            return None

        indicator = cond["indicator"]
        period    = cond.get("period")
        source    = cond.get("source")
        meta      = REGISTRY.get(indicator)
        if not meta:
            return None
        if "extra_params" in meta:
            return None  # e.g. MACD - column name needs settings the fast-path doesn't model

        col = column_name(indicator, period, source)
        if col is None:
            return None

        if col not in df.columns:
            return None
        
        if "value" not in cond:
            return None
        threshold = float(cond["value"])
        series    = df[col].to_numpy(dtype=float)

        if   op == ">":  mask = series >  threshold
        elif op == "<":  mask = series <  threshold
        elif op == ">=": mask = series >= threshold
        elif op == "<=": mask = series <= threshold
        elif op == "==": mask = np.abs(series - threshold) < 1e-9
        else:            return None

        mask    = mask & ~np.isnan(series)   # NaN -> condition False, same as resolve_value -> None
        result &= mask

    return result


def _parse_trading_hours(slots: list) -> list:
    """Pre-parses 'HH:MM' strings into integer minutes once, instead of
    re-splitting them on every candle (what _in_trading_hours did before)."""
    parsed = []
    for slot in slots:
        sh, sm = map(int, slot["start"].split(":"))
        eh, em = map(int, slot["end"].split(":"))
        parsed.append({
            "s_min":     sh * 60 + sm,
            "e_min":     eh * 60 + em,
            "blockSell": slot.get("blockSell", False),
        })
    return parsed


def _precompute_trading_hours(ts_arr, parsed_slots: list):
    """
    Vectorized equivalent of calling _in_trading_hours() on every candle.
    Returns (can_buy_arr, can_sell_arr), two boolean numpy arrays.
    Semantics match _in_trading_hours() exactly: within range -> both True;
    outside all ranges -> buy False, sell False unless no slot has
    blockSell=True (then sell stays True).
    """
    n = len(ts_arr)
    if not parsed_slots:
        return np.ones(n, dtype=bool), np.ones(n, dtype=bool)

    ts_pd = pd.DatetimeIndex(ts_arr)
    hhmm  = (ts_pd.hour * 60 + ts_pd.minute).to_numpy()

    in_any_slot = np.zeros(n, dtype=bool)
    for slot in parsed_slots:
        in_any_slot |= (hhmm >= slot["s_min"]) & (hhmm < slot["e_min"])

    block_sell = any(s["blockSell"] for s in parsed_slots)
    can_buy    = in_any_slot
    can_sell   = in_any_slot | (not block_sell)
    return can_buy, can_sell


def _in_trading_hours(timestamp, slots: list) -> tuple[bool, bool]:
    """
    Returns (can_buy, can_sell).
    If no range defined -> (True, True).
    If outside range -> (False, False) unless blockSell=False in which case sell remains allowed.
    """
    if not slots:
        return True, True

    t = pd.Timestamp(timestamp)
    hhmm = t.hour * 60 + t.minute

    for slot in slots:
        sh, sm = map(int, slot["start"].split(":"))
        eh, em = map(int, slot["end"].split(":"))
        s_min = sh * 60 + sm
        e_min = eh * 60 + em
        if s_min <= hhmm < e_min:
            return True, True # within range -> everything allowed

    # Outside all ranges
    # blockSell: if AT LEAST ONE slot has blockSell=True -> sell is also blocked
    block_sell = any(slot.get("blockSell", False) for slot in slots)
    return False, not block_sell

def _warmup_candles(needed_indicators: list) -> int:
    """
    Number of extra candles to fetch before the requested start date so
    every needed indicator has fully converged by the time the real
    simulation begins (factor of 2 for EWM-based indicators' convergence).
    Shared by the base-timeframe warmup calc in run_backtest() and by
    _compute_htf_columns() (each HTF group needs its own warmup, expressed
    in that group's own candle size).
    """
    from indicators import REGISTRY
    # Hardcoded minimums for indicators with no variable 'period' param
    FIXED_MINIMUMS = {
        "MACD": 34, "MACD_SIGNAL": 34, "MACD_HIST": 34,
        "VWAP": 1, "CLOSE": 1, "VOLUME": 1
    }
    max_period = 1
    for indicator, period, *_ in needed_indicators:
        if indicator in FIXED_MINIMUMS:
            p = FIXED_MINIMUMS[indicator]
        else:
            meta = REGISTRY.get(indicator)
            if not meta:
                continue
            p = period or meta["params"].get("period", 1) or 1
        max_period = max(max_period, p)
    return max_period * 2 + 1


def _group_needed_by_timeframe(needed_htf: list) -> dict:
    """Groups (indicator, period, source, timeframe) tuples by their timeframe."""
    groups: dict = {}
    for item in needed_htf:
        tf = item[3]
        groups.setdefault(tf, []).append(item)
    return groups


def _merge_htf_column(base_ts_arr, htf_timestamps, htf_values, htf_tf_minutes: int) -> np.ndarray:
    """
    Aligns an HTF-computed column onto the base timeframe's index, without
    look-ahead: for each base candle (open time T), the value used is the
    one from the last HTF candle that had FULLY CLOSED at or before T
    (close_time <= T). A base candle earlier than every closed HTF candle
    gets NaN (resolve_value() then reports it as "no value yet").
    """
    # base_ts_arr (reloaded from the parquet cache) and htf_timestamps
    # (freshly fetched) can end up with different datetime64 resolutions
    # (ms/us/ns) depending on how each was produced upstream - merge_asof
    # refuses to compare mismatched resolutions, so normalize both to ns.
    right = pd.DataFrame({
        "close_time": (pd.DatetimeIndex(htf_timestamps).astype("datetime64[ns]")
                        + pd.Timedelta(minutes=htf_tf_minutes)),
        "val": htf_values,
    })
    left = pd.DataFrame({"timestamp": pd.DatetimeIndex(base_ts_arr).astype("datetime64[ns]")})
    merged = pd.merge_asof(left, right, left_on="timestamp", right_on="close_time", direction="backward")
    return merged["val"].to_numpy()


def _compute_htf_columns(df_base: pd.DataFrame, needed_htf: list, pair: str,
                          exchange: str, start_date: str) -> pd.DataFrame:
    """
    For every (indicator, period, source, timeframe) tuple whose timeframe
    differs from the strategy's base one, fetches that timeframe's own OHLCV
    (with its own warmup window), computes the indicator there, and merges
    the result back onto df_base as a column suffixed `@<timeframe>`
    (e.g. RSI_14@4h) - aligned via _merge_htf_column so no base candle ever
    sees an HTF value from a candle that hasn't closed yet.
    """
    from ohlcv_cache import get_ohlcv
    from indicators import column_name

    if not needed_htf:
        return df_base

    df_base   = df_base.copy()
    base_ts   = df_base["timestamp"].to_numpy()
    real_start = pd.Timestamp(start_date[:10])

    for tf, items in _group_needed_by_timeframe(needed_htf).items():
        tf_minutes = _timeframe_to_minutes(tf)
        warmup_n   = _warmup_candles(items)
        warmup_start = real_start - pd.Timedelta(minutes=tf_minutes * warmup_n)

        htf_df = get_ohlcv(pair, tf, warmup_start.strftime("%Y-%m-%d"), df_base["timestamp"].iloc[-1].strftime("%Y-%m-%d"), exchange)
        if htf_df.empty:
            log.warning(f"HTF fetch returned no data for {pair} {tf} - conditions using this timeframe will stay inert")
            continue

        htf_df = compute_all(htf_df, items)
        htf_df = htf_df.dropna(subset=["close"]).reset_index(drop=True)

        for item in items:
            indicator = item[0]
            period    = item[1]
            source    = item[2] if len(item) > 2 else None
            settings  = dict(item[4]) if len(item) > 4 and item[4] else None
            col = column_name(indicator, period, source, settings)
            if col is None or col not in htf_df.columns:
                continue
            aligned_col = f"{col}@{tf}"
            if aligned_col in df_base.columns:
                continue
            df_base[aligned_col] = _merge_htf_column(base_ts, htf_df["timestamp"].to_numpy(), htf_df[col].to_numpy(), tf_minutes)

    return df_base


def run_backtest(strategy: dict) -> dict:
    """
    Runs the backtest and returns the results dict.
    Raises an exception if something goes wrong.
    """
    from ohlcv_cache import get_ohlcv

    pair            = strategy["pair"]
    timeframe       = strategy["timeframe"]
    start_date      = strategy["startDate"]
    end_date        = strategy["endDate"]
    initial_capital = float(strategy["initialCapital"])
    position_size   = float(strategy["positionSize"]) / 100
    stop_loss_val   = float(strategy["stopLoss"])   if strategy.get("stopLoss")   else None
    take_profit_val = float(strategy["takeProfit"]) if strategy.get("takeProfit") else None
    trailing_stop_loss_val = float(strategy["trailingStopLoss"]) if strategy.get("trailingStopLoss") else None
    sl_type         = strategy.get("slType", "percent")   # "percent" | "atr"
    tp_type         = strategy.get("tpType", "percent")   # "percent" | "atr"
    atr_period      = int(strategy.get("atrPeriod") or 14)
    if sl_type not in ("percent", "atr"): sl_type = "percent"
    if tp_type not in ("percent", "atr"): tp_type = "percent"
    fee_taker       = float(strategy.get("feeTaker", 0.0)) / 100 # % -> ratio
    fee_maker       = float(strategy.get("feeMaker", 0.0)) / 100
    trading_hours   = strategy.get("tradingHours") or [] # [{start, end, blockSell?}]
    conditions      = strategy.get("conditions", {})
    entry_conds     = conditions.get("entry", [])
    exit_conds      = conditions.get("exit", [])
    exchange        = strategy.get("exchange", "binance")

    # OHLCV (from cache or download)
    log.info(f"OHLCV: {pair} {timeframe} {start_date[:10]} -> {end_date[:10]}")

    # Warmup period
    # Indicators like MACD(26) or EWM-based ones need N candles before they
    # produce reliable values. We fetch extra candles *before* start_date so
    # indicators are fully converged when the real simulation begins.
    # The warmup window is: max(indicator period) * 2  (factor of 2 for EWM convergence).
    # If the exchange has no data that far back, we simply start from whatever is available.
    needed = extract_needed(conditions)
    # A ref explicitly set to the strategy's own timeframe behaves exactly
    # like "no timeframe specified" - normalize both to None so downstream
    # code has a single code path for "base timeframe".
    needed = [(i, p, s, None if (not tf or tf == timeframe) else tf, se) for (i, p, s, tf, se) in needed]

    # Only HTF (slower) refs make sense. A "finer" timeframe than the
    # strategy's own can't add real precision: the simulation loop only
    # advances once per base candle, so a sub-candle ref would just be a
    # single misleading snapshot per base candle instead of the many
    # updates it implies. If you need that resolution, that IS your base
    # timeframe - set the strategy to it directly instead.
    base_minutes = _timeframe_to_minutes(timeframe)
    for _, _, _, tf, _ in needed:
        if tf and _timeframe_to_minutes(tf) < base_minutes:
            raise ValueError(
                f"Timeframe '{tf}' is finer than the strategy's own '{timeframe}' - "
                f"only higher (slower) timeframes are supported for indicator refs. "
                f"If you need {tf} resolution, set it as the strategy's timeframe instead."
            )

    if sl_type == "atr" or tp_type == "atr":
        needed.append(("ATR", atr_period, None, None, None))  # SL/TP ATR is always evaluated on the base timeframe

    base_needed = [n for n in needed if n[3] is None]
    htf_needed  = [n for n in needed if n[3] is not None]

    def _max_lookback(conds: list) -> int:
        m = 1
        for item in conds:
            rules = item if isinstance(item, list) else [item]
            for rule in rules:
                m = max(m, rule.get("lookback") or 1)
        return m

    max_lookback = max(_max_lookback(entry_conds), _max_lookback(exit_conds))

    warmup_n     = max(_warmup_candles(base_needed), max_lookback)
    tf_minutes   = _timeframe_to_minutes(timeframe)
    warmup_delta = pd.Timedelta(minutes=tf_minutes * warmup_n)
    real_start   = pd.Timestamp(start_date[:10])
    warmup_start = real_start - warmup_delta

    # Fetch with warmup prefix - get_ohlcv handles cache transparently
    df_full = get_ohlcv(pair, timeframe, warmup_start.strftime("%Y-%m-%d"), end_date, exchange)
    log.info(f"{len(df_full)} candles (including up to {warmup_n} warmup candles before {start_date[:10]})")

    if df_full.empty or len(df_full) < 2:
        raise ValueError("Not enough data for backtest (< 2 candles)")

    # Compute base-timeframe indicators on the full DataFrame (warmup + real period)
    df_full = compute_all(df_full, base_needed)
    df_full = df_full.dropna(subset=["close"]).reset_index(drop=True)

    # Trim to real start_date for the simulation.
    # Guard: if the actual data starts *after* real_start (e.g. pair listed later),
    # we don't discard anything - just use whatever we have.
    actual_data_start = df_full["timestamp"].iloc[0]
    if actual_data_start < real_start:
        df = df_full[df_full["timestamp"] >= real_start].reset_index(drop=True)
        log.info(f"Warmup trimmed: {len(df_full) - len(df)} candles discarded, {len(df)} remain for simulation")
    else:
        df = df_full
        log.info(f"Data starts at {actual_data_start.date()} (>= requested {real_start.date()}), no warmup trim applied")

    if df.empty or len(df) < 2:
        raise ValueError("Not enough data after warmup trim (< 2 candles)")

    # HTF/LTF indicators: computed on their own timeframe, then aligned onto
    # the base timeframe's index without look-ahead (see _compute_htf_columns).
    if htf_needed:
        htf_tfs = sorted({n[3] for n in htf_needed})
        log.info(f"HTF indicators requested: {htf_tfs}")
        df = _compute_htf_columns(df, htf_needed, pair, exchange, start_date)

    # Simulation
    capital  = initial_capital
    position = None   # dict or None
    trades   = []
    equity_dates = []
    equity_raw   = []  # accumulated unrounded; rounded once in bulk after the loop (perf)

    # Signals are evaluated on candle [idx] but executed on [idx+1].
    # This avoids look-ahead bias: a candle must be closed before acting.
    pending_entry = False
    pending_exit  = False

    close_arr = df["close"].to_numpy(dtype=float)
    high_arr  = df["high"].to_numpy(dtype=float)
    low_arr   = df["low"].to_numpy(dtype=float)
    ts_arr    = df["timestamp"].to_numpy()
    date_arr  = [str(pd.Timestamp(t)) for t in ts_arr] # plain python list of str, not np.array

    if trading_hours:
        parsed_slots = _parse_trading_hours(trading_hours)
        can_buy_arr, can_sell_arr = _precompute_trading_hours(ts_arr, parsed_slots)
    else:
        can_buy_arr  = np.ones(len(df), dtype=bool)
        can_sell_arr = np.ones(len(df), dtype=bool)
    
    entry_signal_arr = _try_vectorize_conditions(df, entry_conds)
    exit_signal_arr  = _try_vectorize_conditions(df, exit_conds)
    use_vec_entry    = entry_signal_arr is not None
    use_vec_exit     = exit_signal_arr  is not None
    log.debug(f"Vectorized signals: entry={'yes' if use_vec_entry else 'no (fallback)'}, "
              f"exit={'yes' if use_vec_exit else 'no (fallback)'}")

    for idx in range(len(df)):
        price = float(close_arr[idx])
        date  = date_arr[idx]

        # Trading hours are checked once per candle and used to gate the
        # EXECUTION of orders (this candle, where capital actually moves),
        # not the detection of signals (which is just indicator math and
        # doesn't depend on the clock).
        can_buy, can_sell = bool(can_buy_arr[idx]), bool(can_sell_arr[idx])

        current_equity = capital + (position["qty"] * price if position else 0)
        equity_dates.append(date)
        equity_raw.append(current_equity)

        # Execute orders decided on the previous candle
        if pending_entry and position is None:
            if can_buy:
                allocated = capital * position_size
                if allocated >= 1:
                    qty = allocated / price
                    position = {
                        "entry_price": price,
                        "qty":         qty,
                        "allocated":   allocated,
                        "entry_date":  date,
                        "trailing_high": price,
                    }
                    capital -= allocated
                    capital -= allocated * fee_taker
                    log.debug(f"BUY   {date} {qty:.6f} @ {price:.4f}")
            pending_entry = False

        # Check SL/TP before potential signal sell
        if pending_exit and position is not None:
            if trailing_stop_loss_val is not None:
                _sl_check = position["trailing_high"] * (1 - trailing_stop_loss_val / 100)
            elif stop_loss_val is not None:
                _atr = resolve_value(df, "ATR", atr_period, idx) if sl_type == "atr" else None
                if sl_type == "atr" and _atr:
                    _sl_check = position["entry_price"] - stop_loss_val * _atr
                else:
                    _sl_check = position["entry_price"] * (1 - stop_loss_val / 100)
            else:
                _sl_check = None

            _tp_check = None
            if take_profit_val is not None:
                _atr_tp = resolve_value(df, "ATR", atr_period, idx) if tp_type == "atr" else None
                if tp_type == "atr" and _atr_tp:
                    _tp_check = position["entry_price"] + take_profit_val * _atr_tp
                else:
                    _tp_check = position["entry_price"] * (1 + take_profit_val / 100)

            sl_hit = _sl_check and float(low_arr[idx]) <= _sl_check
            tp_hit = _tp_check and float(high_arr[idx]) >= _tp_check
            if sl_hit or tp_hit:
                pending_exit = False

        if pending_exit and position is not None and can_sell:
            buy_fee      = position["allocated"] * fee_taker
            sell_fee     = position["qty"] * price * fee_taker
            proceeds     = position["qty"] * price - sell_fee
            net_entry    = position["allocated"] + buy_fee
            pct_change   = (proceeds - net_entry) / net_entry
            pnl_pct      = round(pct_change * 100, 2)
            trades.append({
                "side":       "buy",
                "date":       position["entry_date"],
                "price":      round(position["entry_price"], 4),
                "quantity":   round(position["qty"], 6),
                "value":      round(position["allocated"], 2),
                "pnl":        None,
            })
            trades.append({
                "side":       "sell",
                "date":       date,
                "price":      round(price, 4),
                "quantity":   round(position["qty"], 6),
                "value":      round(proceeds, 2),
                "pnl":        pnl_pct,
                "entryDate":  position["entry_date"],
                "entryPrice": round(position["entry_price"], 4),
                "allocated": round(position["allocated"], 2),
                "reason":     "signal",
            })
            log.debug(f"SELL  {date} @ {price:.4f} PnL {pnl_pct:+.2f}%")
            capital += proceeds
            position = None
            pending_exit = False

        if position is None:
            if entry_conds:
                if use_vec_entry:
                    entry_hit = bool(entry_signal_arr[idx])
                else:
                    entry_hit = eval_conditions(df, entry_conds, idx)
                if entry_hit:
                    pending_entry = True
        else:
            low  = float(low_arr[idx])
            high = float(high_arr[idx])

            # Compute SL/TP: percent or ATR
            atr_val = resolve_value(df, "ATR", atr_period, idx) if (sl_type == "atr" or tp_type == "atr") else None
            if stop_loss_val is not None:
                if sl_type == "atr" and atr_val:
                    sl_price = position["entry_price"] - stop_loss_val * atr_val
                else:
                    sl_price = position["entry_price"] * (1 - stop_loss_val / 100)
            else:
                sl_price = None
            if take_profit_val is not None:
                if tp_type == "atr" and atr_val:
                    tp_price = position["entry_price"] + take_profit_val * atr_val
                else:
                    tp_price = position["entry_price"] * (1 + take_profit_val / 100)
            else:
                tp_price = None

            # Compute trailing SL - update high from entry
            if trailing_stop_loss_val is not None:
                if high > position["trailing_high"]:
                    position["trailing_high"] = high
                tsl_price = position["trailing_high"] * (1 - trailing_stop_loss_val / 100)
            else:
                tsl_price = None

            # Intra-candle SL/TP: exact price reached within the candle, immediate execution
            # Convention if both are hit: SL takes priority (worst case)
            exit_price = None
            if tsl_price and low <= tsl_price:
                exit_price = tsl_price
            elif sl_price and low <= sl_price:
                exit_price = sl_price
            elif tp_price and high >= tp_price:
                exit_price = tp_price

            if exit_price is not None:
                buy_fee    = position["allocated"] * fee_taker
                sell_fee   = position["qty"] * exit_price * fee_taker
                proceeds   = position["qty"] * exit_price - sell_fee
                net_entry  = position["allocated"] + buy_fee
                pct_change = (proceeds - net_entry) / net_entry
                pnl_pct    = round(pct_change * 100, 2)
                reason     = "tsl" if tsl_price is not None and exit_price == tsl_price else "risk"
                trades.append({
                    "side":     "buy",
                    "date":     position["entry_date"],
                    "price":    round(position["entry_price"], 4),
                    "quantity": round(position["qty"], 6),
                    "value":    round(position["allocated"], 2),
                    "pnl":      None,
                })
                trades.append({
                    "side":       "sell",
                    "date":       date,
                    "price":      round(exit_price, 4),
                    "quantity":   round(position["qty"], 6),
                    "value":      round(proceeds, 2),
                    "pnl":        pnl_pct,
                    "entryDate":  position["entry_date"],
                    "entryPrice": round(position["entry_price"], 4),
                    "allocated": round(position["allocated"], 2),
                    "reason":     reason,
                })
                log.debug(f"SL/TP {date} @ {exit_price:.4f} PnL {pnl_pct:+.2f}%")
                capital  += proceeds
                position  = None
            else:
                # No SL/TP hit - evaluate exit_conds (executed on next candle)
                if exit_conds:
                    if use_vec_exit:
                        exit_hit = bool(exit_signal_arr[idx])
                    else:
                        exit_hit = eval_conditions(df, exit_conds, idx)
                    if exit_hit:
                        pending_exit = True

    # Build equity_curve (same list-of-dicts shape as the original) with a
    # single vectorized rounding pass instead of calling round() once per
    # candle inside the hot loop (measured: this was the single biggest
    # remaining cost after the numpy-array optimizations above).
    equity_rounded = np.round(np.array(equity_raw, dtype=np.float64), 2)
    equity_curve = [
        {"date": d, "equity": float(e)}
        for d, e in zip(equity_dates, equity_rounded)
    ]

    # Liquidate open position on the last candle
    if position:
        buy_fee    = position["allocated"] * fee_taker
        last_price = float(close_arr[-1])
        last_date  = str(date_arr[-1])
        sell_fee   = position["qty"] * last_price * fee_taker
        proceeds   = position["qty"] * last_price - sell_fee
        net_entry  = position["allocated"] + buy_fee
        pct_change = (proceeds - net_entry) / net_entry
        trades.append({
            "side": "buy",
            "date": position["entry_date"],
            "price": round(position["entry_price"], 4),
            "quantity": round(position["qty"], 6),
            "value": round(position["allocated"], 2),
            "pnl": None
        })
        trades.append({
            "side": "sell",
            "date": last_date,
            "price": round(last_price, 4),
            "quantity": round(position["qty"], 6),
            "value": round(proceeds, 2),
            "pnl": round(pct_change * 100, 2),
            "entryDate": position["entry_date"],
            "entryPrice": round(position["entry_price"], 4),
            "allocated": round(position["allocated"], 2),
            "reason": "end"
        })
        capital += proceeds
    
    equity_rounded = np.round(np.array(equity_raw, dtype=np.float64), 2)

    result = build_result(
        trades          = trades,
        equity_dates    = equity_dates,
        equity_raw      = equity_rounded,
        ts_arr          = ts_arr,
        close_arr       = close_arr,
        initial_capital = initial_capital,
        final_capital   = capital,
        start_date      = start_date,
        end_date        = end_date,
        tf_minutes      = tf_minutes,
    )
    
    return result