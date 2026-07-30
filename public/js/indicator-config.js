/**
 * indicator-config.js
 * Shared indicator/operator constants for condition-renderer.js,
 * condition-settings.js, strategy-form.js, indicator-picker.js
 *
 * Adding a new indicator:
 * 1. Add id to INDICATORS
 * 2. Add it to INDICATOR_CATEGORIES in indicator-picker.js
 * 3. Needs a period? -> INDICATORS_WITH_PERIOD (+ INDICATOR_DEFAULT_PERIOD)
 * 4. Needs a source?  -> INDICATORS_WITH_SOURCES
 * 5. Needs extra params (like MACD fast/slow/signal)? -> INDICATOR_EXTRA_PARAMS
 * 6. Combine with another indicator shouldn't be allowed? -> INDICATORS_NO_COMBINE
 * 7. Add i18n keys, implement the calc in indicators.py
 */

const INDICATORS = [
  'RSI',
  'EMA',
  'SMA',
  'MACD',
  'MACD_SIGNAL',
  'MACD_HIST',
  'STOCH_RSI_K',
  'STOCH_RSI_D',
  'BB_UPPER',
  'BB_LOWER',
  'BB_MID',
  'ATR',
  'VWAP',
  'PRICE',
  'VOLUME',
  'HIGH',
  'LOW',
  'OPEN',
]

const OPERATORS = ['>', '<', '>=', '<=', '==', 'cross_above', 'cross_below']

const INDICATORS_WITH_PERIOD = [
  'RSI',
  'EMA',
  'SMA',
  'STOCH_RSI_K',
  'STOCH_RSI_D',
  'BB_UPPER',
  'BB_LOWER',
  'BB_MID',
  'ATR',
]

const INDICATORS_WITH_SOURCES = ['EMA', 'SMA']

const INDICATOR_SOURCES = ['VOLUME', 'HIGH', 'LOW', 'OPEN']

// Default period per indicator, mirrors REGISTRY[x]["params"]["period"] in
// indicators.py. Anything not listed here falls back to 14
const INDICATOR_DEFAULT_PERIOD = {
  RSI: 14,
  EMA: 20,
  SMA: 20,
  STOCH_RSI_K: 14,
  STOCH_RSI_D: 14,
  BB_UPPER: 20,
  BB_LOWER: 20,
  BB_MID: 20,
  ATR: 14,
}

// Extra numeric params beyond period/source, e.g. MACD's fast/slow/signal
// `key` must match indicators.py's REGISTRY[x]["extra_params"] key
const INDICATOR_EXTRA_PARAMS = {
  MACD: [
    { key: 'fast',   labelKey: 'settings.macd.fast',   default: 12, min: 1, max: 200 },
    { key: 'slow',   labelKey: 'settings.macd.slow',   default: 26, min: 1, max: 200 },
    { key: 'signal', labelKey: 'settings.macd.signal', default: 9,  min: 1, max: 200 },
  ],
}
INDICATOR_EXTRA_PARAMS.MACD_SIGNAL = INDICATOR_EXTRA_PARAMS.MACD
INDICATOR_EXTRA_PARAMS.MACD_HIST   = INDICATOR_EXTRA_PARAMS.MACD

// Must stay in sync with the #fTimeframeGroup chip list (TIMEFRAMES_LIST in
// strategy-form.js) in strategy-editor.html.
// condition-settings.js filters this down to >= getPrimaryTimeframe()
const TIMEFRAMES = [
  { value: '1m',  minutes: 1 },
  { value: '5m',  minutes: 5 },
  { value: '15m', minutes: 15 },
  { value: '30m', minutes: 30 },
  { value: '1h',  minutes: 60 },
  { value: '2h',  minutes: 120 },
  { value: '4h',  minutes: 240 },
  { value: '6h',  minutes: 360 },
  { value: '12h', minutes: 720 },
  { value: '1d',  minutes: 1440 },
  { value: '3d',  minutes: 4320 },
  { value: '1w',  minutes: 10080 },
]

// Indicators for which "combine with" isn't offered (UI-only restriction)
const INDICATORS_NO_COMBINE = ['RSI', 'STOCH_RSI_K', 'STOCH_RSI_D']

// Default indicator pre-filled when "combine with" is first checked
const DEFAULT_COMBINE_INDICATOR = 'PRICE'