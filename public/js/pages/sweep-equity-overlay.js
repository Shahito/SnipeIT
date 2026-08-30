// Equity curve overlay for the sweep results page: all non-flat equity curves for the
// sweep's done jobs, overlaid, plus an averaged curve. Data is pre-filtered/downsampled
// server-side (see GET /api/sweeps/:id/equity-curves) - this file just renders it.

let _equityOverlayData = null
let _eqOverlayResizeTimer

document.addEventListener('header:ready', () => {
  if (!sweepId) return
  loadEquityOverlay()
})

async function loadEquityOverlay() {
  try {
    _equityOverlayData = await api(`/sweeps/${sweepId}/equity-curves`)
  } catch {
    document.getElementById('equityOverlayCard')?.classList.add('hidden')
    return
  }
  renderEquityOverlay()
  window.addEventListener('resize', () => {
    clearTimeout(_eqOverlayResizeTimer)
    _eqOverlayResizeTimer = setTimeout(renderEquityOverlay, 150)
  })
}

function renderEquityOverlay() {
  const data = _equityOverlayData
  const canvas = document.getElementById('equitiesChartCanvas')
  const emptyEl = document.getElementById('equitiesChartEmpty')
  const descEl = document.getElementById('equitiesChartDesc')
  if (!data || !canvas) return

  descEl.textContent = t('sweep.equity_overlay.desc', { included: data.includedCount, excluded: data.excludedFlat })

  if (!data.curves.length) {
    canvas.classList.add('hidden')
    emptyEl.classList.remove('hidden')
    return
  }
  canvas.classList.remove('hidden')
  emptyEl.classList.add('hidden')

  const W = canvas.offsetWidth || 700
  const H = 260
  canvas.width = W * devicePixelRatio
  canvas.height = H * devicePixelRatio
  canvas.style.width = W + 'px'
  canvas.style.height = H + 'px'
  const ctx = canvas.getContext('2d')
  ctx.scale(devicePixelRatio, devicePixelRatio)
  ctx.clearRect(0, 0, W, H)

  const pad = { top: 16, right: 16, bottom: 28, left: 48 }
  const cW = W - pad.left - pad.right
  const cH = H - pad.top - pad.bottom

  const allT = data.curves.flatMap(c => c.points.map(p => p.t)).concat(data.average.map(p => p.t))
  const allE = data.curves.flatMap(c => c.points.map(p => p.e)).concat(data.average.map(p => p.e))
  const { toX } = _scaleX(allT, pad.left, cW)
  const { mn, mx, toY } = _scaleY(allE.length ? allE : [0, 1], pad.top, cH)

  // Grid
  ctx.strokeStyle = '#2a2f3d'
  ctx.lineWidth = 1
  const gridLines = 4
  for (let i = 0; i <= gridLines; i++) {
    const y = pad.top + (cH / gridLines) * i
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(pad.left + cW, y); ctx.stroke()
  }

  // Y-axis % labels
  ctx.fillStyle = '#7c84a0'; ctx.font = '10px system-ui'; ctx.textAlign = 'right'
  for (let i = 0; i <= gridLines; i++) {
    const v = mx - ((mx - mn) / gridLines) * i
    const y = pad.top + (cH / gridLines) * i
    ctx.fillText((v >= 0 ? '+' : '') + v.toFixed(1) + '%', pad.left - 8, y + 3)
  }

  // Individual curves - thin and muted, just for shape/spread context
  data.curves.forEach(c => {
    const pts = c.points.map(p => ({ x: toX(p.t), y: toY(p.e) }))
    _drawPolyline(ctx, pts, 'rgba(124,132,160,0.35)', null, 1, pad.top, cH)
  })

  // Average - bold accent line on top
  if (data.average.length) {
    const pts = data.average.map(p => ({ x: toX(p.t), y: toY(p.e) }))
    _drawPolyline(ctx, pts, _cssVar('--primary') || 'rgba(108,142,255,0.9)', null, 2.5, pad.top, cH)
  }

  // X-axis date labels (start / mid / end)
  const fmtDate = ts => new Date(ts * 1000).toLocaleDateString()
  const minT = Math.min(...allT), maxT = Math.max(...allT)
  ctx.fillStyle = '#7c84a0'; ctx.font = '10px system-ui'
  ;[[minT, 'left'], [(minT + maxT) / 2, 'center'], [maxT, 'right']].forEach(([ts, align]) => {
    ctx.textAlign = align
    ctx.fillText(fmtDate(ts), toX(ts), pad.top + cH + 18)
  })
}