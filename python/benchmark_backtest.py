"""
benchmark_backtest.py — Mesure le coût CPU et mémoire d'un backtest réel
(votre code, données synthétiques) pour estimer la charge serveur avant
de centraliser le bot sur un VPS partagé entre plusieurs utilisateurs.

Pourquoi des données synthétiques plutôt que réelles : on veut isoler le
coût CPU/mémoire du calcul lui-même (la partie qui compterait pour de
vrai sur un serveur partagé), sans le bruit du réseau/disque qui dépend
de l'état du cache et qui n'a plus le même poids une fois le cache
mutualisé entre utilisateurs.

Usage :
    python3 benchmark_backtest.py

Placez ce fichier à côté de backtest.py, indicators.py, ohlcv_cache.py.

Lecture des résultats :
  - Wall (s)  : temps horloge murale total du backtest
  - CPU (s)   : temps CPU réellement consommé (user+sys) — c'est CE
                CHIFFRE qu'il faut multiplier par le nombre de backtests
                concurrents visés, puis comparer au nombre de coeurs du VPS
  - Mem (MB)  : pic mémoire Python tracé pendant l'appel (hors overhead de
                base de l'interpréteur, ~25-40MB par process en plus)

Pour estimer la charge serveur :
  N coeurs disponibles / CPU(s) moyen par backtest ≈ débit de backtests
  simultanés soutenable en continu sur ce VPS (à la louche, sans tenir
  compte de l'OS, du Node API, etc. qui tournent aussi dessus).
"""

import gc
import os
import resource
import sys
import time
import tracemalloc
from unittest.mock import patch

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import backtest as bt


def make_synthetic_ohlcv(n_candles: int, freq: str) -> pd.DataFrame:
    rng = np.random.default_rng(42)
    closes = 100 + np.cumsum(rng.normal(0, 0.5, n_candles))
    closes = np.maximum(closes, 1.0)
    return pd.DataFrame({
        "timestamp": pd.date_range("2020-01-01", periods=n_candles, freq=freq),
        "open":   closes,
        "high":   closes * 1.001,
        "low":    closes * 0.999,
        "close":  closes,
        "volume": rng.uniform(10, 1000, n_candles),
    })


STRATEGIES = {
    "1 indicateur (RSI)": {
        "entry": [{"indicator": "RSI", "period": 14, "operator": "<", "value": 30}],
        "exit":  [{"indicator": "RSI", "period": 14, "operator": ">", "value": 70}],
    },
    "5 indicateurs (RSI+EMA+SMA+MACD+BB)": {
        "entry": [[
            {"indicator": "RSI", "period": 14, "operator": "<", "value": 30,
             "valueIndicator": None},
            {"indicator": "EMA", "period": 20, "operator": ">",
             "valueIndicator": "SMA", "valueIndicatorPeriod": 50},
        ], [
            {"indicator": "MACD", "operator": ">", "value": 0,
             "valueIndicator": "MACD_SIGNAL"},
        ]],
        "exit": [{"indicator": "BB_UPPER", "period": 20, "operator": "<", "value": -999999}],
    },
}

# (label, nombre de bougies, fréquence pandas)
SCENARIOS = [
    ("1 an en 1d",     365,           "1D"),
    ("1 an en 1h",     365 * 24,      "1h"),
    ("3 mois en 15m",  90 * 24 * 4,   "15min"),
    ("1 mois en 1m",   30 * 24 * 60,  "1min"),
]


def make_strategy(conditions: dict) -> dict:
    return {
        "pair": "BTC/USDT", "timeframe": "1h",
        "startDate": "2020-01-01", "endDate": "2030-01-01",
        "initialCapital": 1000, "positionSize": 0.1,
        "stopLoss": 2, "takeProfit": 4, "trailingStopLoss": None,
        "feeTaker": 0.1, "feeMaker": 0.1, "tradingHours": [],
        "exchange": "binance", "conditions": conditions,
    }


def run_one(df: pd.DataFrame, strategy: dict) -> dict:
    gc.collect()
    tracemalloc.start()
    cpu_before = resource.getrusage(resource.RUSAGE_SELF)
    wall_before = time.perf_counter()

    with patch("ohlcv_cache.get_ohlcv", return_value=df):
        bt.run_backtest(strategy)

    wall_after = time.perf_counter()
    cpu_after = resource.getrusage(resource.RUSAGE_SELF)
    _, peak_mem = tracemalloc.get_traced_memory()
    tracemalloc.stop()

    cpu_s = (cpu_after.ru_utime - cpu_before.ru_utime) + (cpu_after.ru_stime - cpu_before.ru_stime)
    return {
        "wall_s": wall_after - wall_before,
        "cpu_s": cpu_s,
        "peak_mem_mb": peak_mem / 1e6,
    }


def main():
    header = f"{'Scénario':<16} {'Stratégie':<38} {'Bougies':>9} {'Wall (s)':>9} {'CPU (s)':>9} {'Mem (MB)':>9}"
    print(header)
    print("-" * len(header))
    for scenario_label, n_candles, freq in SCENARIOS:
        df = make_synthetic_ohlcv(n_candles, freq)
        for strat_label, conditions in STRATEGIES.items():
            strategy = make_strategy(conditions)
            metrics = run_one(df, strategy)
            print(
                f"{scenario_label:<16} {strat_label:<38} {n_candles:>9} "
                f"{metrics['wall_s']:>9.3f} {metrics['cpu_s']:>9.3f} {metrics['peak_mem_mb']:>9.1f}"
            )

    print()
    print("Note : le pic mémoire affiché ne couvre que ce que tracemalloc")
    print("intercepte (objets Python/numpy/pandas) ; comptez ~25-40MB de plus")
    print("par process pour l'interpréteur Python lui-même.")


if __name__ == "__main__":
    main()
