"""
ohlcv_cache.py - Disk cache for OHLCV data

Stores downloaded candles in ./cache/<exchange>/<pair>/<timeframe>/<year>.parquet
Hierarchical structure to allow partial updates.

If the requested range is already fully cached, no network request is made.
If part of the data is missing (e.g. new candles), only the delta is downloaded.
"""

import os
import json
import time
import logging
from pathlib import Path
from datetime import datetime, timedelta, timezone

import pandas as pd

from logger import log_cache_hit, log_cache_miss, log_cache_partial

log = logging.getLogger("snipeit.cache")

CACHE_DIR = Path(os.getenv("OHLCV_CACHE_DIR", "./cache"))
SENTINEL = "fetch_start.txt"
CONFIRMED_GAPS_FILE = "confirmed_gaps.json"
CONFIRMED_END_FILE = "confirmed_end.txt"
# How long a confirmed-empty gap is trusted before being re-checked
# Adjustable via .env.
CONFIRMED_GAP_TTL_DAYS = int(os.getenv("OHLCV_CONFIRMED_GAP_TTL_DAYS", "7"))

# Kept in sync with backtest.py's _TF_MINUTES. Duplicated on purpose: this module
# is a standalone low-level cache layer and should not import the heavier backtest
# module just for a one-line lookup.
_TF_MINUTES = {
    "1m": 1, "3m": 3, "5m": 5, "15m": 15, "30m": 30,
    "1h": 60, "2h": 120, "4h": 240, "6h": 360, "8h": 480, "12h": 720,
    "1d": 1440, "3d": 4320, "1w": 10080,
}

def _timeframe_to_minutes(tf: str) -> int:
    return _TF_MINUTES.get(tf, 60)  # default to 1h if unknown


def _save_fetch_start(cache_dir: Path, start: datetime) -> None:
    (cache_dir / SENTINEL).write_text(start.isoformat())

def _load_fetch_start(cache_dir: Path) -> datetime | None:
    p = cache_dir / SENTINEL
    return datetime.fromisoformat(p.read_text()) if p.exists() else None


def _save_confirmed_end(cache_dir: Path, end: datetime) -> None:
    (cache_dir / CONFIRMED_END_FILE).write_text(end.isoformat())

def _load_confirmed_end(cache_dir: Path) -> datetime | None:
    p = cache_dir / CONFIRMED_END_FILE
    return datetime.fromisoformat(p.read_text()) if p.exists() else None

def _load_confirmed_gaps(cache_dir: Path) -> list[tuple[datetime, datetime, datetime | None]]:
    p = cache_dir / CONFIRMED_GAPS_FILE
    if not p.exists():
        return []
    raw = json.loads(p.read_text())

    gaps = []
    for entry in raw:
        if isinstance(entry, dict):
            gap_start = datetime.fromisoformat(entry["gap_start"])
            gap_end = datetime.fromisoformat(entry["gap_end"])
            detected_at_raw = entry.get("detected_at")
            # None (not a sentinel date) means "never verified" - _is_confirmed_gap
            # treats that as expired. Nothing gets written to disk for this case;
            # see _save_confirmed_gap.
            detected_at = datetime.fromisoformat(detected_at_raw) if detected_at_raw else None
        else:
            # Legacy format: plain [gap_start, gap_end] pair, no detected_at.
            gap_start, gap_end = entry
            gap_start = datetime.fromisoformat(gap_start)
            gap_end = datetime.fromisoformat(gap_end)
            detected_at = None
        gaps.append((gap_start, gap_end, detected_at))
    return gaps

def _save_confirmed_gap(cache_dir: Path, gap_start: datetime, gap_end: datetime) -> None:
    p = cache_dir / CONFIRMED_GAPS_FILE
    raw = json.loads(p.read_text()) if p.exists() else []

    def _entry_dates(entry):
        if isinstance(entry, dict):
            return datetime.fromisoformat(entry["gap_start"]), datetime.fromisoformat(entry["gap_end"])
        a, b = entry
        return datetime.fromisoformat(a), datetime.fromisoformat(b)

    # Only the entry for this exact gap is touched. Every other entry -
    # including legacy ones still missing detected_at - is left completely
    # untouched: we never stamp a placeholder date onto a gap we haven't
    # actually just re-verified.
    raw = [e for e in raw if _entry_dates(e) != (gap_start, gap_end)]
    raw.append({
        "gap_start": gap_start.isoformat(),
        "gap_end": gap_end.isoformat(),
        "detected_at": datetime.utcnow().isoformat(),
    })
    p.write_text(json.dumps(raw))

def _remove_confirmed_gap(cache_dir: Path, gap_start: datetime, gap_end: datetime) -> None:
    """Drops a stale confirmed-gap entry once the exchange has backfilled it.
    No-op if the file doesn't exist or has no matching entry (e.g. this gap
    was never confirmed empty to begin with, it just showed up as expired)."""
    p = cache_dir / CONFIRMED_GAPS_FILE
    if not p.exists():
        return
    raw = json.loads(p.read_text())

    def _entry_dates(entry):
        if isinstance(entry, dict):
            return datetime.fromisoformat(entry["gap_start"]), datetime.fromisoformat(entry["gap_end"])
        a, b = entry
        return datetime.fromisoformat(a), datetime.fromisoformat(b)

    filtered = [e for e in raw if _entry_dates(e) != (gap_start, gap_end)]
    if len(filtered) != len(raw):
        p.write_text(json.dumps(filtered))

def _is_confirmed_gap(gap_start, gap_end, confirmed) -> bool:
    now = datetime.utcnow()
    ttl = timedelta(days=CONFIRMED_GAP_TTL_DAYS)
    return any(
        cs <= gap_start and gap_end <= ce
        and detected_at is not None
        and (now - detected_at) <= ttl
        for cs, ce, detected_at in confirmed
    )

def _cache_path(exchange: str, pair: str, timeframe: str) -> Path:
    safe_pair = pair.replace("/", "_")
    return CACHE_DIR / exchange / safe_pair / timeframe


def _load_from_disk(cache_dir: Path, start: datetime, end: datetime) -> pd.DataFrame | None:
    """Loads parquet files covering the [start, end] range."""
    if not cache_dir.exists():
        return None

    frames = []
    for f in sorted(cache_dir.glob("*.parquet")):
        try:
            df = pd.read_parquet(f)
            df["timestamp"] = pd.to_datetime(df["timestamp"]).dt.tz_localize(None)
            frames.append(df)
        except Exception as e:
            log.warning(f"Corrupted cache file, skipped: {f} ({e})")

    if not frames:
        return None

    combined = pd.concat(frames).drop_duplicates(subset=["timestamp"]).sort_values("timestamp")
    combined = combined[
        (combined["timestamp"] >= pd.Timestamp(start)) &
        (combined["timestamp"] <= pd.Timestamp(end))
    ]
    return combined if not combined.empty else None


def _save_to_disk(cache_dir: Path, df: pd.DataFrame) -> None:
    """Saves by year for compact files that are easy to invalidate."""
    cache_dir.mkdir(parents=True, exist_ok=True)
    for year, group in df.groupby(df["timestamp"].dt.year):
        path = cache_dir / f"{year}.parquet"
        # If the file exists, merge to avoid losing already-present data
        if path.exists():
            try:
                existing = pd.read_parquet(path)
                existing["timestamp"] = pd.to_datetime(existing["timestamp"]).dt.tz_localize(None)
                group = pd.concat([existing, group]).drop_duplicates(subset=["timestamp"]).sort_values("timestamp")
            except Exception:
                pass
        group.to_parquet(path, index=False)
    log.debug(f"Cache saved: {cache_dir} ({len(df)} candles)")


def _find_gaps(df: pd.DataFrame, step: pd.Timedelta) -> list[tuple[datetime, datetime]]:
    """
    Scans a sorted, deduplicated OHLCV frame for missing candles.
    Returns a list of (gap_start, gap_end) windows to re-fetch from the exchange.
    A 1.5x tolerance absorbs normal jitter without masking real holes
    (a single missing candle already triggers a re-fetch).
    Note: gap_start and gap_end are the two candles that ARE already in
    the cache, bordering the hole. They are not missing themselves.
    """
    ts = df["timestamp"].reset_index(drop=True)
    diffs = ts.diff()
    holes = diffs[diffs > step * 1.5].index
    return [(ts[i - 1].to_pydatetime(), ts[i].to_pydatetime()) for i in holes]


def _fetch_from_exchange(exchange_id: str, pair: str, timeframe: str,
                          start: datetime, end: datetime) -> pd.DataFrame:
    try:
        import ccxt
    except ImportError:
        raise RuntimeError("ccxt not installed - pip install ccxt")

    exchange_cls = getattr(ccxt, exchange_id, None)
    if not exchange_cls:
        raise ValueError(f"Unknown exchange: {exchange_id}")

    exchange = exchange_cls({"enableRateLimit": True})

    def _log_http_status(response, *args, **kwargs):
        log.debug(f"Binance {response.request.method} {response.url} -> {response.status_code}")
        return response

    exchange.session.hooks["response"].append(_log_http_status)

    step_ms = _timeframe_to_minutes(timeframe) * 60 * 1000

    since_ms = int(start.replace(tzinfo=timezone.utc).timestamp() * 1000)
    until_ms = int(end.replace(tzinfo=timezone.utc).timestamp() * 1000)

    all_ohlcv = []
    while since_ms < until_ms:
        batch = exchange.fetch_ohlcv(pair, timeframe, since=since_ms, limit=1000)
        if not batch:
            since_ms += step_ms * 1000
            time.sleep(exchange.rateLimit / 1000)
            continue
        # Filter out future candles
        batch = [b for b in batch if b[0] <= until_ms]
        all_ohlcv.extend(batch)
        if len(batch) < 1000:
            break
        since_ms = batch[-1][0] + 1
        time.sleep(exchange.rateLimit / 1000)

    if not all_ohlcv:
        return pd.DataFrame(columns=["timestamp", "open", "high", "low", "close", "volume"]).astype(
            {"timestamp": "datetime64[ns]"}
        )

    df = pd.DataFrame(all_ohlcv, columns=["timestamp", "open", "high", "low", "close", "volume"])
    df["timestamp"] = pd.to_datetime(df["timestamp"], unit="ms", utc=True).dt.tz_localize(None)
    return df


def get_ohlcv(pair: str, timeframe: str, start_date: str, end_date: str,
              exchange: str = "binance") -> pd.DataFrame:
    """
    Main entry point.
    Returns a complete OHLCV DataFrame for the requested range.
    Only downloads missing data, including any internal gap (not just at the
    start/end of the cached range). Confirmed real gaps (delistings, long
    outages) and a confirmed "nothing more after this date" marker are
    persisted to disk so they are not re-checked on every call.
    """
    start = datetime.fromisoformat(start_date[:10])
    end = datetime.fromisoformat(end_date[:10])
    cache_dir = _cache_path(exchange, pair, timeframe)
    step = pd.Timedelta(minutes=_timeframe_to_minutes(timeframe))

    cached = _load_from_disk(cache_dir, start, end)

    if cached is not None:
        cached = cached.sort_values("timestamp").reset_index(drop=True)

        # Check if the range is complete
        cached_start = cached["timestamp"].min()
        cached_end = cached["timestamp"].max()
        start_ts = pd.Timestamp(start)
        end_ts = pd.Timestamp(end)

        known_start = _load_fetch_start(cache_dir)
        need_before = (known_start is None or start < known_start) and cached_start > start_ts

        # Do not re-download the end if end_date >= today (data still in progress).
        # Also skip if we already confirmed there is nothing past this end_date
        # (e.g. a delisted pair that never gets new candles).
        today = pd.Timestamp(datetime.now(timezone.utc).date())
        confirmed_end = _load_confirmed_end(cache_dir)
        need_after = (
            cached_end < end_ts
            and end_ts < today
            and (confirmed_end is None or end_ts > confirmed_end)
        )

        # Internal gaps: missing candles anywhere between cached_start and cached_end
        gaps = _find_gaps(cached, step)
        confirmed = _load_confirmed_gaps(cache_dir)
        if confirmed: log.info(f"Checking {len(gaps)} gap(s) against {len(confirmed)} confirmed gap(s) for {pair}/{timeframe}")
        gaps = [g for g in gaps if not _is_confirmed_gap(g[0], g[1], confirmed)]

        if not need_before and not need_after and not gaps:
            log_cache_hit(pair, timeframe, start_date[:10], end_date[:10], len(cached))
            return cached.reset_index(drop=True)

        log_cache_partial(pair, timeframe)

        frames = [cached]
        if need_before:
            prefix = _fetch_from_exchange(exchange, pair, timeframe, start, cached_start.to_pydatetime())
            frames.insert(0, prefix)

        for gap_start, gap_end in gaps:
            patch = _fetch_from_exchange(exchange, pair, timeframe, gap_start, gap_end)
            # gap_start and gap_end are the two candles already in the cache
            # that border the hole. The exchange always echoes them back, so
            # they must be excluded before checking whether anything NEW
            # was actually recovered in between.
            patch = patch[(patch["timestamp"] > gap_start) & (patch["timestamp"] < gap_end)]
            if patch.empty:
                log.warning(
                    f"Gap {gap_start} -> {gap_end} on {pair}/{timeframe} confirmed empty - "
                    f"caching as known gap, will not re-fetch next time."
                )
                _save_confirmed_gap(cache_dir, gap_start, gap_end)
            else:
                log.info(
                    f"Gap {gap_start} -> {gap_end} on {pair}/{timeframe} was backfilled "
                    f"by the exchange - clearing any stale confirmed-gap entry."
                )
                _remove_confirmed_gap(cache_dir, gap_start, gap_end)
                frames.append(patch)

        if need_after:
            suffix = _fetch_from_exchange(exchange, pair, timeframe, cached_end.to_pydatetime(), end)
            # Same idea as above: cached_end itself will be echoed back, so a
            # suffix that only contains that one candle means nothing new.
            new_candles = suffix[suffix["timestamp"] > cached_end]
            if new_candles.empty:
                log.warning(
                    f"No data past {cached_end} for {pair}/{timeframe} up to {end} - "
                    f"caching as confirmed end, will not re-check next time."
                )
                _save_confirmed_end(cache_dir, end)
            else:
                frames.append(new_candles)

        df = pd.concat(frames).drop_duplicates(subset=["timestamp"]).sort_values("timestamp").reset_index(drop=True)
        _save_to_disk(cache_dir, df)
        if need_before:
            _save_fetch_start(cache_dir, start)
        return df[
            (df["timestamp"] >= pd.Timestamp(start)) &
            (df["timestamp"] <= pd.Timestamp(end))
        ].reset_index(drop=True)

    # Full cache MISS
    log_cache_miss(pair, timeframe, start_date[:10], end_date[:10])
    df = _fetch_from_exchange(exchange, pair, timeframe, start, end)
    if not df.empty:
        _save_to_disk(cache_dir, df)
        _save_fetch_start(cache_dir, start)
    return df