// Chart instances
// To add a new line chart: instantiate a new CanvasLineChart here.
// To add a new bar chart: instantiate a new HorizontalBarChart here.

const equityChart = new CanvasLineChart('equityChart', {
  togglesContainerId: 'equityChartToggles',
  getTimestamps: r => (r.equityCurve || []).map(p => p.t * 1000),
  formatDate:    ts => fmtDate(ts),
  formatTooltipDate: ts => fmtDate(ts),
  curves: [
    {
      key:          'equity',
      i18nKey:      'results.equity_chart.equity',
      getData:      r => (r.equityCurve || []).map(p => p.e),
      axis:         'left',
      prefix:       '$',
      dynamic:      true, // auto green/red based on perf
      lineWidth:    2,
    },
    // {
    //   key:          'pnl',
    //   i18nKey:      'results.equity_chart.pnl',
    //   getData:      r => (r.pnlCurve || []).map(p => p.p),
    //   axis:         'right',
    //   color:        'rgb(200,120,255,0.8)',
    //   prefix:       '%',
    //   lineWidth:    2,
    // },
    {
      key:          'price',
      i18nKey:      'results.equity_chart.price',
      getData:      r => (r.priceCurve || []).map(p => p.c),
      axis:         'right',
      color:        'rgba(108,142,255,0.8)',
      fillColor:    null,
      lineWidth:    1.5,
    },
  ],
})

// Exit reasons
const exitReasonsChart = new BarChart('exitReasonsChart', 'exitReasonsFilters', {
  getBars:   r => r.exitReasons || {},
  getLabel:  (k, d) => ({ title: { risk: 'TP/SL', signal: 'Signal', tsl: 'Trailing SL', end: 'End' }[k], sub: `${d.totalPct}% of trades` }),
  order:     ['risk', 'tsl', 'signal', 'end'],
  defaultActive: key => key !== 'end',
  segments: [
    { key: 'win',  getValue: d => d.winPct,  suffix: '%', color: 'var(--success)' },
    { key: 'loss', getValue: d => d.lossPct, suffix: '%', color: 'var(--danger)'  },
  ],
})

const PNL_DISTRIBUTION_MIN_TRADES = 20 // en dessous, la plupart des barres seraient des singletons
// PnL distribution
const pnlDistributionChart = new CanvasHistogram('pnlDistributionCanvas', {
  getBuckets: r => (r.totalTrades >= PNL_DISTRIBUTION_MIN_TRADES) ? r.pnlBuckets : [],
})

// MAE distribution + scatter (winning trades only) - toggle between % of
// entry and ATR units. Both share the same minimum sample size: below it,
// neither chart is reliable, so the whole MAE pair hides together rather
// than showing a half-empty histogram next to a missing scatter.
const MAE_MIN_WINS = 8
let _maeUnit = 'pct'
const maeDistributionChart = new CanvasHistogram('maeDistributionCanvas', {
  getBuckets: r => {
    const b = (_maeUnit === 'atr' ? r.maeBucketsAtr : r.maeBuckets) || []
    const winCount = b.reduce((sum, bucket) => sum + bucket.count, 0)
    return winCount >= MAE_MIN_WINS ? b : []
  },
  singleColor:    _cssVar('--primary'),
  singleColorDim: _cssVar('--primary-dim'),
  labelSuffix:    '%',
  labelDecimals:  1,
})

// Same color key used everywhere else on this page for exit reasons
// (exitReasonsFilters buttons), so a given reason always looks the same.
const REASON_COLORS = { risk: '#6c8eff', tsl: '#c878ff', signal: '#ff9632', end: '#aaa', unknown: '#5A5F73' }
const REASON_LABELS = { risk: 'TP/SL', signal: 'Signal', tsl: 'Trailing SL', end: 'End', unknown: 'No data' }
const DEFAULT_POINT_COLOR = _cssVar('--primary') || '#6c8eff'

function _renderReasonLegend(containerId) {
  const el = document.getElementById(containerId)
  if (!el) return
  el.innerHTML = Object.entries(REASON_LABELS)
    .map(([key, label]) => `<span class="scatter-legend-item"><span class="scatter-legend-dot" style="background:${REASON_COLORS[key]}"></span>${label}</span>`)
    .join('')
}

// MAE vs PnL scatter (winning trades only) - shares the % / ATR toggle above,
// since it's the same underlying dimension (pain endured) just plotted
// against the reward instead of counted. Points are colored by exit reason.
let _maeColorByReason = true
const maeScatterChart = new CanvasScatter('maeScatterCanvas', {
  getPoints:      r => (_maeUnit === 'atr' ? r.maeScatterAtr : r.maeScatter) || [],
  labelSuffixX:   '%',
  labelSuffixY:   '%',
  labelDecimalsX: 1,
  labelDecimalsY: 1,
  getColor:       p => _maeColorByReason ? (REASON_COLORS[p.reason] || REASON_COLORS.unknown) : DEFAULT_POINT_COLOR,
  tooltip:        p => `<span>MAE : <strong>${p.x}${_maeUnit === 'atr' ? 'R' : '%'}</strong></span><span>PnL : <strong>${p.y}%</strong></span><span>${REASON_LABELS[p.reason] || REASON_LABELS.unknown}</span>`,
})
_renderReasonLegend('maeScatterLegend')

function setMaeColorByReason(enabled) {
  _maeColorByReason = enabled
  document.getElementById('maeToggleColorReason').classList.toggle('active', enabled)
  document.getElementById('maeScatterLegend').style.display = enabled ? '' : 'none'
  maeScatterChart.render(maeScatterChart._result)
}
document.getElementById('maeToggleColorReason').addEventListener('click', () => setMaeColorByReason(!_maeColorByReason))

function setMaeUnit(unit) {
  _maeUnit = unit
  maeDistributionChart.config.labelSuffix   = unit === 'atr' ? 'R' : '%'
  maeDistributionChart.config.labelDecimals = unit === 'atr' ? 2 : 1
  maeScatterChart.config.labelSuffixX       = unit === 'atr' ? 'R' : '%'
  maeScatterChart.config.labelDecimalsX     = unit === 'atr' ? 2 : 1
  document.getElementById('maeToggleUnitPct').classList.toggle('active', unit === 'pct')
  document.getElementById('maeToggleUnitAtr').classList.toggle('active', unit === 'atr')
  maeDistributionChart.render(maeDistributionChart._result)
  maeScatterChart.render(maeScatterChart._result)
}
document.getElementById('maeToggleUnitPct').addEventListener('click', () => setMaeUnit('pct'))
document.getElementById('maeToggleUnitAtr').addEventListener('click', () => setMaeUnit('atr'))

// MFE distribution (losing trades only) - inverse of MAE, same % / ATR toggle pattern
let _mfeUnit = 'pct'
const mfeDistributionChart = new CanvasHistogram('mfeDistributionCanvas', {
  getBuckets:     r => (_mfeUnit === 'atr' ? r.mfeBucketsAtr : r.mfeBuckets) || [],
  singleColor:    _cssVar('--primary'),
  singleColorDim: _cssVar('--primary-dim'),
  labelSuffix:    '%',
  labelDecimals:  1,
})

// MFE vs PnL scatter (losing trades only) - points colored by exit reason
let _mfeColorByReason = true
const mfeScatterChart = new CanvasScatter('mfeScatterCanvas', {
  getPoints:      r => (_mfeUnit === 'atr' ? r.mfeScatterAtr : r.mfeScatter) || [],
  labelSuffixX:   '%',
  labelSuffixY:   '%',
  labelDecimalsX: 1,
  labelDecimalsY: 1,
  yAxisSide:      'left', // domaine X toujours >= 0 (MFE)
  getColor:       p => _mfeColorByReason ? (REASON_COLORS[p.reason] || REASON_COLORS.unknown) : DEFAULT_POINT_COLOR,
  tooltip:        p => `<span>MFE : <strong>${p.x}${_mfeUnit === 'atr' ? 'R' : '%'}</strong></span><span>PnL : <strong>${p.y}%</strong></span><span>${REASON_LABELS[p.reason] || REASON_LABELS.unknown}</span>`,
})
_renderReasonLegend('mfeScatterLegend')

function setMfeColorByReason(enabled) {
  _mfeColorByReason = enabled
  document.getElementById('mfeToggleColorReason').classList.toggle('active', enabled)
  document.getElementById('mfeScatterLegend').style.display = enabled ? '' : 'none'
  mfeScatterChart.render(mfeScatterChart._result)
}
document.getElementById('mfeToggleColorReason').addEventListener('click', () => setMfeColorByReason(!_mfeColorByReason))

function setMfeUnit(unit) {
  _mfeUnit = unit
  mfeDistributionChart.config.labelSuffix   = unit === 'atr' ? 'R' : '%'
  mfeDistributionChart.config.labelDecimals = unit === 'atr' ? 2 : 1
  mfeScatterChart.config.labelSuffixX       = unit === 'atr' ? 'R' : '%'
  mfeScatterChart.config.labelDecimalsX     = unit === 'atr' ? 2 : 1
  document.getElementById('mfeToggleUnitPct').classList.toggle('active', unit === 'pct')
  document.getElementById('mfeToggleUnitAtr').classList.toggle('active', unit === 'atr')
  mfeDistributionChart.render(mfeDistributionChart._result)
  mfeScatterChart.render(mfeScatterChart._result)
}
document.getElementById('mfeToggleUnitPct').addEventListener('click', () => setMfeUnit('pct'))
document.getElementById('mfeToggleUnitAtr').addEventListener('click', () => setMfeUnit('atr'))

const MONTHLY_PERF_MIN_MONTHS = 4
const monthlyChart = new MonthlyPerfChart('monthlyPerfCanvas', {
  getData: r => (r.monthlyPerf?.length >= MONTHLY_PERF_MIN_MONTHS) ? r.monthlyPerf : [],
  showDelta: true,
  // height: 220,
})
document.getElementById('mpfToggleDelta').classList.toggle('active', monthlyChart._showDelta)

// Resize handler - redraw all CanvasLineChart instances
let _resizeTimer
window.addEventListener('resize', () => {
  clearTimeout(_resizeTimer)
  _resizeTimer = setTimeout(() => equityChart.render(equityChart._result), 150)
})

// Monthly chart toggle handlers
document.getElementById('mpfToggleTrades').addEventListener('click', (e) => {
  monthlyChart.toggleTrades()
  e.currentTarget.classList.toggle('active', monthlyChart._showTrades)
})
document.getElementById('mpfToggleDelta').addEventListener('click', (e) => {
  monthlyChart.toggleDelta()
  e.currentTarget.classList.toggle('active', monthlyChart._showDelta)
})