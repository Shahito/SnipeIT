const { listCoins, listCategories, filterValidPairs } = require('../services/coinService')
const { fetchKlines, pairToSymbol } = require('./candleController')
const { TF_MINUTES, computeATR } = require('../utils/indicatorEngine')

async function listController(req, res) {
  try {
    const [coins, categories] = await Promise.all([listCoins(), listCategories()])
    res.json({ coins, categories })
  } catch (e) {
    res.status(502).json({ error: e.message === 'COIN_LIST_UNAVAILABLE' ? 'COIN_LIST_UNAVAILABLE' : 'UNKNOWN' })
  }
}

// Used by the front end to keep, out of the base×quote cartesian product
// chosen in the picker, only the pairs that actually exist on Binance.
async function validatePairsController(req, res) {
  try {
    const { pairs } = req.body
    if (!Array.isArray(pairs)) return res.status(400).json({ error: 'PAIRS_INVALID' })
    const valid = await filterValidPairs(pairs)
    res.json({ valid, invalid: pairs.filter(p => !valid.includes(p)) })
  } catch (e) {
    res.status(502).json({ error: e.message === 'COIN_LIST_UNAVAILABLE' ? 'COIN_LIST_UNAVAILABLE' : 'UNKNOWN' })
  }
}

// Recent ATR as a % of price: indicative only, gives the exits slider a realistic axis
const ATR_REF_TTL_MS = 10 * 60 * 1000
const ATR_REF_MAX_CANDLES = 1000 // one Binance call
const _atrRefCache = new Map()

async function atrRefController(req, res) {
  try {
    const pair = String(req.query.pair || '')
    const timeframe = String(req.query.timeframe || '')
    const period = parseInt(req.query.period || '14', 10)
    if (!/^[A-Z0-9]+\/[A-Z0-9]+$/.test(pair)) return res.status(400).json({ error: 'PAIRS_INVALID' })
    if (!TF_MINUTES[timeframe]) return res.status(400).json({ error: 'TIMEFRAME_INVALID' })
    if (!Number.isInteger(period) || period < 1 || period > 200) return res.status(400).json({ error: 'ATR_PERIOD_INVALID' })

    const key = `${pair}|${timeframe}|${period}`
    const hit = _atrRefCache.get(key)
    if (hit && Date.now() - hit.at < ATR_REF_TTL_MS) return res.json(hit.value)

    const tfMs = TF_MINUTES[timeframe] * 60 * 1000
    const n = Math.min(period * 6 + 20, ATR_REF_MAX_CANDLES)
    const endMs = Date.now()
    const raw = await fetchKlines(pairToSymbol(pair), timeframe, endMs - n * tfMs, endMs)
    if (raw.length < period + 2) return res.status(404).json({ error: 'NO_DATA' })

    const high = raw.map(k => parseFloat(k[2]))
    const low = raw.map(k => parseFloat(k[3]))
    const close = raw.map(k => parseFloat(k[4]))
    // Drop the last (still forming) candle
    const atr = computeATR(high.slice(0, -1), low.slice(0, -1), close.slice(0, -1), period)
    const last = atr[atr.length - 1]
    const price = close[close.length - 2]
    if (!Number.isFinite(last) || !(price > 0)) return res.status(404).json({ error: 'NO_DATA' })

    const value = { pair, timeframe, period, atrPct: Math.round((last / price) * 10000) / 100 }
    _atrRefCache.set(key, { at: Date.now(), value })
    res.json(value)
  } catch (e) {
    res.status(502).json({ error: 'UNKNOWN' })
  }
}

module.exports = { listController, validatePairsController, atrRefController }