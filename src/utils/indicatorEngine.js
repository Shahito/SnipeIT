// indicatorEngine.js
// JS port of python/indicators.py - must stay numerically consistent with it.
// Used to overlay the exact indicators a strategy's conditions rely on, on top
// of the chart candles fetched from Binance.

const TF_MINUTES = {
  "1m": 1, "3m": 3, "5m": 5, "15m": 15, "30m": 30,
  "1h": 60, "2h": 120, "4h": 240, "6h": 360, "8h": 480, "12h": 720,
  "1d": 1440, "3d": 4320, "1w": 10080,
}
function tfMinutes(tf) { return TF_MINUTES[tf] || 60 }

// Mirrors REGISTRY in indicators.py (only what's needed for column naming +
// default params - the actual math lives in the compute* functions below).
const REGISTRY = {
  RSI:         { params: { period: 14 } },
  EMA:         { params: { period: 20 }, sources: ["VOLUME", "HIGH", "LOW", "OPEN"] },
  SMA:         { params: { period: 20 }, sources: ["VOLUME", "HIGH", "LOW", "OPEN"] },
  MACD:        { params: {}, extra: { fast: 12, slow: 26, signal: 9 } },
  MACD_SIGNAL: { params: {}, extra: { fast: 12, slow: 26, signal: 9 } },
  MACD_HIST:   { params: {}, extra: { fast: 12, slow: 26, signal: 9 } },
  BB_UPPER:    { params: { period: 20 } },
  BB_LOWER:    { params: { period: 20 } },
  BB_MID:      { params: { period: 20 } },
  ATR:         { params: { period: 14 } },
  STOCH_RSI_K: { params: { period: 14 } },
  STOCH_RSI_D: { params: { period: 14 } },
  VWAP:        { params: {} },
  PRICE:       { params: {} },
  VOLUME:      { params: {} },
  HIGH:        { params: {} },
  LOW:         { params: {} },
  OPEN:        { params: {} },
}

const FIXED_MINIMUMS = { MACD: 34, MACD_SIGNAL: 34, MACD_HIST: 34, VWAP: 1, PRICE: 1, VOLUME: 1 }

function columnName(indicator, period, source, settings) {
  const meta = REGISTRY[indicator]
  if (!meta) return null
  const p = period || meta.params.period || 14

  if (source && meta.sources) return `${indicator}_${source}_${p}`

  if (meta.extra) {
    const m = { ...meta.extra, ...(settings || {}) }
    if (indicator === "MACD")        return `MACD_${m.fast}_${m.slow}_${m.signal}`
    if (indicator === "MACD_SIGNAL") return `MACD_signal_${m.fast}_${m.slow}_${m.signal}`
    if (indicator === "MACD_HIST")   return `MACD_histogram_${m.fast}_${m.slow}_${m.signal}`
  }

  switch (indicator) {
    case "RSI":         return `RSI_${p}`
    case "EMA":          return `EMA_${p}`
    case "SMA":          return `SMA_${p}`
    case "BB_UPPER":     return `BB_UPPER_${p}`
    case "BB_LOWER":     return `BB_LOWER_${p}`
    case "BB_MID":       return `BB_MID_${p}`
    case "ATR":          return `ATR_${p}`
    case "STOCH_RSI_K":  return `STOCH_RSI_K_${p}`
    case "STOCH_RSI_D":  return `STOCH_RSI_D_${p}`
    case "VWAP":         return "VWAP"
    case "PRICE":        return "PRICE"
    case "VOLUME":       return "VOLUME"
    case "HIGH":         return "HIGH"
    case "LOW":          return "LOW"
    case "OPEN":         return "OPEN"
    default:             return null
  }
}

// --- Port of extract_needed() from indicators.py ---
function extractNeeded(conditions) {
  if (!conditions) return []
  const needed = new Map()

  const skey = (s) => (s ? JSON.stringify(Object.entries(s).sort()) : "")
  const add = (indicator, period, source, timeframe, settings) => {
    if (!indicator) return
    const key = `${indicator}|${period || ""}|${source || ""}|${timeframe || ""}|${skey(settings)}`
    if (!needed.has(key)) needed.set(key, { indicator, period, source, timeframe, settings })
  }

  const extractRule = (cond) => {
    add(cond.indicator, cond.period, cond.source, cond.timeframe, cond.settings)
    if (cond.combineIndicator) {
      add(cond.combineIndicator, cond.combinePeriod, cond.combineSource, cond.timeframe, cond.combineSettings)
    }
    if (cond.valueIndicator) {
      add(cond.valueIndicator, cond.valueIndicatorPeriod, cond.valueIndicatorSource,
          cond.valueIndicatorTimeframe, cond.valueIndicatorSettings)
      if (cond.valueCombineIndicator) {
        add(cond.valueCombineIndicator, cond.valueCombinePeriod, cond.valueCombineSource,
            cond.valueIndicatorTimeframe, cond.valueCombineSettings)
      }
    }
  }

  for (const section of [conditions.entry || [], conditions.exit || []]) {
    for (const item of section) {
      if (Array.isArray(item)) item.forEach(extractRule)
      else extractRule(item)
    }
  }
  return Array.from(needed.values())
}

// Port of _warmup_candles(): extra candles fetched before the display range
// so EMA/rolling indicators have converged by the time we actually show data.
function warmupCandles(neededList) {
  let maxPeriod = 1
  for (const n of neededList) {
    let p
    if (FIXED_MINIMUMS[n.indicator] != null) p = FIXED_MINIMUMS[n.indicator]
    else {
      const meta = REGISTRY[n.indicator]
      if (!meta) continue
      p = n.period || meta.params.period || 1
    }
    maxPeriod = Math.max(maxPeriod, p)
  }
  return maxPeriod * 2 + 1
}

// --- Math primitives (ported from pandas semantics used in indicators.py) ---

// pandas .ewm(..., adjust=False).mean(): starts at the first value (no NaN
// skipping needed here since our OHLCV series never has internal NaN).
function ewm(values, alpha) {
  const n = values.length
  const out = new Array(n).fill(NaN)
  let prev = NaN
  for (let i = 0; i < n; i++) {
    const v = values[i]
    if (Number.isNaN(v)) { out[i] = NaN; continue }
    if (Number.isNaN(prev)) { prev = v } else { prev = alpha * v + (1 - alpha) * prev }
    out[i] = prev
  }
  return out
}

// pandas .rolling(period).mean(): NaN if any value in the window is NaN
// (matches default min_periods == window behavior for our purposes).
function rollingMean(values, period) {
  const n = values.length
  const out = new Array(n).fill(NaN)
  for (let i = period - 1; i < n; i++) {
    let sum = 0, ok = true
    for (let j = i - period + 1; j <= i; j++) {
      const v = values[j]
      if (Number.isNaN(v)) { ok = false; break }
      sum += v
    }
    if (ok) out[i] = sum / period
  }
  return out
}

// pandas .rolling(period).std(): sample std (ddof=1).
function rollingStd(values, period) {
  const n = values.length
  const out = new Array(n).fill(NaN)
  for (let i = period - 1; i < n; i++) {
    let sum = 0, ok = true
    for (let j = i - period + 1; j <= i; j++) {
      if (Number.isNaN(values[j])) { ok = false; break }
      sum += values[j]
    }
    if (!ok) continue
    const mean = sum / period
    let sq = 0
    for (let j = i - period + 1; j <= i; j++) sq += (values[j] - mean) ** 2
    out[i] = Math.sqrt(sq / (period - 1))
  }
  return out
}

function computeEMA(series, period) { return ewm(series, 2 / (period + 1)) }
function computeSMA(series, period) { return rollingMean(series, period) }

function computeRSI(close, period) {
  const n = close.length
  const delta = new Array(n).fill(NaN)
  for (let i = 1; i < n; i++) delta[i] = close[i] - close[i - 1]
  const gain = delta.map(d => Number.isNaN(d) ? NaN : Math.max(d, 0))
  const loss = delta.map(d => Number.isNaN(d) ? NaN : Math.max(-d, 0))
  const alpha = 1 / period
  const g = ewm(gain, alpha)
  const l = ewm(loss, alpha)
  const out = new Array(n).fill(NaN)
  for (let i = 0; i < n; i++) {
    if (Number.isNaN(g[i]) || Number.isNaN(l[i])) continue
    if (l[i] === 0) { out[i] = g[i] > 0 ? 100 : 50; continue }
    const rs = g[i] / l[i]
    out[i] = 100 - 100 / (1 + rs)
  }
  return out
}

function computeMACD(close, fast, slow, signal) {
  const emaFast = computeEMA(close, fast)
  const emaSlow = computeEMA(close, slow)
  const macd = close.map((_, i) => emaFast[i] - emaSlow[i])
  const sig  = computeEMA(macd, signal)
  const hist = macd.map((v, i) => v - sig[i])
  return { macd, signal: sig, hist }
}

function computeBollinger(close, period, stdDev = 2.0) {
  const mid = computeSMA(close, period)
  const std = rollingStd(close, period)
  const upper = mid.map((m, i) => (Number.isNaN(m) || Number.isNaN(std[i])) ? NaN : m + stdDev * std[i])
  const lower = mid.map((m, i) => (Number.isNaN(m) || Number.isNaN(std[i])) ? NaN : m - stdDev * std[i])
  return { mid, upper, lower }
}

function computeATR(high, low, close, period) {
  const n = close.length
  const tr = new Array(n).fill(NaN)
  for (let i = 0; i < n; i++) {
    if (i === 0) { tr[i] = high[i] - low[i]; continue }
    const hl = high[i] - low[i]
    const hc = Math.abs(high[i] - close[i - 1])
    const lc = Math.abs(low[i] - close[i - 1])
    tr[i] = Math.max(hl, hc, lc)
  }
  return ewm(tr, 1 / period)
}

function computeStochRSI(close, period, smoothK, smoothD) {
  const rsi = computeRSI(close, period)
  const n = rsi.length
  const stoch = new Array(n).fill(NaN)
  for (let i = period - 1; i < n; i++) {
    let mn = Infinity, mx = -Infinity, ok = true
    for (let j = i - period + 1; j <= i; j++) {
      const v = rsi[j]
      if (Number.isNaN(v)) { ok = false; break }
      if (v < mn) mn = v
      if (v > mx) mx = v
    }
    if (!ok) continue
    const denom = mx - mn
    stoch[i] = denom === 0 ? NaN : (rsi[i] - mn) / denom * 100
  }
  const k = rollingMean(stoch, smoothK)
  const d = rollingMean(k, smoothD)
  return { k, d }
}

function computeVWAP(high, low, close, volume) {
  const n = close.length
  const out = new Array(n).fill(NaN)
  let cumPV = 0, cumVol = 0
  for (let i = 0; i < n; i++) {
    const tp = (high[i] + low[i] + close[i]) / 3
    cumPV += tp * volume[i]
    cumVol += volume[i]
    out[i] = cumVol !== 0 ? cumPV / cumVol : NaN
  }
  return out
}

const SOURCE_SERIES = {
  VOLUME: (ohlcv) => ohlcv.volume,
  PRICE:  (ohlcv) => ohlcv.close,
  HIGH:   (ohlcv) => ohlcv.high,
  LOW:    (ohlcv) => ohlcv.low,
  OPEN:   (ohlcv) => ohlcv.open,
}

/**
 * Computes every column implied by `neededList` on `ohlcv`
 * ({open,high,low,close,volume}: parallel arrays of numbers) and returns a
 * flat { colName: number[] } map (NaN for not-yet-converged points - these
 * serialize to `null` in JSON automatically).
 */
function computeColumns(neededList, ohlcv) {
  const columns = {}
  const cache = new Map() // avoids recomputing MACD/BB/StochRSI once per requested sub-column

  for (const item of neededList) {
    const { indicator, period, source, settings } = item
    const meta = REGISTRY[indicator]
    if (!meta) continue
    const p = period || meta.params.period || 14

    if (["MACD", "MACD_SIGNAL", "MACD_HIST"].includes(indicator)) {
      const m = { ...meta.extra, ...(settings || {}) }
      const cacheKey = `MACD_${m.fast}_${m.slow}_${m.signal}`
      let res = cache.get(cacheKey)
      if (!res) {
        res = computeMACD(ohlcv.close, m.fast, m.slow, m.signal)
        cache.set(cacheKey, res)
      }
      columns[`MACD_${m.fast}_${m.slow}_${m.signal}`]           = res.macd
      columns[`MACD_signal_${m.fast}_${m.slow}_${m.signal}`]    = res.signal
      columns[`MACD_histogram_${m.fast}_${m.slow}_${m.signal}`] = res.hist
      continue
    }

    if (["BB_UPPER", "BB_LOWER", "BB_MID"].includes(indicator)) {
      const cacheKey = `BB_${p}`
      let res = cache.get(cacheKey)
      if (!res) { res = computeBollinger(ohlcv.close, p); cache.set(cacheKey, res) }
      columns[`BB_MID_${p}`]   = res.mid
      columns[`BB_UPPER_${p}`] = res.upper
      columns[`BB_LOWER_${p}`] = res.lower
      continue
    }

    if (["STOCH_RSI_K", "STOCH_RSI_D"].includes(indicator)) {
      const cacheKey = `STOCH_RSI_${p}`
      let res = cache.get(cacheKey)
      if (!res) { res = computeStochRSI(ohlcv.close, p, 3, 3); cache.set(cacheKey, res) }
      columns[`STOCH_RSI_K_${p}`] = res.k
      columns[`STOCH_RSI_D_${p}`] = res.d
      continue
    }

    const col = columnName(indicator, period, source, settings)
    if (!col || columns[col]) continue

    switch (indicator) {
      case "RSI": columns[col] = computeRSI(ohlcv.close, p); break
      case "ATR": columns[col] = computeATR(ohlcv.high, ohlcv.low, ohlcv.close, p); break
      case "VWAP": columns[col] = computeVWAP(ohlcv.high, ohlcv.low, ohlcv.close, ohlcv.volume); break
      case "EMA":
      case "SMA": {
        const srcArr = (source && SOURCE_SERIES[source]) ? SOURCE_SERIES[source](ohlcv) : ohlcv.close
        columns[col] = indicator === "EMA" ? computeEMA(srcArr, p) : computeSMA(srcArr, p)
        break
      }
      case "PRICE":  columns[col] = ohlcv.close; break
      case "VOLUME": columns[col] = ohlcv.volume; break
      case "HIGH":   columns[col] = ohlcv.high; break
      case "LOW":    columns[col] = ohlcv.low; break
      case "OPEN":   columns[col] = ohlcv.open; break
      default: break
    }
  }
  return columns
}

/**
 * Aligns an HTF-computed column onto the base timeframe's timestamps
 * (seconds), no look-ahead: each base candle sees the last HTF candle that
 * had fully closed at or before it. Mirrors _merge_htf_column() in backtest.py.
 * baseTimes/htfTimes must be sorted ascending, in seconds.
 */
function mergeHtfColumn(baseTimes, htfTimes, htfValues, htfTfMinutes) {
  const closeTimes = htfTimes.map(t => t + htfTfMinutes * 60)
  const out = new Array(baseTimes.length).fill(NaN)
  let j = -1
  for (let i = 0; i < baseTimes.length; i++) {
    const bt = baseTimes[i]
    while (j + 1 < closeTimes.length && closeTimes[j + 1] <= bt) j++
    out[i] = j >= 0 ? htfValues[j] : NaN
  }
  return out
}

module.exports = {
  TF_MINUTES, tfMinutes, REGISTRY,
  columnName, extractNeeded, warmupCandles,
  computeColumns, mergeHtfColumn,
}
