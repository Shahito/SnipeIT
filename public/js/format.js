// Adaptive decimals by magnitude - more decimals for small values (e.g. a
// $0.00001234 altcoin) and fewer for large ones (e.g. $65,000 BTC), instead
// of a single fixed .toFixed(n) that's wrong at one end of that range
// Shared by charts.js (results.html) and trade-chart.js (chart.html)
function _fmtAdaptive(v) {
  if (v === null || v === undefined || Number.isNaN(v)) return '-'
  const av = Math.abs(v)
  if (av >= 1000) return v.toFixed(1)
  if (av >= 10) return v.toFixed(2)
  if (av >= 1) return v.toFixed(3)
  if (av >= 0.01) return v.toFixed(4)
  if (av >= 0.0001) return v.toFixed(6)
  return v.toFixed(8)
}