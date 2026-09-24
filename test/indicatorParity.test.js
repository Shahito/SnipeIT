// Verifies that src/utils/indicatorEngine.js (JS - used by candleController.js
// for the /candles API and by public/js/trade-chart.js to render the chart)
// and python/indicators.py (the actual backtest engine) produce the same
// values on the same fixed candle set (test/fixtures/candles.json).
//
// indicatorEngine.js is the ONLY JS indicator implementation in this project
// (a second, unused one - src/utils/indicatorMath.js - existed until it was
// removed for being dead code, wired to no route). This test exists so that
// what the chart shows the user is provably the same thing the backtest saw.
//
// Usage: node test/indicatorParity.test.js
'use strict'

const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')
const engine = require('../src/utils/indicatorEngine')

const ABS_TOL = 1e-6
const REL_TOL = 1e-9

function close(a, b) {
  if (a === null && b === null) return true
  if (a === null || b === null) return false
  const diff = Math.abs(a - b)
  return diff <= ABS_TOL || diff <= REL_TOL * Math.max(Math.abs(a), Math.abs(b))
}

function toNullArr(arr) {
  return arr.map(v => (v === undefined || Number.isNaN(v) ? null : v))
}

function compareColumn(name, jsArr, pyArr) {
  if (!pyArr) return [`column "${name}" missing on the Python side`]
  if (jsArr.length !== pyArr.length) {
    return [`column "${name}": length mismatch (JS=${jsArr.length}, PY=${pyArr.length})`]
  }
  const errors = []
  for (let i = 0; i < jsArr.length; i++) {
    if (!close(jsArr[i], pyArr[i])) {
      errors.push(`column "${name}" @ idx ${i}: JS=${jsArr[i]} PY=${pyArr[i]}`)
      if (errors.length >= 5) { errors.push(`... (further mismatches for "${name}" truncated)`); break }
    }
  }
  return errors
}

function main() {
  const candles = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/candles.json'), 'utf8'))
  // epoch seconds, as produced by candleController.js's toOhlcvArrays()
  const time = candles.map(c => Math.floor(new Date(c.timestamp).getTime() / 1000))
  const close_ = candles.map(c => c.close)
  const high = candles.map(c => c.high)
  const low = candles.map(c => c.low)
  const volume = candles.map(c => c.volume)

  const pyRaw = execFileSync('python3', [path.join(__dirname, '../python/parity_export.py')], { maxBuffer: 50 * 1024 * 1024 })
  const py = JSON.parse(pyRaw.toString())

  const results = {}

  results['RSI_14'] = toNullArr(engine.computeRSI(close_, 14))
  results['EMA_20'] = toNullArr(engine.computeEMA(close_, 20))
  results['EMA_VOLUME_20'] = toNullArr(engine.computeEMA(volume, 20))
  results['SMA_20'] = toNullArr(engine.computeSMA(close_, 20))
  results['SMA_VOLUME_20'] = toNullArr(engine.computeSMA(volume, 20))

  const macd = engine.computeMACD(close_, 12, 26, 9)
  results['MACD_12_26_9'] = toNullArr(macd.macd)
  results['MACD_signal_12_26_9'] = toNullArr(macd.signal)
  results['MACD_histogram_12_26_9'] = toNullArr(macd.hist)

  const bb = engine.computeBollinger(close_, 20, 2.0)
  results['BB_MID_20'] = toNullArr(bb.mid)
  results['BB_UPPER_20'] = toNullArr(bb.upper)
  results['BB_LOWER_20'] = toNullArr(bb.lower)

  results['ATR_14'] = toNullArr(engine.computeATR(high, low, close_, 14))

  const stoch = engine.computeStochRSI(close_, 14, 3, 3)
  results['STOCH_RSI_K_14'] = toNullArr(stoch.k)
  results['STOCH_RSI_D_14'] = toNullArr(stoch.d)

  results['VWAP'] = toNullArr(engine.computeVWAP(time, high, low, close_, volume))

  let allErrors = []
  for (const [name, jsArr] of Object.entries(results)) {
    allErrors = allErrors.concat(compareColumn(name, jsArr, py[name]))
  }

  if (allErrors.length) {
    console.error(`❌ JS/Python parity FAILED - ${allErrors.length} mismatch(es):\n`)
    allErrors.forEach(e => console.error('  ' + e))
    process.exit(1)
  }

  console.log(`✅ JS/Python parity OK - ${Object.keys(results).length} indicators, ${candles.length} candles, tolerance ${ABS_TOL}`)
}

main()