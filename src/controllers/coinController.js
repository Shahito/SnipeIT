const { listCoins, listCategories, filterValidPairs } = require('../services/coinService')

async function listController(req, res) {
  try {
    const [coins, categories] = await Promise.all([listCoins(), listCategories()])
    res.json({ coins, categories })
  } catch (e) {
    res.status(502).json({ error: e.message === 'COIN_LIST_UNAVAILABLE' ? 'COIN_LIST_UNAVAILABLE' : 'UNKNOWN' })
  }
}

// Utilisé par le front pour ne garder, parmi le produit cartésien base×quote
// choisi dans le picker, que les paires qui existent vraiment sur Binance.
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