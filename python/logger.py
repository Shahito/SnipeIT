"""
logger.py - Styled logging console for SnipeIT Worker

Uses `rich` for colorful and readable logs.

Usage:
    from logger import get_logger, log_job_result, log_job_error, print_banner

    log = get_logger("snipeit")
    log.info("Server connected")
    log.warning("Cache missing")
    log.error("Connection failed")

    print_banner()
    log_job_result(job_id=42, result={...})
    log_job_error(job_id=42, error="...")
"""

import logging
import os
from contextlib import contextmanager
from datetime import datetime
from typing import Any

try:
    from rich.console import Console
    from rich.logging import RichHandler
    from rich.theme import Theme
    from rich.markup import escape
    from rich.live import Live
    from rich.text import Text
except ImportError:
    raise ImportError("rich not installed - pip install rich")


# Theme & Console

_THEME = Theme({
    "muted":      "dim white",
    "accent":     "bold cyan",
    "profit":     "bold green",
    "loss":       "bold red",
    "warning":    "bold yellow",
    "pair":       "magenta",
    "timeframe":  "yellow",
    "cache_hit":  "green",
    "cache_miss": "yellow",
    "cache_part": "cyan",
})

console = Console(theme=_THEME, highlight=False)

# Shared internal logger - cache functions use it to stay aligned
_log: logging.Logger | None = None


# Rich handler for the standard logging module

def get_logger(name: str) -> logging.Logger:
    global _log
    logger = logging.getLogger(name)
    if logger.handlers:
        _log = logger
        return logger

    dev_mode = os.getenv("ENV", "production").lower() in ("dev", "development")

    handler = RichHandler(
        console=console,
        show_time=True,
        show_level=True,
        show_path=False,
        rich_tracebacks=True,
        tracebacks_show_locals=dev_mode,
        log_time_format="[%H:%M:%S]",
        markup=True,
    )
    handler.setFormatter(logging.Formatter("%(message)s", datefmt="[%H:%M:%S]"))
    logger.addHandler(handler)
    logger.setLevel(logging.DEBUG if dev_mode else logging.INFO)
    logger.propagate = False
    _log = logger
    return logger


# Startup banner

def print_banner(base_url: str = "", poll: int = 10, heartbeat: int = 20, cache_dir: str = "./cache") -> None:
    now = datetime.now().strftime("%d/%m/%Y %H:%M:%S")
    console.print(
        f"[accent]🎯 SnipeIT Worker[/accent]  "
        f"[muted]{escape(base_url)}  poll={poll}s  hb={heartbeat}s  cache={escape(cache_dir)}  {now}  (Q to quit)[/muted]"
    )


# Spinner during backtest

@contextmanager
def backtest_spinner(job_id: int, name: str, pair: str, tf: str):
    """
    Context manager: displays a spinner during the backtest,
    then cleanly replaces it on exit.

    Usage:
        with backtest_spinner(job_id, name, pair, tf):
            result = run_backtest(strategy)
    """
    label = Text.assemble(
        ("⏳ ", ""),
        (f"#{job_id} ", "muted"),
        (f"{name}  ", "white"),
        (escape(pair), "pair"),
        (" ", ""),
        (tf, "timeframe"),
        ("  running...", "muted"),
    )
    with Live(label, console=console, refresh_per_second=8, transient=True):
        yield


# Job result / error

def _pnl_style(v: float) -> str:
    return "bold green" if v > 0 else ("bold red" if v < 0 else "white")

def log_job_result(job_id: int, result: dict[str, Any]) -> None:
    pnl    = result.get("pnlPercent", 0.0)
    sharpe = result.get("sharpeRatio", 0.0)
    trades = result.get("totalTrades", 0)
    wr     = result.get("winRate", 0.0)
    ps     = _pnl_style(pnl)
    sign   = "+" if pnl > 0 else ""
    now    = datetime.now().strftime("%H:%M:%S")
    console.print(Text.assemble(
        (f"[{now}] ", "dim white"),
        ("INFO     ", "dim cyan"),
        (f"#{job_id} ", "dim white"),
        (f"{sign}{pnl:.2f}%", ps),
        ("  sharpe ",         "dim white"),
        (f"{sharpe:.2f}",     "white"),
        ("  trades ",         "dim white"),
        (str(trades),         "white"),
        ("  wr ",             "dim white"),
        (f"{wr:.1f}%",        "white"),
    ))

def log_job_error(job_id: int, error: str) -> None:
    if _log:
        now = datetime.now().strftime("%H:%M:%S")
        console.print(Text.assemble(
            (f"[{now}] ", "dim white"),
            ("ERROR    ", "bold red"),
            (f"✖ #{job_id} ", "bold red"),
            (f"{escape(str(error))}", "dim white"),
        ))


# Cache statuses

def log_cache_hit(pair: str, tf: str, start: str, end: str, n: int) -> None:
    if _log:
        _log.info(f"[cache_hit]HIT[/cache_hit] [pair]{escape(pair)}[/pair] [timeframe]{tf}[/timeframe] [muted]{start}→{end} {n} candles[/muted]")

def log_cache_miss(pair: str, tf: str, start: str, end: str) -> None:
    if _log:
        _log.info(f"[cache_miss]DL[/cache_miss]  [pair]{escape(pair)}[/pair] [timeframe]{tf}[/timeframe] [muted]{start}→{end}[/muted]")

def log_cache_partial(pair: str, tf: str) -> None:
    if _log:
        _log.info(f"[cache_part]DELTA[/cache_part] [pair]{escape(pair)}[/pair] [timeframe]{tf}[/timeframe]")


# Polling status

def log_poll_empty() -> None:
    pass  # silence

def log_poll_jobs(n: int) -> None:
    now = datetime.now().strftime("%H:%M:%S")
    console.print(Text.assemble(
        (f"[{now}] ", "dim white"),
        ("INFO     ", "dim cyan"),
        (f"→ {n} job(s)", "bold cyan"),
    ))

def log_server_unreachable(retry: int) -> None:
    if _log:
        _log.warning(f"Server unreachable - retrying in {retry}s")

def log_heartbeat() -> None:
    pass  # silence

def log_stopped() -> None:
    console.print("[bold red]👋 SnipeIT worker stopped by user.[/bold red]")