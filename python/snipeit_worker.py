"""
SnipeIT Worker
==============
Lightweight main loop. All logic lives in:
  - ohlcv_cache.py  : candle downloading and caching
  - indicators.py   : technical indicator computation
  - backtest.py     : simulation engine

Configuration (.env):
  SNIPEIT_API_KEY=snp_xxxx
  SNIPEIT_BASE_URL=http://localhost:4000
  POLL_INTERVAL=10         # seconds between each poll
  HEARTBEAT_INTERVAL=20    # seconds between each heartbeat
  OHLCV_CACHE_DIR=./cache  # OHLCV cache directory
"""

import os
import sys
import time
import platform
import logging
import threading
import requests
from dotenv import load_dotenv
import json
import sys
import tty
import select
import string
import atexit
import termios

from logger import (
    get_logger,
    print_banner,
    backtest_spinner,
    log_job_result,
    log_job_error,
    log_poll_empty,
    log_poll_jobs,
    log_server_unreachable,
    log_heartbeat,
    log_stopped,
)

__version__ = "1.0.0"

load_dotenv()

BASE_URL           = os.getenv("SNIPEIT_BASE_URL", "http://localhost:4000")
API_KEY            = os.getenv("SNIPEIT_API_KEY", "")
POLL_INTERVAL      = int(os.getenv("POLL_INTERVAL", "10"))
HEARTBEAT_INTERVAL = int(os.getenv("HEARTBEAT_INTERVAL", "20"))

log = get_logger("snipeit")

# User-Agent
USER_AGENT = (
    f"SnipeIT-Worker/{__version__} "
    f"(Python {platform.python_version()}; {platform.system()} {platform.release()})"
)

# API client
def _headers():
    return {
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json",
        "User-Agent": USER_AGENT,
    }

def _post(path: str, payload: dict = None):
    payload_size_kb = len(json.dumps(payload or {}).encode('utf-8')) / 1024
    log.debug(f"Payload size (kB) for {path}: {payload_size_kb}")
    r = requests.post(f"{BASE_URL}{path}", json=payload or {}, headers=_headers(), timeout=15)
    r.raise_for_status()
    return r.json()

def _get(path: str):
    r = requests.get(f"{BASE_URL}{path}", headers=_headers(), timeout=15)
    r.raise_for_status()
    return r.json()


# Heartbeat (separate thread)

def _heartbeat_loop():
    while True:
        time.sleep(HEARTBEAT_INTERVAL)
        try:
            _post("/api/worker/heartbeat")
            log_heartbeat()
        except requests.exceptions.ConnectionError:
            log.warning(f"Server unreachable - heartbeat failed")
        except Exception as e:
            log.warning(f"Heartbeat failed: {e}")


# Job processing

def _process_job(job: dict):
    from backtest import run_backtest

    job_id   = job["id"]
    strategy = job["strategy"]
    log.info(f"Job #{job_id} - {strategy['name']} ({strategy['pair']} {strategy['timeframe']})")

    try:
        with backtest_spinner(job_id, strategy["name"], strategy["pair"], strategy["timeframe"]):
            result = run_backtest(strategy)
        _post(f"/api/worker/jobs/{job_id}/result", {"success": True, "result": result})
        log_job_result(job_id=job_id, result=result)
    except Exception as e:
        log_job_error(job_id=job_id, error=str(e))
        try:
            _post(f"/api/worker/jobs/{job_id}/result", {"success": False, "errorMessage": str(e)})
        except Exception as post_err:
            log.error(f"Could not submit error: {post_err}")


# Main loop
_fd = sys.stdin.fileno()
_old_settings = termios.tcgetattr(_fd)

def restore_terminal():
    termios.tcsetattr(_fd, termios.TCSADRAIN, _old_settings)

atexit.register(restore_terminal)

def start_key_listener(callback):
    def run():
        tty.setcbreak(_fd)
        try:
            while select.select([sys.stdin], [], [], 0)[0]:
                sys.stdin.read(1)
            while True:
                ch = sys.stdin.read(1)
                if not ch or ch not in string.printable:
                    continue
                callback(ch)

        except Exception as e:
            pass

    threading.Thread(target=run, daemon=True).start()

def main():
    stop_event = threading.Event()
    def on_key(key):
        if key.lower() == "q":
            stop_event.set()
    
    start_key_listener(on_key)

    if not API_KEY:
        log.error("🔑 SNIPEIT_API_KEY not set in .env - exiting")
        sys.exit(1)
    
    log.info(f"SnipeIT Worker started")
    print_banner(
        base_url=BASE_URL,
        poll=POLL_INTERVAL,
        heartbeat=HEARTBEAT_INTERVAL,
        cache_dir=os.getenv("OHLCV_CACHE_DIR", "./cache"),
    )

    # Start heartbeat in background
    hb_thread = threading.Thread(target=_heartbeat_loop, daemon=True)
    hb_thread.start()

    # Send an immediate heartbeat on startup
    try:
        _post("/api/worker/heartbeat")
    except Exception:
        pass

    try:
        while not stop_event.is_set():
            try:
                data = _get("/api/worker/jobs")
                jobs = data.get("jobs", [])

                if jobs:
                    log_poll_jobs(len(jobs))
                    for job in jobs:
                        _process_job(job)
                else:
                    log_poll_empty()

            except requests.exceptions.ConnectionError:
                log_server_unreachable(POLL_INTERVAL)
            except requests.exceptions.HTTPError as e:
                log.error(f"HTTP error: {e}")
            except Exception as e:
                log.error(f"Unexpected error: {e}")

            stop_event.wait(POLL_INTERVAL)
    
    except KeyboardInterrupt:
        # Clean stop event
        stop_event.set()
    
    log_stopped()


if __name__ == "__main__":
    main()