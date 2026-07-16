const { getJob } = require('../services/jobService')
const {
  tfMinutes, extractNeeded, warmupCandles, computeColumns, mergeHtfColumn,
} = require('../utils/indicatorEngine')

const BINANCE_KLINES       = 'https://api.binance.com/api/v3/klines'
const MAX_CANDLES_PER_CALL = 1000
const MAX_BATCHES          = 40 // safety cap: 40 * 1000 = 40k candles max per exchange call

function pairToSymbol(pair) {
  return String(pair).replace('/', '').toUpperCase()
}

async function fetchKlines(symbol, interval, startMs, endMs) {
  const all = []
  let since = startMs
  let batches = 0

  while (since < endMs && batches < MAX_BATCHES) {
    const url = new URL(BINANCE_KLINES)
    url.searchParams.set('symbol', symbol)
    url.searchParams.set('interval', interval)
    url.searchParams.set('startTime', String(since))
    url.searchParams.set('endTime', String(endMs))
    url.searchParams.set('limit', String(MAX_CANDLES_PER_CALL))

    const res = await fetch(url)
    if (!res.ok) throw new Error(`BINANCE_FETCH_FAILED_${res.status}`)
    const batch = await res.json()
    if (!Array.isArray(batch) || batch.length === 0) break

    all.push(...batch)
    batches += 1

    if (batch.length < MAX_CANDLES_PER_CALL) break
    since = batch[batch.length - 1][0] + 1
  }

  return all
}

// Raw Binance kline rows -> { time(sec), open, high, low, close, volume } arrays
function toOhlcvArrays(rawKlines) {
  const n = rawKlines.length
  const time = new Array(n), open = new Array(n), high = new Array(n)
  const low  = new Array(n), close = new Array(n), volume = new Array(n)
  for (let i = 0; i < n; i++) {
    const k = rawKlines[i]
    time[i]   = Math.floor(k[0] / 1000)
    open[i]   = parseFloat(k[1])
    high[i]   = parseFloat(k[2])
    low[i]    = parseFloat(k[3])
    close[i]  = parseFloat(k[4])
    volume[i] = parseFloat(k[5])
  }
  return { time, open, high, low, close, volume }
}

async function getCandlesController(req, res) {
  try {
    const job = await getJob(parseInt(req.params.id), req.user.id)
    const snap = job.strategySnapshot
    if (!snap) return res.status(404).json({ error: 'JOB_NOT_FOUND' })

    const exchange = (snap.exchange || 'binance').toLowerCase()
    if (exchange !== 'binance') {
      return res.status(400).json({ error: 'UNSUPPORTED_EXCHANGE' })
    }

    const symbol    = pairToSymbol(snap.pair)
    const timeframe = snap.timeframe
    const requestedStartMs = new Date(snap.startDate).getTime()
    const requestedEndMs   = Math.min(new Date(snap.endDate).getTime(), Date.now())

    if (!symbol || !timeframe || Number.isNaN(requestedStartMs) || Number.isNaN(requestedEndMs)) {
      return res.status(400).json({ error: 'INVALID_JOB_PARAMS' })
    }

    // --- Figure out which indicators this strategy actually uses ---
    const conditions = snap.conditions || {}
    let needed = extractNeeded(conditions)
    // A ref explicitly pinned to the strategy's own timeframe behaves like "base" (no suffix)
    needed = needed.map(n => ({
      ...n,
      timeframe: (!n.timeframe || n.timeframe === timeframe) ? null : n.timeframe,
    }))

    if (snap.slType === 'atr' || snap.tpType === 'atr') {
      needed.push({ indicator: 'ATR', period: snap.atrPeriod || 14, source: null, timeframe: null, settings: null })
    }

    const baseNeeded = needed.filter(n => !n.timeframe)
    const htfNeeded  = needed.filter(n => n.timeframe)
    const baseTfMin  = tfMinutes(timeframe)

    // --- Base timeframe: fetch with warmup prefix so indicators have converged ---
    const warmupN     = warmupCandles(baseNeeded)
    const warmupStart = requestedStartMs - baseTfMin * 60 * 1000 * warmupN

    const rawFull = await fetchKlines(symbol, timeframe, warmupStart, requestedEndMs)
    if (!rawFull.length) {
      return res.json({ candles: [], pair: snap.pair, timeframe, exchange, indicators: {} })
    }

    const ohlcvFull = toOhlcvArrays(rawFull)
    const columnsFull = computeColumns(baseNeeded, ohlcvFull)

    // Trim the warmup prefix off before sending (mirrors backtest.py's df trim to real_start)
    let trimIdx = 0
    while (trimIdx < ohlcvFull.time.length && ohlcvFull.time[trimIdx] * 1000 < requestedStartMs) trimIdx++

    const time  = ohlcvFull.time.slice(trimIdx)
    const open  = ohlcvFull.open.slice(trimIdx)
    const high  = ohlcvFull.high.slice(trimIdx)
    const low   = ohlcvFull.low.slice(trimIdx)
    const close = ohlcvFull.close.slice(trimIdx)

    const indicators = {}
    for (const [col, arr] of Object.entries(columnsFull)) {
      indicators[col] = arr.slice(trimIdx)
    }

    // --- HTF indicators: own fetch + own warmup, aligned back without look-ahead ---
    const htfGroups = new Map()
    for (const item of htfNeeded) {
      const itemTfMin = tfMinutes(item.timeframe)
      if (itemTfMin < baseTfMin) {
        console.warn(`Skipping ${item.indicator}@${item.timeframe}: finer than base timeframe ${timeframe}`)
        continue
      }
      if (!htfGroups.has(item.timeframe)) htfGroups.set(item.timeframe, [])
      htfGroups.get(item.timeframe).push(item)
    }

    for (const [tf, items] of htfGroups.entries()) {
      const htfTfMin     = tfMinutes(tf)
      const htfWarmupN   = warmupCandles(items)
      const htfWarmupStart = requestedStartMs - htfTfMin * 60 * 1000 * htfWarmupN

      const rawHtf = await fetchKlines(symbol, tf, htfWarmupStart, requestedEndMs)
      if (!rawHtf.length) {
        console.warn(`No HTF data for ${snap.pair} ${tf} — skipping ${items.length} indicator(s)`)
        continue
      }

      const ohlcvHtf  = toOhlcvArrays(rawHtf)
      const columnsHtf = computeColumns(items, ohlcvHtf)

      for (const [col, arr] of Object.entries(columnsHtf)) {
        indicators[`${col}@${tf}`] = mergeHtfColumn(time, ohlcvHtf.time, arr, htfTfMin)
      }
    }

    const candles = time.map((t, i) => ({ time: t, open: open[i], high: high[i], low: low[i], close: close[i] }))

    res.json({ candles, pair: snap.pair, timeframe, exchange, indicators })
  } catch (e) {
    if (e.message === 'JOB_NOT_FOUND') {
      return res.status(404).json({ error: 'JOB_NOT_FOUND' })
    }
    console.error('candleController error:', e)
    res.status(502).json({ error: 'CANDLES_FETCH_FAILED' })
  }
}

module.exports = { getCandlesController, fetchKlines, pairToSymbol }
