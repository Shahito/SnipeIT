const urlParams  = new URLSearchParams(location.search)
const jobId      = urlParams.get('jobId') ? parseInt(urlParams.get('jobId')) : null
let strategyId   = null
let pollInterval = null

let _exportData = null

// Trades helper
const REASONS = ['risk', 'tsl', 'signal', 'end']

function tradePnl(ep, xp, a, feeTaker, feeMaker) {
  const qty      = a / ep
  const netEntry = a + a * feeTaker
  const proceeds = qty * xp - qty * xp * feeMaker
  return round((proceeds - netEntry) / netEntry * 100, 2)
}
function round(v, d) { return Math.round(v * 10**d) / 10**d }

function unpackTrades(payload, snap) {
  if (!payload?.rows) return []
  const ft = (snap?.feeTaker ?? 0) / 100
  const fm = (snap?.feeMaker ?? 0) / 100
  return payload.rows.flatMap(([eOff, xOff, ep, xp, a, r, m, ma]) => {
    const entryDate = new Date((payload.t0 + eOff) * 1000).toISOString()
    const exitDate  = new Date((payload.t0 + xOff) * 1000).toISOString()
    const pnl       = tradePnl(ep, xp, a, ft, fm)
    return [
      { side: 'buy',  date: entryDate, price: ep, quantity: a / ep, value: a,          pnl: null },
      { side: 'sell', date: exitDate,  price: xp, quantity: a / ep, value: xp * a / ep, pnl,
        entryDate, entryPrice: ep, reason: REASONS[r], mae: m, maeAtr: ma },
    ]
  })
}

// Page logic
document.addEventListener('header:ready', async () => {
  if (!jobId) { window.location.href = '/jobs.html'; return }
  await loadJob()
})
initI18n();

initExport();

async function loadJob() {
  try {
    const { job } = await api(`/jobs/${jobId}`)
    strategyId = job.strategyId
    document.getElementById('loadingState').classList.add('hidden')

    if (job.status === 'pending' || job.status === 'running') {
      document.getElementById('pendingState').classList.remove('hidden')
      if (!pollInterval) pollInterval = setInterval(loadJob, 4000)
      return
    }
    if (pollInterval) { clearInterval(pollInterval); pollInterval = null }

    if (job.status === 'error') {
      document.getElementById('errorMsg').textContent = job.errorMessage || t('error.UNKNOWN')
      document.getElementById('errorState').classList.remove('hidden')
      return
    }
    
    const snap = job.strategySnapshot  // what ran
    const cur  = job.strategy          // current state

    const r   = job.result
    r._tradeSampled = r.trades?.sampled
    r._tradeRate    = r.trades?.rate
    
    r.trades = unpackTrades(r.trades, snap)
    
    document.getElementById('pendingState').classList.add('hidden')
    document.getElementById('resultsContent').classList.remove('hidden')

    // Header - reading snapshot
    document.getElementById('resultsTitle').textContent =
      `${t('results.title')} - ${snap?.name ?? cur.name}`
    document.getElementById('resultsMeta').textContent =
      `${snap.pair} · ${snap.timeframe} · ${fmtDate(snap.startDate)} -> ${fmtDate(snap.endDate)}`

    // Warning divergence
    renderSnapshotWarning(snap, cur, job)

    renderMetrics(r)
    equityChart.config.referenceLines = [
      { curveKey: 'equity', color: '#ff9632', value: r.initialCapital, label: t('results.chart_initial_capital') },
    ]
    
    equityChart.render(r)
    exitReasonsChart.render(r)
    pnlDistributionChart.render(r)
    maeDistributionChart.render(r)
    monthlyChart.render(r)
    renderTrades(r, r.trades || [], r.totalTrades || 0)
    
    // Export overlay
    _exportData = { ...r, _pair: snap.pair, _timeframe: snap.timeframe, _strategy: snap }
    window._exportData = _exportData
  } catch (e) {
    if (e.code === 'JOB_NOT_FOUND') {
      document.getElementById('loadingState').classList.add('hidden')
      document.getElementById('errorMsg').textContent = t('error.JOB_NOT_FOUND')
      document.getElementById('errorState').classList.remove('hidden')
      return
    }
    toast(t('error.' + e.code), 'error')
  }
}

// cloneOriginalBtn shared between two ctx
// Clone snapshot in case of divergent strategy and
// clone a sweep combination in a single strategy
function setCloneOriginalBtnMode(mode) {
  const cloneOriginalBtn = document.getElementById('cloneOriginalBtn')
  const key   = mode === 'sweep' ? 'results.clone_snapshot_btn' : 'results.clone_original_btn'
  const icon  = mode === 'sweep' ? 'copy' : 'history'
  cloneOriginalBtn.innerHTML = `<i data-icon="${icon}">${ICONS[icon]}</i><span data-i18n="${key}">${t(key)}</span>`
  cloneOriginalBtn.classList.toggle('btn-primary', mode === 'sweep')
  cloneOriginalBtn.classList.toggle('btn-surface', mode !== 'sweep')
}

function renderSnapshotWarning(snap, cur, job) {
  const existing = document.getElementById('snapshotWarning')
  if (existing) existing.remove()
  const cloneOriginalBtn = document.getElementById('cloneOriginalBtn')
  const cloneAndRunBtn   = document.getElementById('cloneAndRunBtn')

  // Reset both clone buttons to their default state before applying
  // context-specific behaviour below.
  cloneAndRunBtn.classList.remove('hidden')
  setCloneOriginalBtnMode('diverged')

  if (!snap) { cloneOriginalBtn.classList.add('hidden'); return }

  const isRealSweep = job.sweepGroup && job.sweepGroup.totalRuns > 1

  if (isRealSweep) {
    // If run comes from a sweep
    // Cloning into a proper single strategy with the resolved values
    cloneAndRunBtn.classList.add('hidden')
    setCloneOriginalBtnMode('sweep')
    cloneOriginalBtn.classList.remove('hidden')

    const banner = document.createElement('div')
    banner.id = 'snapshotWarning'
    banner.className = 'snapshot-warning'
    banner.innerHTML = `
      <span class="snapshot-warning-icon">${ICONS.shuffle}</span>
      <div>
        <strong class="text-sm">${t('results.snapshot.sweep_title')}</strong>
        <span class="text-muted text-sm">${t('results.snapshot.sweep_desc')}</span>
      </div>
    `
    document.getElementById('resultsContent').prepend(banner)
    return
  }

  const FIELDS = ['timeframe', 'initialCapital', 'positionSize', 'stopLoss', 'trailingStopLoss', 'takeProfit', 'feeMaker', 'feeTaker', 'tradingHours']
  const stillMatches = (snapVal, curVal) => {
    if (curVal && typeof curVal === 'object' && !Array.isArray(curVal) && Array.isArray(curVal.sweep)) {
      return curVal.sweep.some(v => JSON.stringify(v) === JSON.stringify(snapVal))
    }
    return JSON.stringify(curVal) === JSON.stringify(snapVal)
  }
  const changed = FIELDS.filter(f => !stillMatches(snap[f], cur[f]))
  if (!stillMatches(snap.pair, { sweep: cur.pairs })) changed.unshift('pair')
  const conditionsChanged = JSON.stringify(snap.conditions) !== JSON.stringify(cur.conditions)
  const dateChanged = new Date(snap.startDate).getTime() !== new Date(cur.startDate).getTime() ||
                new Date(snap.endDate).getTime()   !== new Date(cur.endDate).getTime()

  const diffs = [
    ...changed,
    ...(conditionsChanged ? ['conditions'] : []),
    ...(dateChanged       ? ['dates']      : []),
  ]

  if (!diffs.length) { cloneOriginalBtn.classList.add('hidden'); return }
  cloneOriginalBtn.classList.remove('hidden')

  const labels = {
    pair:             t('results.snapshot.field.pair'),
    timeframe:        t('results.snapshot.field.timeframe'),
    initialCapital:   t('results.snapshot.field.capital'),
    positionSize:     t('results.snapshot.field.position_size'),
    feeMaker:         t('results.snapshot.field.fee_maker'),
    feeTaker:         t('results.snapshot.field.fee_taker'),
    tradingHours:     t('results.snapshot.field.trading_hours'),
    stopLoss:         t('results.snapshot.field.stop_loss'),
    trailingStopLoss: t('results.snapshot.field.trailing_stop_loss'),
    takeProfit:       t('results.snapshot.field.take_profit'),
    conditions:       t('results.snapshot.field.conditions'),
    dates:            t('results.snapshot.field.dates'),
  }

  const banner = document.createElement('div')
  banner.id = 'snapshotWarning'
  banner.className = 'snapshot-warning'
  banner.innerHTML = `
    <span class="snapshot-warning-icon">${ICONS.warning}</span>
    <div>
      <strong class="text-sm">${t('results.snapshot.warning_title')}</strong>
      <span class="text-muted text-sm">${t('results.snapshot.warning_desc')} : ${diffs.map(d => labels[d] ?? d).join(', ')}</span>
    </div>
  `
  document.getElementById('resultsContent').prepend(banner)
}

// Formatters
function fmtDate(d) {
  return new Date(d).toLocaleDateString(
    i18nCurrentLang() === 'fr' ? 'fr-FR' : 'en-US',
    { day: '2-digit', month: '2-digit', year: '2-digit', timeZone: 'UTC' }
  )
}
function fmtDateTime(d) {
  return new Date(d).toLocaleString(
    i18nCurrentLang() === 'fr' ? 'fr-FR' : 'en-US',
    { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }
  )
}