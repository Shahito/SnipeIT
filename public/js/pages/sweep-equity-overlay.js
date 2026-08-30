// Equity curve overlay for the sweep results page: all non-flat equity curves for the
// sweep's done jobs, overlaid, plus an averaged curve. Data is pre-filtered/downsampled
// server-side (see GET /api/sweeps/:id/equity-curves) - this file builds the
// CanvasLineChart config from that data; charts.js handles the actual rendering,
// resize, and hover tooltip (curves have different real date ranges per job, hence
// the per-curve getTimestamps - see charts.js "time mode").

let _equityOverlayChart = null

document.addEventListener('header:ready', () => {
  if (!sweepId) return
  loadEquityOverlay()
})

async function loadEquityOverlay() {
  let data
  try {
    data = await api(`/sweeps/${sweepId}/equity-curves`)
  } catch {
    document.getElementById('equityOverlayCard')?.classList.add('hidden')
    return
  }

  document.getElementById('equitiesChartDesc').textContent =
    t('sweep.equity_overlay.desc', { included: data.includedCount, excluded: data.excludedFlat })

  const canvas = document.getElementById('equitiesChartCanvas')
  const emptyEl = document.getElementById('equitiesChartEmpty')
  if (!data.curves.length) {
    canvas.classList.add('hidden')
    emptyEl.classList.remove('hidden')
    return
  }
  canvas.classList.remove('hidden')
  emptyEl.classList.add('hidden')

  const finalEquity = c => c.points[c.points.length - 1].e
  const best  = data.curves.reduce((a, b) => finalEquity(b) > finalEquity(a) ? b : a)
  const worst = data.curves.reduce((a, b) => finalEquity(b) < finalEquity(a) ? b : a)

  const curves = [
    {
      key:           'best',
      i18nKey:       'sweep.equity_overlay.best',
      getData:       () => best.points.map(p => p.e),
      getTimestamps: () => best.points.map(p => p.t * 1000),
      axis:          'left',
      color:         _cssVar('--success') || 'rgba(52,199,89,0.9)',
      lineWidth:     2,
      defaultActive: true,
    },
    {
      key:           'worst',
      i18nKey:       'sweep.equity_overlay.worst',
      getData:       () => worst.points.map(p => p.e),
      getTimestamps: () => worst.points.map(p => p.t * 1000),
      axis:          'left',
      color:         _cssVar('--danger') || 'rgba(255,69,58,0.9)',
      lineWidth:     2,
      defaultActive: true,
    },
  ]
  if (data.average.length) {
    curves.push({
      key:           'average',
      i18nKey:       'sweep.equity_overlay.average',
      getData:       () => data.average.map(p => p.e),
      getTimestamps: () => data.average.map(p => p.t * 1000),
      axis:          'left',
      color:         _cssVar('--primary') || 'rgba(108,142,255,0.9)',
      lineWidth:     2.5,
      defaultActive: true,
    })
  }

  _equityOverlayChart = new CanvasLineChart('equitiesChartCanvas', {
    height: 260,
    curves,
    formatDate:        ts => new Date(ts).toLocaleDateString(),
    formatTooltipDate: ts => new Date(ts).toLocaleDateString(),
  })
  _equityOverlayChart.render(data)
}