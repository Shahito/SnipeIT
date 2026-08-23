'use strict'

function diffArr(arr) {
  const out = new Array(arr.length).fill(NaN)
  for (let i = 1; i < arr.length; i++) out[i] = arr[i] - arr[i - 1]
  return out
}

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
function rollingStd(values, period) {
  const out = new Array(values.length).fill(NaN)
  for (let i = period - 1; i < values.length; i++) {
    let ok = true, mean = 0
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

module.exports = {
  diffArr, ewmAlpha, ewmSpan, rollingMean, rollingStd, rollingMin, rollingMax,
  computeRSI, computeEMA, computeSMA, computeMACD, computeBB, computeATR, computeStochRSI, computeVWAP,
}