"""
parity_export.py - computes indicators.py's indicators on the shared fixture
test/fixtures/candles.json and prints the result as JSON to stdout.

Used only by test/indicatorParity.test.js (JS/Python comparison).
NaN -> null to stay valid JSON.
"""
import json
import math
import os
import sys

import pandas as pd

sys.path.insert(0, os.path.dirname(__file__))
import indicators as ind

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FIXTURE = os.path.join(ROOT, "test", "fixtures", "candles.json")

# Same defaults as used in prod on the JS side
# (see src/utils/indicatorMath.js callers in indicatorController.js)
CASES = [
    ("RSI",         {"period": 14}),
    ("EMA",         {"period": 20}),
    ("EMA",         {"period": 20, "series": "VOLUME"}),
    ("SMA",         {"period": 20}),
    ("SMA",         {"period": 20, "series": "VOLUME"}),
    ("MACD",        {}),
    ("BB",          {"period": 20, "std_dev": 2.0}),
    ("ATR",         {"period": 14}),
    ("STOCH_RSI",   {"period": 14, "smooth_k": 3, "smooth_d": 3}),
    ("VWAP",        {}),
]

FN = {
    "RSI": ind.compute_rsi,
    "EMA": ind.compute_ema,
    "SMA": ind.compute_sma,
    "MACD": ind.compute_macd,
    "BB": ind.compute_bollinger,
    "ATR": ind.compute_atr,
    "STOCH_RSI": ind.compute_stoch_rsi,
    "VWAP": ind.compute_vwap,
}


def clean(series: pd.Series):
    return [None if (v is None or (isinstance(v, float) and math.isnan(v))) else float(v) for v in series]


def main():
    with open(FIXTURE) as f:
        candles = json.load(f)
    df = pd.DataFrame(candles)

    out = {}
    for name, kwargs in CASES:
        fn = FN[name]
        call_kwargs = dict(kwargs)
        if call_kwargs.get("series") == "VOLUME":
            call_kwargs["series"] = df["volume"].rename("VOLUME")
        result = fn(df, **call_kwargs)
        if isinstance(result, pd.DataFrame):
            for col in result.columns:
                out[col] = clean(result[col])
        else:
            out[result.name] = clean(result)

    print(json.dumps(out))


if __name__ == "__main__":
    main()