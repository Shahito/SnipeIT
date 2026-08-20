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
  defaultActive: k => k !== 'end',
  segments: [
    { key: 'win',  getValue: d => d.winPct,  suffix: '%', color: 'var(--success)' },
    { key: 'loss', getValue: d => d.lossPct, suffix: '%', color: 'var(--danger)'  },
  ],
})

// PnL distribution
const pnlDistributionChart = new CanvasHistogram('pnlDistributionCanvas', {
  getBuckets: r => r.pnlBuckets,
})

const monthlyChart = new MonthlyPerfChart('monthlyPerfCanvas', {
  getData: r => r.monthlyPerf,
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