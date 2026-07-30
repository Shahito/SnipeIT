const { CATEGORIES, categoryOf, nameOf } = require('../config/coinCategories')

const BINANCE_EXCHANGE_INFO_URL = 'https://api.binance.com/api/v3/exchangeInfo'
const CACHE_TTL_MS = 6 * 60 * 60 * 1000 // 6h - la liste des paires tradables ne bouge pas souvent

let _cache = { symbols: null, fetchedAt: 0 }

// { symbol: "BTCUSDT", base: "BTC", quote: "USDT" }[] - uniquement les paires
// actuellement tradables (status TRADING) sur Binance.
async function getTradingSymbols() {
  if (_cache.symbols && Date.now() - _cache.fetchedAt < CACHE_TTL_MS) return _cache.symbols

  try {
    const res = await fetch(BINANCE_EXCHANGE_INFO_URL)
    if (!res.ok) throw new Error(`Binance API ${res.status}`)
    const json = await res.json()
    const symbols = json.symbols
      .filter(s => s.status === 'TRADING')
      .map(s => ({ symbol: s.symbol, base: s.baseAsset, quote: s.quoteAsset }))
    _cache = { symbols, fetchedAt: Date.now() }
    return symbols
  } catch (e) {
    console.error('[coinService] Binance exchangeInfo fetch failed:', e.message)
    // Si on a un cache même périmé, mieux vaut le servir que planter la page.
    if (_cache.symbols) return _cache.symbols
    throw new Error('COIN_LIST_UNAVAILABLE')
  }
}

// Coins uniques (côté base ET quote confondus) disponibles sur Binance,
// enrichis de leur nom/catégorie connus (coinCategories.js). Un coin non
// répertorié dans coinCategories.js apparaît quand même, juste sans nom ni
// catégorie (category: null -> "Non catégorisé" côté sweep-results).
async function listCoins() {
  const symbols = await getTradingSymbols()
  const assets = new Set()
  symbols.forEach(s => { assets.add(s.base); assets.add(s.quote) })
  return [...assets].sort().map(symbol => ({
    symbol,
    name: nameOf(symbol),
    category: categoryOf(symbol),
  }))
}

async function listCategories() {
  return CATEGORIES
}

// Filtre un ensemble de paires "BASE/QUOTE" candidates (ex: générées par
// produit cartésien base×quote côté front) pour ne garder que celles qui
// existent réellement sur Binance.
async function filterValidPairs(pairs) {
  const symbols = await getTradingSymbols()
  const validSet = new Set(symbols.map(s => s.symbol))
  return pairs.filter(p => validSet.has(p.replace('/', '')))
}

module.exports = { getTradingSymbols, listCoins, listCategories, filterValidPairs }