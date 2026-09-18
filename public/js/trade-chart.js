// trade-chart.js
// Full-page TradingView-style chart for one backtest job, with the
// strategy's own indicators overlaid (recomputed server-side to match
// indicators.py exactly - see candleController.js + utils/indicatorEngine.js).
// Real multi-pane layout: one Lightweight Charts instance per pane, synced
// on pan/zoom and crosshair, each with its own hover legend, resizable by
// dragging, and toggled via a dropdown menu.
// Usage: chart.html?jobId=123

initI18n()

const jobId = new URLSearchParams(location.search).get('jobId')

// How many of the most recent candles to show by default. The full dataset
// is still loaded and reachable by scrolling/zooming out - this only sets
// the initial view so the chart doesn't open zoomed out to the whole range.
const INITIAL_VISIBLE_CANDLES = 200

// Exit reason -> display label. Mirrors the map used on the results page
// (see js/pages/results-charts.js REASON_LABELS) so a trade's reason reads
// the same way everywhere in the app.
function reasonLabel(reason) {
  return { risk: 'TP/SL', signal: 'Signal', tsl: 'Trailing SL', end: t('results.exit_reasons.label_end') }[reason]
    ?? t('results.exit_reasons.label_unknown')
}

// Resolve the platform's current CSS custom properties once. Reading these
// (instead of hardcoding hex values) keeps the chart's colors - including
// win/loss coloring - in sync with the user's chosen color scheme (see
// js/header.js applyColorScheme) and with light/dark theme changes.
function themeColors() {
  const style = getComputedStyle(document.documentElement)
  const v = name => style.getPropertyValue(name).trim()
  return {
    bg2: v('--bg2'), border: v('--border'), text: v('--text'), textMuted: v('--text-muted'),
    primary: v('--primary'), success: v('--success'), danger: v('--danger'),
  }
}

document.addEventListener('header:ready', async () => {
  const loadingEl      = document.getElementById('loadingState')
  const errorEl        = document.getElementById('errorState')
  const errorMsgEl     = document.getElementById('errorMsg')
  const pendingEl      = document.getElementById('pendingState')
  const contentEl      = document.getElementById('chartContent')
  const metaEl         = document.getElementById('chartMeta')
  const backBtn        = document.getElementById('backToResultsBtn')
  const warningsEl     = document.getElementById('chartWarnings')
  const chartMainPaneEl = document.getElementById('chartMainPane')
  const panelsEl       = document.getElementById('panels')
  const indicatorsBtn  = document.getElementById('indicatorsBtn')
  const indicatorsMenu = document.getElementById('indicatorsMenu')
  const menuBodyEl     = document.getElementById('indicatorsMenuBody')
  const menuEmptyEl    = document.getElementById('indicatorsMenuEmpty')
  const mainLegendEl   = document.getElementById('legend-main')

  function showState(state) {
    loadingEl.classList.toggle('hidden', state !== 'loading')
    errorEl.classList.toggle('hidden', state !== 'error')
    pendingEl.classList.toggle('hidden', state !== 'pending')
    contentEl.classList.toggle('hidden', state !== 'content')
  }

  function showError(message) {
    errorMsgEl.textContent = message
    showState('error')
  }

  if (!jobId) {
    window.location.href = '/jobs.html'
    return
  }
  backBtn.href = `/results.html?jobId=${jobId}`

  // Indicators dropdown open/close
  indicatorsBtn.addEventListener('click', e => {
    e.stopPropagation()
    const open = indicatorsMenu.classList.toggle('hidden') === false
    indicatorsBtn.classList.toggle('active', open)
    indicatorsBtn.setAttribute('aria-expanded', String(open))
  })
  document.addEventListener('click', e => {
    if (indicatorsMenu.classList.contains('hidden')) return
    if (indicatorsMenu.contains(e.target) || indicatorsBtn.contains(e.target)) return
    indicatorsMenu.classList.add('hidden')
    indicatorsBtn.classList.remove('active')
    indicatorsBtn.setAttribute('aria-expanded', 'false')
  })

  // Decode the columnar trades table produced by compute_results.py (_pack_trades)
  const REASONS = ['risk', 'tsl', 'signal', 'end']

  function unpackTrades(packed) {
    if (!packed || !Array.isArray(packed.rows) || !packed.rows.length) return []
    return packed.rows.map(row => {
      const [eOff, xOff, ep, xp, allocated, r] = row
      return {
        entryTime:  packed.t0 + eOff,
        exitTime:   packed.t0 + xOff,
        entryPrice: ep,
        exitPrice:  xp,
        allocated,
        reason: REASONS[r] || 'signal',
        pnlPct: ep ? ((xp - ep) / ep) * 100 : 0, // approximate: fees not re-applied here
      }
    })
  }

  function buildMarkers(trades, colors) {
    const markers = []
    for (const trade of trades) {
      markers.push({ time: trade.entryTime, position: 'belowBar', color: colors.primary, shape: 'arrowUp', text: t('chart.marker.buy') })
      const win = trade.pnlPct >= 0
      markers.push({
        time: trade.exitTime,
        position: 'aboveBar',
        color: win ? colors.success : colors.danger,
        shape: 'arrowDown',
        text: `${win ? '+' : ''}${trade.pnlPct.toFixed(1)}% (${reasonLabel(trade.reason)})`,
      })
    }
    markers.sort((a, b) => a.time - b.time)
    return markers
  }

  // Classify an indicator column name into a pane kind (naming convention shared with indicators.py)
  function kindOf(label) {
    if (label.startsWith('RSI_') || label.startsWith('STOCH_RSI_')) return 'oscillator'
    if (label.startsWith('MACD_')) return 'macd'
    if (label.startsWith('ATR_')) return 'atr'
    if (label === 'PRICE' || label === 'VOLUME' || label === 'HIGH' || label === 'LOW' || label === 'OPEN') return 'skip'
    return 'overlay' // EMA_, SMA_, BB_*, VWAP
  }

  function fmt(v) {
    if (v === null || v === undefined || Number.isNaN(v)) return '–'
    const av = Math.abs(v)
    if (av >= 1000) return v.toFixed(1)
    if (av >= 1) return v.toFixed(2)
    return v.toFixed(4)
  }

  // Drag-to-resize a pane, like TradingView. Grabbing the handle at the
  // top of a panel and dragging up grows it, dragging down shrinks it - the
  // main pane (flex:1) absorbs the difference automatically.
  function addResizeHandle(panel) {
    const handle = document.createElement('div')
    handle.className = 'chart-panel-resize-handle'
    panel.insertBefore(handle, panel.firstChild)

    let dragging = false
    let startY = 0
    let startHeight = 0

    function onMove(e) {
      if (!dragging) return
      const delta = e.clientY - startY
      const maxHeight = Math.max(200, window.innerHeight * 0.6)
      const newHeight = Math.min(maxHeight, Math.max(60, startHeight - delta))
      panel.style.height = `${newHeight}px`
    }
    function stop() {
      dragging = false
      handle.classList.remove('dragging')
    }

    handle.addEventListener('pointerdown', e => {
      dragging = true
      startY = e.clientY
      startHeight = panel.getBoundingClientRect().height
      handle.classList.add('dragging')
      if (handle.setPointerCapture) {
        try { handle.setPointerCapture(e.pointerId) } catch (_) { /* not supported everywhere */ }
      }
      e.preventDefault()
    })
    handle.addEventListener('pointermove', onMove)
    handle.addEventListener('pointerup', stop)
    handle.addEventListener('pointercancel', stop)
  }

  function addWarning(message) {
    warningsEl.classList.remove('hidden')
    const banner = document.createElement('div')
    banner.className = 'chart-warning-banner'
    banner.innerHTML = `${ICONS.warning}<span>${message}</span>`
    warningsEl.appendChild(banner)
  }

  // Fetch job
  let job
  try {
    showState('loading')
    const data = await api(`/jobs/${jobId}`)
    job = data.job
  } catch (e) {
    if (e.code === 'JOB_NOT_FOUND') {
      showError(t('error.JOB_NOT_FOUND'))
    } else {
      showError(t('error.' + e.code))
    }
    return
  }

  if (job.status === 'pending' || job.status === 'running') {
    showState('pending')
    return
  }
  if (job.status === 'error') {
    showError(job.errorMessage || t('error.UNKNOWN'))
    return
  }
  if (job.status !== 'done' || !job.result) {
    showError(t('error.UNKNOWN'))
    return
  }

  // Fetch candles + indicators (single call)
  let candlesData
  try {
    candlesData = await api(`/jobs/${jobId}/candles`)
  } catch (e) {
    showError(t('error.' + e.code))
    return
  }

  const { candles, pair, timeframe, indicators } = candlesData
  if (!candles || !candles.length) {
    showError(t('error.UNKNOWN'))
    return
  }

  showState('content')

  const colors = themeColors()
  const trades = unpackTrades(job.result.trades)

  const times = candles.map(c => c.time)
  const timeToIdx = new Map(times.map((t, i) => [t, i]))

  // Some trades can reference times outside the candle range actually loaded
  // (e.g. the chart's candle cap kicked in for a very long backtest). Markers
  // whose time doesn't match a real candle get visually clamped/stacked by
  // lightweight-charts, which is misleading - filter them out and count them.
  const allMarkers = buildMarkers(trades, colors)
  const markers = allMarkers.filter(m => timeToIdx.has(m.time))
  const hiddenMarkersCount = allMarkers.length - markers.length

  // rawSeries: full-length arrays aligned 1:1 with `times` (null allowed) - used for legend lookups.
  // pointSeries: same data but filtered to non-null {time,value} pairs - used to feed chart series.
  const rawSeries = {}
  const pointSeries = {}
  const kindByLabel = {}
  for (const [label, values] of Object.entries(indicators || {})) {
    const kind = kindOf(label)
    if (kind === 'skip' || !values) continue
    const pts = []
    for (let i = 0; i < times.length; i++) {
      const v = values[i]
      if (v === null || v === undefined || Number.isNaN(v)) continue
      pts.push({ time: times[i], value: v })
    }
    if (!pts.length) continue
    rawSeries[label] = values
    pointSeries[label] = pts
    kindByLabel[label] = kind
  }

  const totalTrades = job.result.totalTrades ?? trades.length
  const sampled = job.result.trades && job.result.trades.sampled
  const nIndicators = Object.keys(pointSeries).length

  const metaParts = [
    pair, timeframe,
    t('chart.meta.candles', { count: candles.length }),
    sampled ? t('chart.meta.trades_sampled', { count: trades.length, total: totalTrades }) : t('chart.meta.trades', { count: trades.length }),
  ]
  if (nIndicators) metaParts.push(t('chart.meta.indicators', { count: nIndicators }))
  metaEl.textContent = metaParts.join(' · ')

  if (candlesData.truncated) {
    const from = new Date(candlesData.effectiveStartDate).toLocaleDateString(i18nCurrentLang() === 'fr' ? 'fr-FR' : 'en-US')
    addWarning(t('chart.warning.truncated', { timeframe, max: candlesData.maxCandles.toLocaleString(i18nCurrentLang() === 'fr' ? 'fr-FR' : 'en-US'), date: from }))
  }
  if (hiddenMarkersCount) {
    addWarning(t('chart.warning.hidden_markers', { count: hiddenMarkersCount }))
  }

  // Group labels by pane kind
  const overlayLabels    = Object.keys(pointSeries).filter(l => kindByLabel[l] === 'overlay')
  const oscillatorLabels = Object.keys(pointSeries).filter(l => kindByLabel[l] === 'oscillator')
  const macdLabels       = Object.keys(pointSeries).filter(l => kindByLabel[l] === 'macd')
  const atrLabels        = Object.keys(pointSeries).filter(l => kindByLabel[l] === 'atr')

  const CHART_OPTS = () => ({
    layout: { background: { color: colors.bg2 }, textColor: colors.text },
    grid: { vertLines: { color: colors.border }, horzLines: { color: colors.border } },
    timeScale: { timeVisible: true, secondsVisible: false, fixLeftEdge: true, fixRightEdge: true, rightOffset: 5 },
    rightPriceScale: { borderColor: colors.border },
    crosshair: {
      mode: LightweightCharts.CrosshairMode.Normal,
      vertLine: { labelBackgroundColor: colors.primary },
      horzLine: { labelBackgroundColor: colors.primary },
    },
    autoSize: true,
  })

  // Main chart: candles + overlay indicators
  const mainChart = LightweightCharts.createChart(chartMainPaneEl, CHART_OPTS())
  const candleSeries = mainChart.addCandlestickSeries({
    upColor: colors.success, downColor: colors.danger, borderVisible: false,
    wickUpColor: colors.success, wickDownColor: colors.danger,
  })
  candleSeries.setData(candles.map(c => ({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close })))
  candleSeries.setMarkers(markers)

  // "In position" shaded zones (semi-transparent band from entry to exit)
  const zonesLayer = document.createElement('div')
  zonesLayer.style.position = 'absolute'
  zonesLayer.style.top = '0'
  zonesLayer.style.left = '0'
  zonesLayer.style.right = '0'
  zonesLayer.style.bottom = '0'
  zonesLayer.style.pointerEvents = 'none'
  zonesLayer.style.overflow = 'hidden'
  zonesLayer.style.zIndex = '1' // above the candle canvas, below .pane-legend (z-index 5)
  chartMainPaneEl.appendChild(zonesLayer)

  function renderPositionZones() {
    zonesLayer.innerHTML = ''
    const ts = mainChart.timeScale()
    for (const trade of trades) {
      const x1 = ts.timeToCoordinate(trade.entryTime)
      const x2 = ts.timeToCoordinate(trade.exitTime)
      if (x1 == null || x2 == null) continue // trade outside the current visible range
      const left = Math.min(x1, x2)
      const width = Math.abs(x2 - x1)
      if (width <= 0) continue
      const zone = document.createElement('div')
      zone.style.position = 'absolute'
      zone.style.top = '0'
      zone.style.bottom = '0'
      zone.style.left = `${left}px`
      zone.style.width = `${width}px`
      zone.style.background = trade.pnlPct >= 0 ? 'color-mix(in srgb, var(--success) 10%, transparent)' : 'color-mix(in srgb, var(--danger) 10%, transparent)'
      zonesLayer.appendChild(zone)
    }
  }
  mainChart.timeScale().subscribeVisibleLogicalRangeChange(() => renderPositionZones())

  // Fixed palette for multi-series overlays/indicators (distinct from the
  // theme's success/danger/primary tokens, which are reserved for win/loss
  // and interactive accents - see js/pages/results-charts.js REASON_COLORS
  // for the same approach on the results page).
  const OVERLAY_COLORS = ['#f4b400', '#ab47bc', '#26c6da', '#ff7043', '#66bb6a', '#42a5f5', '#ec407a']
  const OSC_COLORS      = ['#ffd54f', '#ba68c8', '#4fc3f7', '#81c784']

  const toggleables = [] // individual line toggles - overlay indicators only (they share the main pane, no dedicated graph to remove)
  const colorOf = {}

  overlayLabels.forEach((label, i) => {
    const color = OVERLAY_COLORS[i % OVERLAY_COLORS.length]
    colorOf[label] = color
    const s = mainChart.addLineSeries({ color, lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false, title: label })
    s.setData(pointSeries[label])
    toggleables.push({ label, series: s, color })
  })

  // Sub-panes (real separate synced chart instances, resizable)
  const paneEntries = [{ chart: mainChart, legendEl: mainLegendEl, refSeries: candleSeries, priceLabel: null, kind: 'main', labels: overlayLabels }]
  const paneToggles = [] // whole-pane toggles - one entry per dedicated sub-chart (RSI/StochRSI, MACD, ATR)

  function createPane() {
    const panel = document.createElement('div')
    panel.className = 'chart-panel'
    const legend = document.createElement('div')
    legend.className = 'pane-legend'
    panel.appendChild(legend)
    const chartDiv = document.createElement('div')
    chartDiv.className = 'chart-panel-inner'
    panel.appendChild(chartDiv)
    panelsEl.appendChild(panel)
    addResizeHandle(panel)
    const chart = LightweightCharts.createChart(chartDiv, CHART_OPTS())
    return { chart, legendEl: legend, panelEl: panel }
  }

  if (oscillatorLabels.length) {
    const { chart, legendEl, panelEl } = createPane()
    for (const level of [30, 70]) {
      const guide = chart.addLineSeries({
        color: colors.border, lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dotted,
        priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
      })
      guide.setData(times.map(t => ({ time: t, value: level })))
    }
    let refSeries = null
    oscillatorLabels.forEach((label, i) => {
      const color = OSC_COLORS[i % OSC_COLORS.length]
      colorOf[label] = color
      const s = chart.addLineSeries({ color, lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false, title: label })
      s.setData(pointSeries[label])
      if (!refSeries) refSeries = s
    })
    paneEntries.push({ chart, legendEl, refSeries, priceLabel: oscillatorLabels[0], kind: 'oscillator', labels: oscillatorLabels })
    paneToggles.push({ label: t('chart.pane.momentum'), panelEl, chart, color: OSC_COLORS[0] })
  }

  if (macdLabels.length) {
    // Group by "family" (params + optional @timeframe suffix): a strategy
    // referencing MACD on both its base timeframe and an HTF ref (e.g. MACD
    // on 1h + MACD on 4h) must get one dedicated pane PER family - otherwise
    // only the first one found gets displayed and the rest is silently lost.
    function macdFamilyKey(label) {
      if (label.startsWith('MACD_histogram_')) return label.slice('MACD_histogram_'.length)
      if (label.startsWith('MACD_signal_'))    return label.slice('MACD_signal_'.length)
      if (label.startsWith('MACD_'))           return label.slice('MACD_'.length)
      return label
    }
    function macdFamilyDisplayName(key) {
      const [paramsPart, tfPart] = key.split('@')
      const params = paramsPart.split('_').join(',')
      return `MACD (${params})${tfPart ? ' @' + tfPart : ''}`
    }

    const families = new Map() // familyKey -> { line, signal, hist }
    for (const label of macdLabels) {
      const key = macdFamilyKey(label)
      if (!families.has(key)) families.set(key, {})
      const f = families.get(key)
      if (label.startsWith('MACD_histogram_')) f.hist = label
      else if (label.startsWith('MACD_signal_')) f.signal = label
      else f.line = label
    }

    for (const [key, f] of families.entries()) {
      const { chart, legendEl, panelEl } = createPane()
      const zero = chart.addLineSeries({ color: colors.border, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false })
      zero.setData(times.map(t => ({ time: t, value: 0 })))

      let refSeries = null
      const paneLabels = []

      if (f.hist) {
        colorOf[f.hist] = '#66bb6a'
        const hist = chart.addHistogramSeries({ title: f.hist })
        hist.setData(pointSeries[f.hist].map(p => ({ time: p.time, value: p.value, color: p.value >= 0 ? `${colors.success}99` : `${colors.danger}99` })))
        paneLabels.push(f.hist)
      }
      if (f.line) {
        colorOf[f.line] = '#42a5f5'
        const s = chart.addLineSeries({ color: '#42a5f5', lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false, title: f.line })
        s.setData(pointSeries[f.line])
        refSeries = s
        paneLabels.push(f.line)
      }
      if (f.signal) {
        colorOf[f.signal] = '#ff7043'
        const s = chart.addLineSeries({ color: '#ff7043', lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false, title: f.signal })
        s.setData(pointSeries[f.signal])
        if (!refSeries) refSeries = s
        paneLabels.push(f.signal)
      }

      paneEntries.push({ chart, legendEl, refSeries, priceLabel: f.line || f.hist || f.signal, kind: 'macd', labels: paneLabels })
      paneToggles.push({ label: macdFamilyDisplayName(key), panelEl, chart, color: '#42a5f5' })
    }
  }

  if (atrLabels.length) {
    const { chart, legendEl, panelEl } = createPane()
    let refSeries = null
    atrLabels.forEach(label => {
      colorOf[label] = '#4dd0e1'
      const s = chart.addLineSeries({ color: '#4dd0e1', lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false, title: label })
      s.setData(pointSeries[label])
      if (!refSeries) refSeries = s
    })
    paneEntries.push({ chart, legendEl, refSeries, priceLabel: atrLabels[0], kind: 'atr', labels: atrLabels })
    paneToggles.push({ label: t('chart.unit.atr'), panelEl, chart, color: '#4dd0e1' })
  }

  // Sync pan/zoom across all panes
  const allCharts = paneEntries.map(p => p.chart)
  let rangeSyncing = false
  allCharts.forEach(chart => {
    chart.timeScale().subscribeVisibleLogicalRangeChange(range => {
      if (rangeSyncing || !range) return
      rangeSyncing = true
      for (const other of allCharts) {
        if (other !== chart) other.timeScale().setVisibleLogicalRange(range)
      }
      rangeSyncing = false
    })
  })

  // Align price-scale widths across panes so the crosshair lines up vertically
  // Each chart auto-sizes its own price-scale column based on the label widths it
  // needs to display (e.g. "102.43" vs "39.12"), which shifts the plot area and
  // misaligns the crosshair between panes. Forcing the same minimumWidth everywhere
  // fixes it (see lightweight-charts PriceScaleOptions.minimumWidth, v4.1+).
  function alignPriceScaleWidths() {
    let maxWidth = 0
    for (const c of allCharts) {
      const w = c.priceScale('right').width()
      if (w > maxWidth) maxWidth = w
    }
    if (maxWidth > 0) {
      for (const c of allCharts) {
        c.priceScale('right').applyOptions({ minimumWidth: maxWidth })
      }
    }
  }
  requestAnimationFrame(() => {
    alignPriceScaleWidths()
    setTimeout(alignPriceScaleWidths, 50) // safety re-check once layout has fully settled
  })
  window.addEventListener('resize', () => setTimeout(() => { alignPriceScaleWidths(); renderPositionZones() }, 50))

  // Legends (default to latest values; update on crosshair hover)
  const lastIdx = times.length - 1

  function legendHtmlFor(entry, idx) {
    const i = idx === null ? lastIdx : idx
    if (entry.kind === 'main') {
      const c = candles[i]
      let html = `<b>O</b> ${fmt(c.open)} <b>H</b> ${fmt(c.high)} <b>L</b> ${fmt(c.low)} <b>C</b> ${fmt(c.close)}`
      for (const label of entry.labels) {
        const v = rawSeries[label][i]
        html += `<span class="legend-item" style="color:${colorOf[label]}">${label}: ${v == null ? '–' : fmt(v)}</span>`
      }
      return html
    }
    return entry.labels.map(label => {
      const v = rawSeries[label][i]
      return `<span style="color:${colorOf[label]}">${label}: ${v == null ? '–' : fmt(v)}</span>`
    }).join('<span class="legend-item"></span>')
  }

  function updateAllLegends(idx) {
    for (const entry of paneEntries) entry.legendEl.innerHTML = legendHtmlFor(entry, idx)
  }
  updateAllLegends(null) // initial state: show latest values

  // Sync crosshair across all panes + drive the legends
  let crosshairSyncing = false
  paneEntries.forEach(sourceEntry => {
    sourceEntry.chart.subscribeCrosshairMove(param => {
      if (crosshairSyncing) return
      crosshairSyncing = true

      const idx = (param.time != null) ? timeToIdx.get(param.time) : undefined
      updateAllLegends(idx === undefined ? null : idx)

      for (const entry of paneEntries) {
        if (entry === sourceEntry) continue
        if (idx === undefined || idx === null || !entry.refSeries) {
          entry.chart.clearCrosshairPosition()
          continue
        }
        const price = entry.priceLabel ? rawSeries[entry.priceLabel][idx] : candles[idx].close
        if (price === null || price === undefined || Number.isNaN(price)) {
          entry.chart.clearCrosshairPosition()
        } else {
          entry.chart.setCrosshairPosition(price, times[idx], entry.refSeries)
        }
      }

      crosshairSyncing = false
    })
  })

  // Indicators dropdown contents
  function addToggleRow(color, labelText, onChange) {
    const row = document.createElement('label')
    row.className = 'indicators-toggle-row'
    const checkbox = document.createElement('input')
    checkbox.type = 'checkbox'
    checkbox.checked = true
    checkbox.addEventListener('change', () => onChange(checkbox.checked))
    const swatch = document.createElement('span')
    swatch.className = 'indicators-swatch'
    swatch.style.background = color
    const text = document.createElement('span')
    text.className = 'indicators-toggle-label'
    text.textContent = labelText
    row.append(checkbox, swatch, text)
    menuBodyEl.appendChild(row)
  }

  if (trades.length) {
    const title = document.createElement('div')
    title.className = 'indicators-group-title'
    title.textContent = t('chart.group.position')
    menuBodyEl.appendChild(title)
    addToggleRow(`${colors.primary}80`, t('chart.position_zones'), checked => {
      zonesLayer.style.display = checked ? '' : 'none'
    })
  }

  if (toggleables.length) {
    const title = document.createElement('div')
    title.className = 'indicators-group-title'
    title.textContent = t('chart.group.overlays')
    menuBodyEl.appendChild(title)
    for (const tg of toggleables) {
      addToggleRow(tg.color, tg.label, checked => tg.series.applyOptions({ visible: checked }))
    }
  }

  if (paneToggles.length) {
    const title = document.createElement('div')
    title.className = 'indicators-group-title'
    title.textContent = t('chart.group.indicators')
    menuBodyEl.appendChild(title)
    for (const p of paneToggles) {
      addToggleRow(p.color, p.label, checked => { p.panelEl.style.display = checked ? '' : 'none' })
    }
  }

  if (!trades.length && !toggleables.length && !paneToggles.length) {
    menuEmptyEl.classList.remove('hidden')
  }

  // Initial view: the most recent N candles rather than the full history
  const total = times.length
  const initialRange = { from: Math.max(0, total - INITIAL_VISIBLE_CANDLES), to: total - 1 }
  allCharts.forEach(c => c.timeScale().setVisibleLogicalRange(initialRange))
  renderPositionZones()
})