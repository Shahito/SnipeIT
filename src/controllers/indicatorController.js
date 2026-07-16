const { getJob } = require('../services/jobService')
const { fetchKlines, pairToSymbol } = require('./candleController')

// ---- timeframe helpers (mirrors backtest.py's _TF_MINUTES) ----

const TF_MINUTES = {
  '1m': 1, '3m': 3, '5m': 5, '15m': 15, '30m': 30,
  '1h': 60, '2h': 120, '4h': 240, '6h': 360, '8h': 480, '12h': 720,
  '1d': 1440, '3d': 4320, '1w': 10080,
}
function tfMinutes(tf) { return TF_MINUTES[tf] || 60 }

// ---- indicator registry (mirrors indicators.py REGISTRY) ----
// label(period, mergedExtraParams) -> column name, matching column_name() in indicators.py

const REGISTRY = {
  RSI:         { period: 14, kind: 'oscillator', label: p => `RSI_${p}` },
  EMA:         { period: 20, kind: 'overlay', hasSource: true, label: p => `EMA_${p}` },
  SMA:         { period: 20, kind: 'overlay', hasSource: true, label: p => `SMA_${p}` },
  MACD:        { kind: 'macd', fixedMin: 34, extraParams: { fast: 12, slow: 26, signal: 9 }, label: (p, m) => `MACD_${m.fast}_${m.slow}_${m.signal}` },
  MACD_SIGNAL: { kind: 'macd', fixedMin: 34, extraParams: { fast: 12, slow: 26, signal: 9 }, label: (p, m) => `MACD_signal_${m.fast}_${m.slow}_${m.signal}` },
  MACD_HIST:   { kind: 'macd', fixedMin: 34, extraParams: { fast: 12, slow: 26, signal: 9 }, label: (p, m) => `MACD_histogram_${m.fast}_${m.slow}_${m.signal}` },
  BB_UPPER:    { period: 20, kind: 'overlay', label: p => `BB_UPPER_${p}` },
  BB_MID:      { period: 20, kind: 'overlay', label: p => `BB_MID_${p}` },
  BB_LOWER:    { period: 20, kind: 'overlay', label: p => `BB_LOWER_${p}` },
  ATR:         { period: 14, kind: 'atr', label: p => `ATR_${p}` },
  STOCH_RSI_K: { period: 14, kind: 'oscillator', label: p => `STOCH_RSI_K_${p}` },
  STOCH_RSI_D: { period: 14, kind: 'oscillator', label: p => `STOCH_RSI_D_${p}` },
  VWAP:        { kind: 'overlay', label: () => 'VWAP' },
  // PRICE/VOLUME/HIGH/LOW/OPEN intentionally not plotted: redundant with the candlesticks already shown
}

const SOURCE_SERIES = {
  VOLUME: arr => arr.volume,
  HIGH:   arr => arr.high,
  LOW:    arr => arr.low,
  OPEN:   arr => arr.open,
}

function columnLabel(indicator, period, source, settings) {
  const meta = REGISTRY[indicator]
  if (!meta) return null
  const p = period || meta.period || 14
  if (source && meta.hasSource) return `${indicator}_${source}_${p}`
  if (meta.extraParams) {
    const merged = { ...meta.extraParams, ...(settings || {}) }
    return meta.label(p, merged)
  }
  return meta.label(p)
}

function warmupCandles(items) {
  let maxP = 1
  for (const it of items) {
    const meta = REGISTRY[it.indicator]
    if (!meta) continue
    const p = meta.fixedMin || it.period || meta.period || 14
    maxP = Math.max(maxP, p)
  }
  return maxP * 2 + 1
}

// ---- extract_needed port (indicators.py) ----

function extractNeeded(conditions) {
  const needed = new Map()

  function add(indicator, period, source, timeframe, settings) {
    if (!indicator) return
    const key = JSON.stringify([indicator, period || null, source || null, timeframe || null, settings ? JSON.stringify(settings) : null])
    if (!needed.has(key)) {
      needed.set(key, { indicator, period: period || null, source: source || null, timeframe: timeframe || null, settings: settings || null })
    }
  }

  function extractRule(cond) {
    if (!cond || typeof cond !== 'object') return
    add(cond.indicator, cond.period, cond.source, cond.timeframe, cond.settings)
    if (cond.combineIndicator) {
      add(cond.combineIndicator, cond.combinePeriod, cond.combineSource, cond.timeframe, cond.combineSettings)
    }
    if (cond.valueIndicator) {
      add(cond.valueIndicator, cond.valueIndicatorPeriod, cond.valueIndicatorSource, cond.valueIndicatorTimeframe, cond.valueIndicatorSettings)
      if (cond.valueCombineIndicator) {
        add(cond.valueCombineIndicator, cond.valueCombinePeriod, cond.valueCombineSource, cond.valueIndicatorTimeframe, cond.valueCombineSettings)
      }
    }
  }

  for (const section of [conditions.entry || [], conditions.exit || []]) {
    for (const item of section) {
      if (Array.isArray(item)) item.forEach(extractRule)
      else extractRule(item)
    }
  }

  return [...needed.values()]
}

// ---- math (faithful port of indicators.py's pandas formulas) ----

function diffArr(arr) {
  const out = new Array(arr.length).fill(NaN)
  for (let i = 1; i < arr.length; i++) out[i] = arr[i] - arr[i - 1]
  return out
}

// EWM, adjust=False, seeded at the first non-NaN value (matches pandas default behavior)
function ewmAlpha(values, alpha) {
  const out = new Array(values.length).fill(NaN)
  let prev = null
  for (let i = 0; i < values.length; i++) {
    const v = values[i]
    if (v === null || Number.isNaN(v)) { out[i] = prev === null ? NaN : prev; continue }
    prev = prev === null ? v : alpha * v + (1 - alpha) * prev
    out[i] = prev
  }
  return out
}
function ewmSpan(values, span) { return ewmAlpha(values, 2 / (span + 1)) }

// Windowed (not cumulative) so NaNs don't contaminate the running sum forever.
// Matches pandas rolling(...).mean()/.std() default min_periods=window behavior.
function rollingMean(values, period) {
  const out = new Array(values.length).fill(NaN)
  for (let i = period - 1; i < values.length; i++) {
    let sum = 0, ok = true
    for (let j = i - period + 1; j <= i; j++) {
      const v = values[j]
      if (v === null || Number.isNaN(v)) { ok = false; break }
      sum += v
    }
    out[i] = ok ? sum / period : NaN
  }
  return out
}
function rollingStd(values, period) { // sample std, ddof=1 (pandas default)
  const out = new Array(values.length).fill(NaN)
  for (let i = period - 1; i < values.length; i++) {
    let ok = true
    let mean = 0
    for (let j = i - period + 1; j <= i; j++) {
      const v = values[j]
      if (v === null || Number.isNaN(v)) { ok = false; break }
      mean += v
    }
    if (!ok) continue
    mean /= period
    let sq = 0
    for (let j = i - period + 1; j <= i; j++) sq += (values[j] - mean) ** 2
    out[i] = Math.sqrt(sq / (period - 1))
  }
  return out
}
function rollingMin(values, period) {
  const out = new Array(values.length).fill(NaN)
  for (let i = period - 1; i < values.length; i++) {
    let m = Infinity, ok = true
    for (let j = i - period + 1; j <= i; j++) {
      const v = values[j]
      if (v === null || Number.isNaN(v)) { ok = false; break }
      if (v < m) m = v
    }
    out[i] = ok ? m : NaN
  }
  return out
}
function rollingMax(values, period) {
  const out = new Array(values.length).fill(NaN)
  for (let i = period - 1; i < values.length; i++) {
    let m = -Infinity, ok = true
    for (let j = i - period + 1; j <= i; j++) {
      const v = values[j]
      if (v === null || Number.isNaN(v)) { ok = false; break }
      if (v > m) m = v
    }
    out[i] = ok ? m : NaN
  }
  return out
}

function computeRSI(close, period) {
  const delta = diffArr(close)
  const gain = delta.map(d => Number.isNaN(d) ? NaN : Math.max(d, 0))
  const loss = delta.map(d => Number.isNaN(d) ? NaN : Math.max(-d, 0))
  const alpha = 1 / period
  const gEwm = ewmAlpha(gain, alpha)
  const lEwm = ewmAlpha(loss, alpha)
  const out = new Array(close.length).fill(NaN)
  for (let i = 0; i < close.length; i++) {
    const g = gEwm[i], l = lEwm[i]
    if (Number.isNaN(g) || Number.isNaN(l)) continue
    if (l === 0 && g > 0) out[i] = 100
    else if (l === 0 && g === 0) out[i] = 50
    else out[i] = 100 - 100 / (1 + g / l)
  }
  return out
}

function computeEMA(src, period) { return ewmSpan(src, period) }
function computeSMA(src, period) { return rollingMean(src, period) }

function computeMACD(close, fast, slow, signal) {
  const emaFast = ewmSpan(close, fast)
  const emaSlow = ewmSpan(close, slow)
  const macdLine = close.map((_, i) => emaFast[i] - emaSlow[i])
  const signalLine = ewmSpan(macdLine, signal)
  const hist = macdLine.map((v, i) => v - signalLine[i])
  return { macdLine, signalLine, hist }
}

function computeBB(close, period, stdDev) {
  const mid = rollingMean(close, period)
  const std = rollingStd(close, period)
  const upper = mid.map((m, i) => (Number.isNaN(m) || Number.isNaN(std[i])) ? NaN : m + stdDev * std[i])
  const lower = mid.map((m, i) => (Number.isNaN(m) || Number.isNaN(std[i])) ? NaN : m - stdDev * std[i])
  return { mid, upper, lower }
}

function computeATR(high, low, close, period) {
  const n = high.length
  const tr = new Array(n).fill(NaN)
  for (let i = 0; i < n; i++) {
    if (i === 0) { tr[i] = high[i] - low[i]; continue }
    const pc = close[i - 1]
    tr[i] = Math.max(high[i] - low[i], Math.abs(high[i] - pc), Math.abs(low[i] - pc))
  }
  return ewmAlpha(tr, 1 / period)
}

function computeStochRSI(close, period, smoothK, smoothD) {
  const rsi = computeRSI(close, period)
  const minR = rollingMin(rsi, period)
  const maxR = rollingMax(rsi, period)
  const stoch = rsi.map((r, i) => {
    if (Number.isNaN(r) || Number.isNaN(minR[i]) || Number.isNaN(maxR[i])) return NaN
    const range = maxR[i] - minR[i]
    if (range === 0) return NaN
    return (r - minR[i]) / range * 100
  })
  const k = rollingMean(stoch, smoothK)
  const d = rollingMean(k, smoothD)
  return { k, d }
}

function computeVWAP(high, low, close, volume) {
  const n = high.length
  const out = new Array(n).fill(NaN)
  let cumPV = 0, cumV = 0
  for (let i = 0; i < n; i++) {
    const tp = (high[i] + low[i] + close[i]) / 3
    cumPV += tp * volume[i]
    cumV += volume[i]
    out[i] = cumV !== 0 ? cumPV / cumV : NaN
  }
  return out
}

// ---- per-ref dispatcher ----

function computeSeriesFor(n, arr) {
  const { indicator, period, source, settings } = n
  const meta = REGISTRY[indicator]
  if (!meta) return { kind: null, outputs: {} }
  const p = period || meta.period || 14

  switch (indicator) {
    case 'RSI':
      return { kind: 'oscillator', outputs: { [columnLabel('RSI', p)]: computeRSI(arr.close, p) } }
    case 'EMA': {
      const src = source ? SOURCE_SERIES[source](arr) : arr.close
      return { kind: 'overlay', outputs: { [columnLabel('EMA', p, source)]: computeEMA(src, p) } }
    }
    case 'SMA': {
      const src = source ? SOURCE_SERIES[source](arr) : arr.close
      return { kind: 'overlay', outputs: { [columnLabel('SMA', p, source)]: computeSMA(src, p) } }
    }
    case 'MACD':
    case 'MACD_SIGNAL':
    case 'MACD_HIST': {
      const merged = { fast: 12, slow: 26, signal: 9, ...(settings || {}) }
      const { macdLine, signalLine, hist } = computeMACD(arr.close, merged.fast, merged.slow, merged.signal)
      return {
        kind: 'macd',
        outputs: {
          [columnLabel('MACD', p, null, merged)]:       macdLine,
          [columnLabel('MACD_SIGNAL', p, null, merged)]: signalLine,
          [columnLabel('MACD_HIST', p, null, merged)]:   hist,
        },
      }
    }
    case 'BB_UPPER':
    case 'BB_MID':
    case 'BB_LOWER': {
      const { mid, upper, lower } = computeBB(arr.close, p, 2.0)
      return {
        kind: 'overlay',
        outputs: {
          [columnLabel('BB_MID', p)]:   mid,
          [columnLabel('BB_UPPER', p)]: upper,
          [columnLabel('BB_LOWER', p)]: lower,
        },
      }
    }
    case 'ATR':
      return { kind: 'atr', outputs: { [columnLabel('ATR', p)]: computeATR(arr.high, arr.low, arr.close, p) } }
    case 'STOCH_RSI_K':
    case 'STOCH_RSI_D': {
      const { k, d } = computeStochRSI(arr.close, p, 3, 3)
      return {
        kind: 'oscillator',
        outputs: {
          [columnLabel('STOCH_RSI_K', p)]: k,
          [columnLabel('STOCH_RSI_D', p)]: d,
        },
      }
    }
    case 'VWAP':
      return { kind: 'overlay', outputs: { VWAP: computeVWAP(arr.high, arr.low, arr.close, arr.volume) } }
    default:
      return { kind: null, outputs: {} }
  }
}

function klinesToArrays(raw) {
  const time = [], open = [], high = [], low = [], close = [], volume = []
  for (const k of raw) {
    time.push(Math.floor(k[0] / 1000))
    open.push(parseFloat(k[1]))
    high.push(parseFloat(k[2]))
    low.push(parseFloat(k[3]))
    close.push(parseFloat(k[4]))
    volume.push(parseFloat(k[5]))
  }
  return { time, open, high, low, close, volume }
}

// as-of backward join: for each base time, the value of the last htf candle
// whose close time (open + tf duration) is <= base time. Mirrors
// _merge_htf_column() in backtest.py (no look-ahead).
function alignAsOf(baseTimes, htfCloseTimes, htfValues) {
  const out = new Array(baseTimes.length).fill(NaN)
  let j = -1, hi = 0
  for (let i = 0; i < baseTimes.length; i++) {
    while (hi < htfCloseTimes.length && htfCloseTimes[hi] <= baseTimes[i]) { j = hi; hi++ }
    out[i] = j >= 0 ? htfValues[j] : NaN
  }
  return out
}

async function getIndicatorsController(req, res) {
  try {
    const job = await getJob(parseInt(req.params.id), req.user.id)
    const snap = job.strategySnapshot
    if (!snap) return res.status(404).json({ error: 'JOB_NOT_FOUND' })

    const exchange = (snap.exchange || 'binance').toLowerCase()
    if (exchange !== 'binance') return res.status(400).json({ error: 'UNSUPPORTED_EXCHANGE' })

    const baseTf = snap.timeframe
    const conditions = snap.conditions || {}

    let needed = extractNeeded(conditions)
    // A ref pointing at the strategy's own timeframe behaves like "no timeframe" (base)
    needed = needed.map(n => ({ ...n, timeframe: (!n.timeframe || n.timeframe === baseTf) ? null : n.timeframe }))
    // Only HTF (slower) refs are valid — same rule as backtest.py
    needed = needed.filter(n => !n.timeframe || tfMinutes(n.timeframe) >= tfMinutes(baseTf))

    if (snap.slType === 'atr' || snap.tpType === 'atr') {
      needed.push({ indicator: 'ATR', period: snap.atrPeriod || 14, source: null, timeframe: null, settings: null })
    }

    // keep only known, plottable indicators, deduplicated
    const seen = new Set()
    needed = needed.filter(n => {
      if (!REGISTRY[n.indicator]) return false
      const key = JSON.stringify([n.indicator, n.period, n.source, n.timeframe, n.settings])
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })

    if (!needed.length) return res.json({ series: {}, meta: {} })

    const symbol  = pairToSymbol(snap.pair)
    const startMs = new Date(snap.startDate).getTime()
    const endMs   = Math.min(new Date(snap.endDate).getTime(), Date.now())

    if (!symbol || !baseTf || Number.isNaN(startMs) || Number.isNaN(endMs)) {
      return res.status(400).json({ error: 'INVALID_JOB_PARAMS' })
    }

    const seriesOut = {}
    const meta = {}

    function storeOutputs(outputs, kind, timeArr, tfSuffix) {
      for (const [label, values] of Object.entries(outputs)) {
        const finalLabel = tfSuffix ? `${label}@${tfSuffix}` : label
        if (seriesOut[finalLabel]) continue
        const points = []
        for (let i = 0; i < timeArr.length; i++) {
          const v = values[i]
          if (v === null || v === undefined || Number.isNaN(v)) continue
          points.push({ time: timeArr[i], value: Math.round(v * 1e6) / 1e6 })
        }
        seriesOut[finalLabel] = points
        meta[finalLabel] = kind
      }
    }

    // --- base-timeframe refs ---
    const baseNeeded = needed.filter(n => !n.timeframe)
    const baseTfMin  = tfMinutes(baseTf)
    const baseWarmupN = warmupCandles(baseNeeded)
    const baseWarmupStartMs = startMs - baseWarmupN * baseTfMin * 60 * 1000

    const baseRaw = await fetchKlines(symbol, baseTf, baseWarmupStartMs, endMs)
    const base = klinesToArrays(baseRaw)

    if (!base.time.length) return res.json({ series: {}, meta: {} })

    for (const n of baseNeeded) {
      const { kind, outputs } = computeSeriesFor(n, base)
      if (kind) storeOutputs(outputs, kind, base.time, null)
    }

    // --- HTF refs, grouped by timeframe, aligned back onto base.time ---
    const htfGroups = {}
    for (const n of needed.filter(n => n.timeframe)) {
      (htfGroups[n.timeframe] = htfGroups[n.timeframe] || []).push(n)
    }

    for (const [tf, items] of Object.entries(htfGroups)) {
      const tfMin = tfMinutes(tf)
      const wN = warmupCandles(items)
      const wStartMs = startMs - wN * tfMin * 60 * 1000

      const htfRaw = await fetchKlines(symbol, tf, wStartMs, endMs)
      const htfArr = klinesToArrays(htfRaw)
      if (!htfArr.time.length) continue

      const closeTimes = htfArr.time.map(t => t + tfMin * 60)

      for (const n of items) {
        const { kind, outputs } = computeSeriesFor(n, htfArr)
        if (!kind) continue
        const aligned = {}
        for (const [label, values] of Object.entries(outputs)) {
          aligned[label] = alignAsOf(base.time, closeTimes, values)
        }
        storeOutputs(aligned, kind, base.time, tf)
      }
    }

    // trim warmup: only return points within the actual requested period
    const startSec = Math.floor(startMs / 1000)
    for (const label of Object.keys(seriesOut)) {
      seriesOut[label] = seriesOut[label].filter(p => p.time >= startSec)
    }

    res.json({ series: seriesOut, meta })
  } catch (e) {
    if (e.message === 'JOB_NOT_FOUND') return res.status(404).json({ error: 'JOB_NOT_FOUND' })
    console.error('indicatorController error:', e)
    res.status(502).json({ error: 'INDICATORS_FETCH_FAILED' })
  }
}

module.exports = { getIndicatorsController }
