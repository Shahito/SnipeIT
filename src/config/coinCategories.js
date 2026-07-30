/**
 * Registre fixe des catégories de coins - à éditer manuellement pour ajouter
 * un coin connu à une catégorie (comme INDICATOR_CATEGORIES côté front,
 * public/js/indicator-picker.js). Ce n'est PAS un CRUD utilisateur.
 *
 * La liste des coins RÉELLEMENT disponibles (donc affichés dans le picker et
 * proposés au sweep) vient de l'API Binance en direct (voir coinService.js),
 * pas de ce fichier. Ce fichier ne fait que catégoriser + nommer les coins
 * connus ; tout coin listé par Binance mais absent d'ici tombe simplement
 * dans "Non catégorisé" (déjà géré par sweepService.getSweepGroup).
 *
 * category: une des clés de CATEGORIES ci-dessous.
 */

const CATEGORIES = [
  { key: 'layer1',      label: 'Layer 1' },
  { key: 'layer2',      label: 'Layer 2' },
  { key: 'defi',        label: 'DeFi' },
  { key: 'meme',        label: 'Meme' },
  { key: 'stablecoin',  label: 'Stablecoin' },
  { key: 'exchange',    label: 'Exchange Token' },
  { key: 'ai',          label: 'AI' },
  { key: 'gaming',      label: 'Gaming / Metaverse' },
  { key: 'infra',       label: 'Infrastructure / Oracle' },
]

// symbol -> { name, category }
const COINS = {
  BTC:   { name: 'Bitcoin',        category: 'layer1' },
  ETH:   { name: 'Ethereum',       category: 'layer1' },
  SOL:   { name: 'Solana',         category: 'layer1' },
  AVAX:  { name: 'Avalanche',      category: 'layer1' },
  ADA:   { name: 'Cardano',        category: 'layer1' },
  DOT:   { name: 'Polkadot',       category: 'layer1' },
  NEAR:  { name: 'NEAR Protocol',  category: 'layer1' },
  APT:   { name: 'Aptos',          category: 'layer1' },
  SUI:   { name: 'Sui',            category: 'layer1' },
  TON:   { name: 'Toncoin',        category: 'layer1' },
  ATOM:  { name: 'Cosmos',         category: 'layer1' },
  ALGO:  { name: 'Algorand',       category: 'layer1' },
  TAO:   { name: 'Bittensor',      category: 'ai' },

  ARB:   { name: 'Arbitrum',       category: 'layer2' },
  OP:    { name: 'Optimism',       category: 'layer2' },
  MATIC: { name: 'Polygon',        category: 'layer2' },
  STRK:  { name: 'Starknet',       category: 'layer2' },

  UNI:   { name: 'Uniswap',        category: 'defi' },
  AAVE:  { name: 'Aave',           category: 'defi' },
  LDO:   { name: 'Lido DAO',       category: 'defi' },
  MKR:   { name: 'Maker',          category: 'defi' },
  CRV:   { name: 'Curve DAO',      category: 'defi' },
  COMP:  { name: 'Compound',       category: 'defi' },
  SUSHI: { name: 'SushiSwap',      category: 'defi' },

  DOGE:  { name: 'Dogecoin',       category: 'meme' },
  SHIB:  { name: 'Shiba Inu',      category: 'meme' },
  PEPE:  { name: 'Pepe',           category: 'meme' },
  WIF:   { name: 'dogwifhat',      category: 'meme' },
  FLOKI: { name: 'Floki',          category: 'meme' },
  BONK:  { name: 'Bonk',           category: 'meme' },

  USDT:  { name: 'Tether',         category: 'stablecoin' },
  USDC:  { name: 'USD Coin',       category: 'stablecoin' },
  DAI:   { name: 'Dai',            category: 'stablecoin' },
  FDUSD: { name: 'First Digital USD', category: 'stablecoin' },
  TUSD:  { name: 'TrueUSD',        category: 'stablecoin' },

  BNB:   { name: 'BNB',            category: 'exchange' },
  OKB:   { name: 'OKB',            category: 'exchange' },
  CRO:   { name: 'Cronos',         category: 'exchange' },

  FET:   { name: 'Artificial Superintelligence Alliance', category: 'ai' },
  RENDER:{ name: 'Render',         category: 'ai' },
  WLD:   { name: 'Worldcoin',      category: 'ai' },

  SAND:  { name: 'The Sandbox',    category: 'gaming' },
  AXS:   { name: 'Axie Infinity',  category: 'gaming' },
  GALA:  { name: 'Gala',           category: 'gaming' },
  IMX:   { name: 'Immutable',      category: 'gaming' },

  LINK:  { name: 'Chainlink',      category: 'infra' },
  FIL:   { name: 'Filecoin',       category: 'infra' },
  GRT:   { name: 'The Graph',      category: 'infra' },
  RUNE:  { name: 'THORChain',      category: 'infra' },

  XRP:   { name: 'XRP',            category: 'infra' },
  LTC:   { name: 'Litecoin',       category: 'layer1' },
  BCH:   { name: 'Bitcoin Cash',   category: 'layer1' },
  TRX:   { name: 'TRON',           category: 'layer1' },
}

function categoryOf(symbol) {
  return COINS[symbol]?.category || null
}

function nameOf(symbol) {
  return COINS[symbol]?.name || symbol
}

module.exports = { CATEGORIES, COINS, categoryOf, nameOf }