const { listCoins, listCategories, filterValidPairs } = require('../services/coinService')

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

module.exports = { listController, validatePairsController }