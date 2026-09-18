<div align="center">
<br/>

# <img src="https://app.snipeit.shabox.dev/images/tab/tab-icon.png" height="32" /> SnipeIT

### *Design a crypto trading strategy, backtest it against real market data, and sweep every parameter to find what actually works.*

<br/>

[![Open the app](https://img.shields.io/badge/✨_Open_the_app-app.snipeit.shabox.dev-7893CC?style=for-the-badge&labelColor=15171F)](https://app.snipeit.shabox.dev)
![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![Express](https://img.shields.io/badge/Express-000000?style=for-the-badge&logo=express&logoColor=white)
![Prisma](https://img.shields.io/badge/Prisma-2D3748?style=for-the-badge&logo=prisma&logoColor=white)
![MySQL](https://img.shields.io/badge/MySQL-4479A1?style=for-the-badge&logo=mysql&logoColor=white)
![Python](https://img.shields.io/badge/Python-3776AB?style=for-the-badge&logo=python&logoColor=white)
<br/>

</div>

---

<br/>

## What is SnipeIT?

**SnipeIT** is a backtesting tool for crypto trading strategies.

Build an entry/exit strategy from technical indicators (RSI, EMA, MACD, Bollinger Bands, ATR, VWAP...), pick a pair, a timeframe and a date range, and run it against historical OHLCV data pulled from Binance. Instead of testing one set of parameters at a time, any numeric field can be turned into a **sweep** - a range of values - so a single launch backtests every combination (parameters × pairs) and comes back with aggregated stats: best/worst runs, per-category breakdown, and per-parameter sensitivity.

The heavy simulation work runs on a separate **Python worker**, decoupled from the web app through a simple job queue - so the app itself stays light, and the worker can run anywhere (your own machine, a VPS, a beefier box for large sweeps) as long as it can reach the API with a key.

> *Not a trading bot. It doesn't place orders - it tells you whether an idea would have worked.*

<br/>

## Get started

Try it straight away, no install needed:

[![Open the app](https://img.shields.io/badge/Open_the_app-%F0%9F%94%97%E2%80%8B-15171F?style=for-the-badge&labelColor=7893CC)](https://app.snipeit.shabox.dev)

1. Create an account
2. Build a strategy in the editor (pairs, timeframe, entry/exit conditions, risk settings)
3. Generate an API key and run a worker against it (see [Run your own worker](#run-your-own-worker))
4. Launch it, watch jobs come in live, and dig into the results

A landing page with more details is up at **[snipeit.shabox.dev](https://snipeit.shabox.dev)**.

<br/>

## Features

| | |
|---|---|
| 🧩 **Visual strategy editor** | Compose entry/exit rules from indicator conditions (AND/OR groups), set position sizing, stop-loss/take-profit (fixed or trailing, percent or ATR-based), fees and trading-hour windows |
| 📈 **Rich backtest results** | Equity curve vs. buy & hold, PnL, win rate, Sharpe ratio, max drawdown, profit factor, exit-reason breakdown, MAE/MFE distributions, monthly performance, full trade log |
| 🔁 **Parameter sweeps** | Turn any field (timeframe, position size, SL/TP, indicator periods...) into a range of values and backtest every combination across multiple pairs in one launch |
| 📊 **Sweep analytics** | Global stats, best/worst/all runs, results grouped by pair category, and per-parameter sensitivity - to see which knobs actually move the needle |
| ⚙️ **Decoupled worker** | A Python worker polls for pending jobs, runs the simulation, and reports back - run it anywhere, scale it independently from the web app |
| 🔑 **API keys** | Scoped keys to authenticate one or several workers against your account |
| 🏷️ **Tags & pair categories** | Organize jobs with custom tags, group pairs into categories (majors, meme coins, L1s...) for cleaner sweep breakdowns |
| 🌍 **i18n** | Full UI in English and French |

<br/>

## Tech stack

- **Frontend** - HTML · CSS · Vanilla JavaScript
- **Backend** - Node.js · Express 5
- **ORM** - Prisma
- **Database** - MySQL
- **Worker** - Python (pandas, ccxt for OHLCV data, custom indicator/backtest engine)
- **Realtime** - Server-Sent Events (job/sweep status)

<br/>

## Run your own instance

The code is open source - if you're a developer and want to host your own version, you're welcome to.

```bash
git clone https://github.com/Shahito/snipeit.git
cd snipeit

npm install
cp .env.example .env    # fill in DATABASE_URL, JWT_SECRET, etc. - see below
npx prisma migrate dev --name init
npm run dev
```

> Create the database with `utf8mb4` / `utf8mb4_unicode_ci` (e.g. `CREATE DATABASE snipeit CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`) - it's what every table is migrated with.

### Environment variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | ✅ | MySQL connection string |
| `JWT_SECRET` | ✅ | Long random string used to sign session tokens |
| `NODE_ENV` | ✅ | `development` or `production` |
| `PORT` | - | HTTP port (default `4000`) |
| `APP_URL` | - | Public base URL of the app |
| `CANDLE_CACHE_DIR` | - | Where cached OHLCV chart data is stored (default `./cache/candles`) |
| `CANDLE_CACHE_MAX_AGE_DAYS` | - | Days of inactivity before a cached pair/timeframe is purged (default `30`) |
| `RESEND_API_KEY` | - | [Resend](https://resend.com) key for transactional email (leave empty in dev) |
| `MAIL_FROM` | - | From address used for outgoing email |
| `RESEND_WEBHOOK_SECRET` | - | Signing secret for the Resend delivery webhook |
| `ALLOW_EMAIL_ALIASES` | - | Accept `+tag`/dot Gmail-style aliases as the same account (default `true`) |

### Run your own worker

Backtests are executed by a separate Python worker, not the Node app. Generate an API key from the UI first (**Account → API Keys**).

```bash
cd python
pip install -r requirements.txt
cp .env.example .env    # fill in SNIPEIT_API_KEY, SNIPEIT_BASE_URL

python snipeit_worker.py
```

| Variable | Required | Description |
|---|---|---|
| `SNIPEIT_API_KEY` | ✅ | API key generated from the UI (**Account → API Keys**) |
| `SNIPEIT_BASE_URL` | ✅ | Base URL of the SnipeIT instance to poll (e.g. `http://localhost:4000`) |
| `POLL_INTERVAL` | - | Seconds between each job poll (default `10`) |
| `HEARTBEAT_INTERVAL` | - | Seconds between each heartbeat (default `20`) |
| `OHLCV_CONFIRMED_GAP_TTL_DAYS` | - | Days before a confirmed gap in cached candle data is re-checked (default `7`) |

<br/>

## License

MIT - code is yours to use, just don't claim it as your own 💛

---

<div align="center">

*Made with precision by Shahito* &nbsp;🎯

</div>