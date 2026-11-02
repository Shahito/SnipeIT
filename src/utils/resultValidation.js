// Strict checks on what a worker sends back before anything is persisted

const FLOAT_FIELDS = [
  'pnlPercent', 'pnlAbsolute', 'finalCapital', 'initialCapital',
  'winRate', 'maxDrawdown', 'sharpeRatio', 'profitFactor',
]
const INT_FIELDS = ['totalTrades', 'durationDays']
const STATS_FIELDS = ['sharpe', 'skew', 'kurtosis', 'obs', 'periodsPerYear']
const INT32_MAX = 2147483647
const MAX_ERROR_LEN = 2000

const isFinite_ = (v) => typeof v === 'number' && Number.isFinite(v)
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

// Returns null when valid, otherwise a short reason
function validateResultPayload({ success, result, errorMessage }) {
  if (typeof success !== 'boolean') return 'success must be a boolean'

  if (!success) {
    if (errorMessage != null && typeof errorMessage !== 'string') return 'errorMessage must be a string'
    return null
  }

  if (!isPlainObject(result)) return 'result must be an object'

  for (const f of FLOAT_FIELDS) {
    if (result[f] != null && !isFinite_(result[f])) return `${f} must be a finite number`
  }
  if (result.winRate != null && (result.winRate < 0 || result.winRate > 100)) return 'winRate must be between 0 and 100'
  if (result.maxDrawdown != null && result.maxDrawdown < 0) return 'maxDrawdown must be non-negative'
  if (result.profitFactor != null && result.profitFactor < 0) return 'profitFactor must be non-negative'

  for (const f of INT_FIELDS) {
    const v = result[f]
    if (v != null && (!Number.isInteger(v) || v < 0 || v > INT32_MAX)) return `${f} must be a non-negative integer`
  }

  const rs = result.returnStats
  if (rs != null) {
    if (!isPlainObject(rs)) return 'returnStats must be an object'
    for (const f of STATS_FIELDS) {
      if (rs[f] != null && !isFinite_(rs[f])) return `returnStats.${f} must be a finite number`
    }
    if (rs.obs != null && (!Number.isInteger(rs.obs) || rs.obs < 0)) return 'returnStats.obs must be a non-negative integer'
    if (rs.periodsPerYear != null && rs.periodsPerYear <= 0) return 'returnStats.periodsPerYear must be positive'
  }

  return null
}

module.exports = { validateResultPayload, MAX_ERROR_LEN }