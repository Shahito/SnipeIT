"""
indicators.py - Technical indicators library

Each indicator is an independent function that receives an OHLCV DataFrame
and returns a pandas Series.

To add an indicator:
  1. Write the function compute_<name>(df, **kwargs) -> pd.Series
  2. Register it in REGISTRY with its default parameters
  3. That's it - the backtest engine resolves it automatically

Naming convention in the final DataFrame:
  RSI_14, EMA_20, SMA_50, MACD, BB_UPPER_20, PRICE, VOLUME, ...
"""

import numpy as np
import pandas as pd

# Maps source names to the series they pull from a DataFrame.
# Add entries here to make a new source available to EMA/SMA (and any future indicator with "sources").
SOURCE_SERIES: dict[str, callable] = {
    "PRICE":  lambda df: df["close"],
    "VOLUME": lambda df: df["volume"],
    "HIGH":   lambda df: df["high"],
    "LOW":    lambda df: df["low"],
    "OPEN":   lambda df: df["open"],
}

# Compute functions

def compute_rsi(df: pd.DataFrame, period: int = 14) -> pd.Series:
    delta = df["close"].diff()
    gain  = delta.clip(lower=0).ewm(alpha=1 / period, adjust=False).mean()
    loss  = (-delta.clip(upper=0)).ewm(alpha=1 / period, adjust=False).mean()
    rs    = gain / loss.replace(0, np.nan)

    rsi   = 100 - (100 / (1 + rs))
    rsi   = rsi.mask((loss == 0) & (gain > 0), 100.0) # full pos
    rsi   = rsi.mask((loss == 0) & (gain == 0), 50.0) # full flat
    return rsi.rename(f"RSI_{period}")

def compute_ema(df: pd.DataFrame, period: int = 20, series: pd.Series | None = None) -> pd.Series:
    src  = series if series is not None else df["close"]
    name = f"EMA_{series.name}_{period}" if series is not None else f"EMA_{period}"
    return src.ewm(span=period, adjust=False).mean().rename(name)

def compute_sma(df: pd.DataFrame, period: int = 20, series: pd.Series | None = None) -> pd.Series:
    src  = series if series is not None else df["close"]
    name = f"SMA_{series.name}_{period}" if series is not None else f"SMA_{period}"
    return src.rolling(period).mean().rename(name)

def compute_macd(df: pd.DataFrame, fast: int = 12, slow: int = 26, signal: int = 9) -> pd.DataFrame:
    ema_fast   = df["close"].ewm(span=fast,   adjust=False).mean()
    ema_slow   = df["close"].ewm(span=slow,   adjust=False).mean()
    macd_line  = ema_fast - ema_slow
    signal_line = macd_line.ewm(span=signal,  adjust=False).mean()
    histogram  = macd_line - signal_line
    return pd.DataFrame({
        f"MACD_{fast}_{slow}_{signal}":           macd_line,
        f"MACD_signal_{fast}_{slow}_{signal}":    signal_line,
        f"MACD_histogram_{fast}_{slow}_{signal}": histogram,
    })


def compute_bollinger(df: pd.DataFrame, period: int = 20, std_dev: float = 2.0) -> pd.DataFrame:
    mid   = df["close"].rolling(period).mean()
    std   = df["close"].rolling(period).std()
    upper = mid + std_dev * std
    lower = mid - std_dev * std
    return pd.DataFrame({
        f"BB_MID_{period}":   mid,
        f"BB_UPPER_{period}": upper,
        f"BB_LOWER_{period}": lower,
    })


def compute_atr(df: pd.DataFrame, period: int = 14) -> pd.Series:
    high, low, close = df["high"], df["low"], df["close"].shift(1)
    tr = pd.concat([high - low, (high - close).abs(), (low - close).abs()], axis=1).max(axis=1)
    return tr.ewm(alpha=1 / period, adjust=False).mean().rename(f"ATR_{period}")


def compute_stoch_rsi(df: pd.DataFrame, period: int = 14, smooth_k: int = 3, smooth_d: int = 3) -> pd.DataFrame:
    rsi    = compute_rsi(df, period)
    min_r  = rsi.rolling(period).min()
    max_r  = rsi.rolling(period).max()
    stoch  = (rsi - min_r) / (max_r - min_r).replace(0, np.nan) * 100
    k      = stoch.rolling(smooth_k).mean()
    d      = k.rolling(smooth_d).mean()
    return pd.DataFrame({f"STOCH_RSI_K_{period}": k, f"STOCH_RSI_D_{period}": d})


def compute_vwap(df: pd.DataFrame) -> pd.Series:
    tp = (df["high"] + df["low"] + df["close"]) / 3
    return (tp * df["volume"]).cumsum() / df["volume"].cumsum().rename("VWAP")


def compute_price(df: pd.DataFrame) -> pd.Series:
    return df["close"].rename("PRICE")


def compute_volume(df: pd.DataFrame) -> pd.Series:
    return df["volume"].rename("VOLUME")


def compute_high(df: pd.DataFrame) -> pd.Series:
    return df["high"].rename("HIGH")


def compute_low(df: pd.DataFrame) -> pd.Series:
    return df["low"].rename("LOW")


def compute_open(df: pd.DataFrame) -> pd.Series:
    return df["open"].rename("OPEN")


# Indicator registry
# Key: name used in conditions (UI side)
# Value: dict with the function + default parameters + pre-computed common periods

REGISTRY: dict[str, dict] = {
    "RSI": {
        "fn":      compute_rsi,
        "periods": [7, 9, 14, 21],
        "params":  {"period": 14},
        "col_tpl": "RSI_{period}",
    },
    "EMA": {
        "fn":          compute_ema,
        "periods":     [5, 9, 10, 12, 20, 21, 26, 50, 100, 200],
        "params":      {"period": 20},
        "col_tpl":     "EMA_{period}",
        "col_tpl_src": "EMA_{source}_{period}",
        "sources":     ["VOLUME", "HIGH", "LOW", "OPEN"],
    },
    "SMA": {
        "fn":          compute_sma,
        "periods":     [5, 10, 20, 50, 100, 200],
        "params":      {"period": 20},
        "col_tpl":     "SMA_{period}",
        "col_tpl_src": "SMA_{source}_{period}",
        "sources":     ["VOLUME", "HIGH", "LOW", "OPEN"],
    },
    "MACD": {
        "fn":           compute_macd,
        "periods":      [],               # no variable period, fixed columns
        "params":       {},
        "extra_params": {"fast": 12, "slow": 26, "signal": 9},
        "col_tpl":      "MACD_{fast}_{slow}_{signal}",
    },
    "MACD_SIGNAL": {
        "fn":           compute_macd,
        "periods":      [],
        "params":       {},
        "extra_params": {"fast": 12, "slow": 26, "signal": 9},
        "col_tpl":      "MACD_signal_{fast}_{slow}_{signal}",
    },
    "MACD_HIST": {
        "fn":           compute_macd,
        "periods":      [],
        "params":       {},
        "extra_params": {"fast": 12, "slow": 26, "signal": 9},
        "col_tpl":      "MACD_histogram_{fast}_{slow}_{signal}",
    },
    "BB_UPPER": {
        "fn":      compute_bollinger,
        "periods": [20],
        "params":  {"period": 20},
        "col_tpl": "BB_UPPER_{period}",
    },
    "BB_LOWER": {
        "fn":      compute_bollinger,
        "periods": [20],
        "params":  {"period": 20},
        "col_tpl": "BB_LOWER_{period}",
    },
    "BB_MID": {
        "fn":      compute_bollinger,
        "periods": [20],
        "params":  {"period": 20},
        "col_tpl": "BB_MID_{period}",
    },
    "ATR": {
        "fn":      compute_atr,
        "periods": [7, 14, 21],
        "params":  {"period": 14},
        "col_tpl": "ATR_{period}",
    },
    "STOCH_RSI_K": {
        "fn":      compute_stoch_rsi,
        "periods": [14],
        "params":  {"period": 14},
        "col_tpl": "STOCH_RSI_K_{period}",
    },
    "STOCH_RSI_D": {
        "fn":      compute_stoch_rsi,
        "periods": [14],
        "params":  {"period": 14},
        "col_tpl": "STOCH_RSI_D_{period}",
    },
    "VWAP": {
        "fn":      compute_vwap,
        "periods": [],
        "params":  {},
        "col_tpl": "VWAP",
    },
    "PRICE": {
        "fn":      compute_price,
        "periods": [],
        "params":  {},
        "col_tpl": "PRICE",
    },
    "VOLUME": {
        "fn":      compute_volume,
        "periods": [],
        "params":  {},
        "col_tpl": "VOLUME",
    },
    "HIGH": {
        "fn":      compute_high,
        "periods": [],
        "params":  {},
        "col_tpl": "HIGH",
    },
    "LOW": {
        "fn":      compute_low,
        "periods": [],
        "params":  {},
        "col_tpl": "LOW",
    },
    "OPEN": {
        "fn":      compute_open,
        "periods": [],
        "params":  {},
        "col_tpl": "OPEN",
    },
}

# Indicators whose computation returns a DataFrame (multiple columns)
MULTI_COL = {"MACD", "MACD_SIGNAL", "MACD_HIST", "BB_UPPER", "BB_LOWER", "BB_MID", "STOCH_RSI_K", "STOCH_RSI_D"}
# Shared indicators (compute once = feeds multiple names)
SHARED_CALC = {
    "MACD_SIGNAL": "MACD",
    "MACD_HIST":   "MACD",
    "BB_UPPER": "BB",
    "BB_LOWER": "BB",
    "BB_MID":   "BB",
    "STOCH_RSI_K": "STOCH_RSI",
    "STOCH_RSI_D": "STOCH_RSI",
}

def compute_all(df: pd.DataFrame, needed: list[tuple]) -> pd.DataFrame:
    """
    Computes only the indicators required for the given conditions.

    needed: list of (indicator_name, period_or_None, source_or_None, ...)
    Trailing elements (timeframe, settings) are tolerated but ignored here -
    timeframe is handled by the caller (see backtest.py), and settings
    (a sorted (k,v) tuple, see extract_needed) is read if present.
    Ex: [('RSI', 14, None), ('EMA', 20, None), ('EMA', 20, 'VOLUME'), ('MACD', None, None)]
    """
    df = df.copy()
    already_computed: set[str] = set()

    for item in needed:
        indicator = item[0]
        period    = item[1]
        source    = item[2] if len(item) > 2 else None
        settings  = dict(item[4]) if len(item) > 4 and item[4] else None

        meta = REGISTRY.get(indicator)
        if not meta:
            continue

        p = period or meta["params"].get("period", 14)
        col = column_name(indicator, period, source, settings)
        if col is None:
            continue

        if col in df.columns:
            continue

        shared_key = SHARED_CALC.get(indicator)
        calc_key   = f"{shared_key or indicator}_{source or ''}_{p}_{item[4] or ''}"
        if calc_key in already_computed:
            continue
        already_computed.add(calc_key)

        fn     = meta["fn"]
        kwargs = {k: v for k, v in meta["params"].items()}
        if "period" in kwargs:
            kwargs["period"] = p
        if "extra_params" in meta:
            kwargs.update({**meta["extra_params"], **(settings or {})})

        if source and "sources" in meta:
            src_fn = SOURCE_SERIES.get(source)
            if src_fn:
                kwargs["series"] = src_fn(df).rename(source)

        result = fn(df, **kwargs)

        if isinstance(result, pd.DataFrame):
            for c in result.columns:
                if c not in df.columns:
                    df[c] = result[c]
        else:
            df[col] = result

    return df
def column_name(indicator: str, period: int | None, source: str | None = None, settings: dict | None = None) -> str | None:
    """
    Returns the DataFrame column name for a given (indicator, period, source,
    settings), or None if the indicator is unknown. Single source of truth
    for column naming - shared by resolve_value() and by any code that
    aligns indicator columns computed on a different timeframe (see
    backtest.py's HTF support).
    `settings` overrides an indicator's extra params (e.g. MACD's
    fast/slow/signal) on top of REGISTRY's defaults - only relevant for
    indicators that declare "extra_params".
    """
    meta = REGISTRY.get(indicator)
    if not meta:
        return None
    p = period or meta["params"].get("period", 14)
    if source and "col_tpl_src" in meta:
        return meta["col_tpl_src"].format(source=source, period=p)
    if "extra_params" in meta:
        merged = {**meta["extra_params"], **(settings or {})}
        return meta["col_tpl"].format(period=p, **merged)
    return meta["col_tpl"].format(period=p)


def resolve_value(df: pd.DataFrame, indicator: str, period: int | None, idx: int,
                   source: str | None = None, timeframe: str | None = None,
                   settings: dict | None = None) -> float | None:
    """
    Returns the value of an indicator for the candle at index idx.
    If `timeframe` is set, looks up the HTF/LTF-aligned column instead of the
    base-timeframe one (see backtest.py's _compute_htf_columns, which is
    responsible for actually populating that column without look-ahead).
    """
    col = column_name(indicator, period, source, settings)
    if col is None:
        return None
    if timeframe:
        col = f"{col}@{timeframe}"
    if col not in df.columns or idx < 0 or idx >= len(df):
        return None
    val = df[col].iloc[idx]
    if val is None or (isinstance(val, float) and np.isnan(val)):
        return None
    return float(val)

def extract_needed(conditions: dict) -> list[tuple]:
    """
    Extracts the (indicator, period, source, timeframe, settings) list from
    the strategy's conditions dict. `settings` is a sorted tuple of
    (key, value) pairs (hashable, for the dedup set below) carrying an
    indicator's extra params beyond period/source - e.g. MACD's
    fast/slow/signal. Use dict(settings) to get a normal dict back.
    Supports flat format [rule, ...] and grouped format [[rule, ...], [rule, ...]].
    """
    needed = set()

    def _settings_tuple(cond: dict, key: str):
        s = cond.get(key)
        return tuple(sorted(s.items())) if s else None

    def _extract_rule(cond: dict):
        needed.add((cond["indicator"], cond.get("period"), cond.get("source"), cond.get("timeframe"),
                    _settings_tuple(cond, "settings")))
        if cond.get("combineIndicator"):
            # combine* sub-refs share their parent ref's timeframe (no separate key)
            needed.add((cond["combineIndicator"], cond.get("combinePeriod"), cond.get("combineSource"), cond.get("timeframe"),
                        _settings_tuple(cond, "combineSettings")))
        if cond.get("valueIndicator"):
            needed.add((cond["valueIndicator"], cond.get("valueIndicatorPeriod"), cond.get("valueIndicatorSource"), cond.get("valueIndicatorTimeframe"),
                        _settings_tuple(cond, "valueIndicatorSettings")))
            if cond.get("valueCombineIndicator"):
                needed.add((cond["valueCombineIndicator"], cond.get("valueCombinePeriod"), cond.get("valueCombineSource"), cond.get("valueIndicatorTimeframe"),
                            _settings_tuple(cond, "valueCombineSettings")))

    for section in (conditions.get("entry", []), conditions.get("exit", [])):
        for item in section:
            if isinstance(item, list):
                for cond in item:
                    _extract_rule(cond)
            else:
                _extract_rule(item)

    return list(needed)