// Disk cache for closed OHLCV candles, keyed by exchange/pair/timeframe/year.
// Mirrors the pattern already used by python/ohlcv_cache.py: only the delta
// missing from the cache is fetched from the exchange, and only CLOSED
// candles are ever persisted (the current, still-forming candle is always
// re-fetched live and never written to disk).
//
// This keeps memory bounded (nothing is held beyond the request) and keeps
// disk usage proportional to actual historical data, not to traffic.
//
// Nothing here ever expired on its own though - a pair/timeframe someone
// charted once years ago stays on disk forever. cleanupStaleCandleCache()
// below adds a simple last-access based TTL: every read/write of a
// pair/timeframe touches a small marker file, and a periodic sweep (wired
// up in app.js via node-cron) deletes whole pair/timeframe folders that
// haven't been touched in CANDLE_CACHE_MAX_AGE_DAYS. This is a "keep what's
// actually being looked at" policy rather than a hard size cap - simpler to
// reason about, and it naturally protects the charts people actually use
// (backtests they keep revisiting) while letting one-off/abandoned ones age
// out on their own.

const fs = require('fs')
const path = require('path')

const CACHE_DIR = process.env.CANDLE_CACHE_DIR || path.join(__dirname, '..', '..', 'cache', 'candles')
const ACCESS_MARKER = '.last_access'
const DEFAULT_MAX_AGE_MS = (Number(process.env.CANDLE_CACHE_MAX_AGE_DAYS) || 30) * 24 * 60 * 60 * 1000

function cacheDir(exchange, pair, timeframe) {
    const safePair = String(pair).replace('/', '_')
    return path.join(CACHE_DIR, exchange, safePair, timeframe)
}

function yearFile(dir, year) {
    return path.join(dir, `${year}.json`)
}

// Last-access tracking (drives cleanupStaleCandleCache)
function touchAccess(dir) {
    try {
        fs.mkdirSync(dir, { recursive: true })
        fs.writeFileSync(path.join(dir, ACCESS_MARKER), String(Date.now()))
    } catch (e) {
        console.warn(`[candleCache] Failed to update access marker for ${dir}: ${e.message}`)
    }
}

function lastAccessMs(dir) {
    try {
        return fs.statSync(path.join(dir, ACCESS_MARKER)).mtimeMs
    } catch {
        // No marker (cache folder predates this feature, or the write above
        // failed once) - fall back to the newest data file's mtime so
        // pre-existing caches get a fair last-touched estimate instead of
        // looking infinitely stale and being wiped on the very first sweep.
        try {
            const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'))
            if (!files.length) return 0
            return Math.max(...files.map(f => fs.statSync(path.join(dir, f)).mtimeMs))
        } catch {
            return 0
        }
    }
}

function dirSizeBytes(dir) {
    let total = 0
    try {
        for (const f of fs.readdirSync(dir)) {
            total += fs.statSync(path.join(dir, f)).size
        }
    } catch { /* best effort, don't let size accounting block cleanup */ }
    return total
}

function subDirs(dir) {
    try {
        return fs.readdirSync(dir, { withFileTypes: true })
            .filter(d => d.isDirectory())
            .map(d => d.name)
    } catch {
        return []
    }
}

/**
 * Deletes exchange/pair/timeframe cache folders that haven't been accessed
 * (read or written via getCachedKlines) in `maxAgeMs`, then prunes any
 * pair/exchange folders left empty behind them. Safe to call repeatedly -
 * a folder that's still in use just gets its marker refreshed on next use
 * and is left alone.
 *
 * Returns a summary so the caller (a cron job) can log something useful.
 */
function cleanupStaleCandleCache(maxAgeMs = DEFAULT_MAX_AGE_MS) {
    if (!fs.existsSync(CACHE_DIR)) return { removedDirs: 0, freedBytes: 0 }

    const cutoff = Date.now() - maxAgeMs
    let removedDirs = 0
    let freedBytes = 0

    for (const exchange of subDirs(CACHE_DIR)) {
        const exchangeDir = path.join(CACHE_DIR, exchange)
        for (const pair of subDirs(exchangeDir)) {
            const pairDir = path.join(exchangeDir, pair)
            for (const timeframe of subDirs(pairDir)) {
                const tfDir = path.join(pairDir, timeframe)
                console.log(`${pairDir} - ${lastAccessMs(tfDir)} < ${cutoff}`)
                if (lastAccessMs(tfDir) < cutoff) {
                    freedBytes += dirSizeBytes(tfDir)
                    fs.rmSync(tfDir, { recursive: true, force: true })
                    removedDirs++
                }
            }
            if (subDirs(pairDir).length === 0) fs.rmSync(pairDir, { recursive: true, force: true })
        }
        if (subDirs(exchangeDir).length === 0) fs.rmSync(exchangeDir, { recursive: true, force: true })
    }

    if (removedDirs > 0) {
        const mb = (freedBytes / (1024 * 1024)).toFixed(1)
        console.log(`[candleCache] Cleanup: removed ${removedDirs} stale pair/timeframe cache(s), freed ~${mb} MB`)
    }

    return { removedDirs, freedBytes }
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

// Load every cached row whose time (sec) falls within [startMs, endMs]
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

// Persist rows, grouped by year, merging with whatever's already on disk
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
    touchAccess(dir) // mark this pair/timeframe as "seen" - keeps it alive for cleanupStaleCandleCache
    const cached = loadRange(dir, startMs, endMs)

    const now = Date.now()
    // The candle currently forming is never considered "closed" - never trust
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

module.exports = { getCachedKlines, cacheDir, cleanupStaleCandleCache }