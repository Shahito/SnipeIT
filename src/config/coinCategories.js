/**
 * Fixed registry of coin categories - edit manually to add
 * a known coin to a category (like INDICATOR_CATEGORIES on the front end,
 * public/js/indicator-picker.js). This is NOT a user-facing CRUD.
 *
 * The list of coins ACTUALLY available (i.e. shown in the picker and
 * offered for sweeps) comes live from the Binance API (see coinService.js),
 * not from this file. This file only categorizes and names known
 * coins; any coin listed by Binance but missing here simply falls
 * into "Uncategorized" (already handled by sweepService.getSweepGroup).
 *
 * category: one of the keys of CATEGORIES below.
 */

const CATEGORIES = [
  { key: 'layer1', label: 'Layer 1' },
  { key: 'layer2', label: 'Layer 2' },
  { key: 'defi', label: 'DeFi' },
  { key: 'meme', label: 'Meme' },
  { key: 'stablecoin', label: 'Stablecoin' },
  { key: 'exchange', label: 'Exchange Token' },
  { key: 'ai', label: 'AI' },
  { key: 'gaming', label: 'Gaming / Metaverse' },
  { key: 'infra', label: 'Infrastructure / Oracle' },
]

// symbol -> { name, category }
const COINS = {
  BTC: { name: 'Bitcoin', category: 'layer1' },
  ETH: { name: 'Ethereum', category: 'layer1' },
  SOL: { name: 'Solana', category: 'layer1' },
  AVAX: { name: 'Avalanche', category: 'layer1' },
  ADA: { name: 'Cardano', category: 'layer1' },
  DOT: { name: 'Polkadot', category: 'layer1' },
  NEAR: { name: 'NEAR Protocol', category: 'layer1' },
  APT: { name: 'Aptos', category: 'layer1' },
  SUI: { name: 'Sui', category: 'layer1' },
  TON: { name: 'Toncoin', category: 'layer1' },
  ATOM: { name: 'Cosmos', category: 'layer1' },
  ALGO: { name: 'Algorand', category: 'layer1' },
  TAO: { name: 'Bittensor', category: 'ai' },

  ARB: { name: 'Arbitrum', category: 'layer2' },
  OP: { name: 'Optimism', category: 'layer2' },
  MATIC: { name: 'Polygon', category: 'layer2' },
  STRK: { name: 'Starknet', category: 'layer2' },

  UNI: { name: 'Uniswap', category: 'defi' },
  AAVE: { name: 'Aave', category: 'defi' },
  LDO: { name: 'Lido DAO', category: 'defi' },
  MKR: { name: 'Maker', category: 'defi' },
  CRV: { name: 'Curve DAO', category: 'defi' },
  COMP: { name: 'Compound', category: 'defi' },
  SUSHI: { name: 'SushiSwap', category: 'defi' },

  DOGE: { name: 'Dogecoin', category: 'meme' },
  SHIB: { name: 'Shiba Inu', category: 'meme' },
  PEPE: { name: 'Pepe', category: 'meme' },
  WIF: { name: 'dogwifhat', category: 'meme' },
  FLOKI: { name: 'Floki', category: 'meme' },
  BONK: { name: 'Bonk', category: 'meme' },
  TRUMP: { name: 'Official Trump', category: 'meme' },

  USDT: { name: 'Tether', category: 'stablecoin' },
  USDC: { name: 'USD Coin', category: 'stablecoin' },
  DAI: { name: 'Dai', category: 'stablecoin' },
  FDUSD: { name: 'First Digital USD', category: 'stablecoin' },
  TUSD: { name: 'TrueUSD', category: 'stablecoin' },

  BNB: { name: 'BNB', category: 'exchange' },
  OKB: { name: 'OKB', category: 'exchange' },
  CRO: { name: 'Cronos', category: 'exchange' },

  FET: { name: 'Artificial Superintelligence Alliance', category: 'ai' },
  RENDER: { name: 'Render', category: 'ai' },
  WLD: { name: 'Worldcoin', category: 'ai' },

  SAND: { name: 'The Sandbox', category: 'gaming' },
  AXS: { name: 'Axie Infinity', category: 'gaming' },
  GALA: { name: 'Gala', category: 'gaming' },
  IMX: { name: 'Immutable', category: 'gaming' },

  LINK: { name: 'Chainlink', category: 'infra' },
  FIL: { name: 'Filecoin', category: 'infra' },
  GRT: { name: 'The Graph', category: 'infra' },
  RUNE: { name: 'THORChain', category: 'infra' },

  XRP: { name: 'XRP', category: 'layer1' },
  LTC: { name: 'Litecoin', category: 'layer1' },
  BCH: { name: 'Bitcoin Cash', category: 'layer1' },
  TRX: { name: 'TRON', category: 'layer1' },
}

function categoryOf(symbol) {
  return COINS[symbol]?.category || null
}

function nameOf(symbol) {
  return COINS[symbol]?.name || symbol
}

module.exports = { CATEGORIES, COINS, categoryOf, nameOf }