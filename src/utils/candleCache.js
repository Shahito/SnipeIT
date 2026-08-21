// candleCache.js
// Disk cache for closed OHLCV candles, keyed by exchange/pair/timeframe/year.
// Mirrors the pattern already used by python/ohlcv_cache.py: only the delta
// missing from the cache is fetched from the exchange, and only CLOSED
// candles are ever persisted (the current, still-forming candle is always
// re-fetched live and never written to disk).
//
// This keeps memory bounded (nothing is held beyond the request) and keeps
// disk usage proportional to actual historical data, not to traffic.

const fs = require('fs')
const path = require('path')

const CACHE_DIR = process.env.CANDLE_CACHE_DIR || path.join(__dirname, '..', '..', 'cache', 'candles')

function cacheDir(exchange, pair, timeframe) {
    const safePair = String(pair).replace('/', '_')
    return path.join(CACHE_DIR, exchange, safePair, timeframe)
}

function yearFile(dir, year) {
    return path.join(dir, `${year}.json`)
}

function loadYear(dir, year) {
    const file = yearFile(dir, year)
    if (!fs.existsSync(file)) return []
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'))
    } catch (e) {
        console.warn(`[candleCache] Corrupted cache file, ignored: ${file} (${e.message})`)
        return []
    }
}

function saveYear(dir, year, rows) {
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(yearFile(dir, year), JSON.stringify(rows))
}

// --- Load every cached row whose time (sec) falls within [startMs, endMs] ---
function loadRange(dir, startMs, endMs) {
    if (!fs.existsSync(dir)) return []
    const startYear = new Date(startMs).getUTCFullYear()
    const endYear = new Date(endMs).getUTCFullYear()

    const rows = []
    for (let y = startYear; y <= endYear; y++) {
        rows.push(...loadYear(dir, y))
    }
    rows.sort((a, b) => a[0] - b[0])

    return rows.filter(r => r[0] >= startMs && r[0] <= endMs)
}

// --- Persist rows, grouped by year, merging with whatever's already on disk ---
function saveRows(dir, rows) {
    if (!rows.length) return
    const byYear = new Map()
    for (const r of rows) {
        const year = new Date(r[0]).getUTCFullYear()
        if (!byYear.has(year)) byYear.set(year, [])
        byYear.get(year).push(r)
    }
    for (const [year, newRows] of byYear.entries()) {
        const existing = loadYear(dir, year)
        const merged = new Map()
        for (const r of existing) merged.set(r[0], r)
        for (const r of newRows) merged.set(r[0], r) // new data wins on overlap
        const out = Array.from(merged.values()).sort((a, b) => a[0] - b[0])
        saveYear(dir, year, out)
    }
}

/**
 * Returns raw kline-shaped rows ([openTimeMs, open, high, low, close, volume, ...])
 * for [startMs, endMs], using the disk cache and only fetching the missing
 * delta from the exchange via `fetchFn(symbol, timeframe, sinceMs, untilMs)`.
 *
 * `fetchFn` must return rows in the same raw Binance kline array format
 * (index 0 = open time ms, 1-5 = OHLCV as strings/numbers).
 */
async function getCachedKlines({ exchange, symbol, pair, timeframe, tfMs, startMs, endMs, fetchFn }) {
    const dir = cacheDir(exchange, pair, timeframe)
    const cached = loadRange(dir, startMs, endMs)

    const now = Date.now()
    // The candle currently forming is never considered "closed" — never trust
    // cache for it, always re-fetch live.
    const lastClosedBoundary = now - (now % tfMs)

    const cachedStartMs = cached.length ? cached[0][0] : null
    const cachedEndMs = cached.length ? cached[cached.length - 1][0] : null

    const fetchedChunks = []

    if (cachedStartMs === null) {
        // Nothing cached in range at all: one single fetch for the whole span.
        fetchedChunks.push(await fetchFn(symbol, timeframe, startMs, endMs))
    } else {
        const needBefore = startMs < cachedStartMs
        const needAfter = cachedEndMs + tfMs < Math.min(endMs, lastClosedBoundary)

        if (needBefore) {
            fetchedChunks.push(await fetchFn(symbol, timeframe, startMs, cachedStartMs - 1))
        }
        if (needAfter) {
            fetchedChunks.push(await fetchFn(symbol, timeframe, cachedEndMs + tfMs, endMs))
        }
    }

    const fetched = fetchedChunks.flat()

    // Merge cache + freshly fetched, dedupe by open time.
    const merged = new Map()
    for (const r of cached) merged.set(r[0], r)
    for (const r of fetched) merged.set(r[0], r)
    const all = Array.from(merged.values()).sort((a, b) => a[0] - b[0])

    // Persist only rows whose candle has actually closed.
    const toPersist = all.filter(r => r[0] + tfMs <= lastClosedBoundary)
    saveRows(dir, toPersist)

    return all.filter(r => r[0] >= startMs && r[0] <= endMs)
}

module.exports = { getCachedKlines, cacheDir }