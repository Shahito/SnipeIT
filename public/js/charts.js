/**
 * charts.js - Reusable chart primitives for SnipeIT results page.
 *
 * Classes:
 *   CanvasLineChart  - multi-curve canvas chart with toggles & hover tooltip
 *   BarChart         - generic horizontal bar chart; segments are fully configurable
 *
 * Adding a new line chart
 *   const myChart = new CanvasLineChart('myCanvasId', {
 *     getTimestamps: r => r.equityCurve.map(p => p.t * 1000),
 *     togglesContainerId: 'myToggles',
 *     curves: [
 *       { key: 'equity', i18nKey: 'results.chart.equity',
 *         getData: r => r.equityCurve.map(p => p.e), axis: 'left', prefix: '$', dynamic: true },
 *       { key: 'price',  label: 'Price',
 *         getData: r => r.priceCurve.map(p => p.c),  axis: 'right' },
 *     ],
 *   })
 *   myChart.render(jobResult)
 *
 * Adding a new bar chart
 *   const myBars = new BarChart('myChartDiv', 'myFiltersDiv', {
 *     getBars:       r => r.someRecord,           // must return Record<string, object>
 *     getLabel:      (key, d) => ({ title: key, sub: `${d.count} trades` }),
 *     segments: [
 *       { key: 'win',  getValue: d => d.winPct,  suffix: '%', color: 'var(--success)' },
 *       { key: 'loss', getValue: d => d.lossPct, suffix: '%', color: 'var(--danger)'  },
 *     ],
 *     order:         ['risk', 'signal', 'end'],   // optional sort order
 *     defaultActive: key => key !== 'end',        // optional, defaults to all active
 *   })
 *   myBars.render(jobResult)
 */


// Shared tooltip singleton

const _tooltip = (() => {
  const el = document.createElement('div')
  el.className = 'chart-tooltip'
  document.body.appendChild(el)
  return el
})()

function _showTooltip(e, html) {
  _tooltip.innerHTML = html
  _tooltip.classList.add('visible')
  const tx = e.clientX + 14
  const ty = e.clientY - 10
  _tooltip.style.left = (tx + _tooltip.offsetWidth > window.innerWidth
    ? e.clientX - _tooltip.offsetWidth - 14
    : tx) + 'px'
  _tooltip.style.top = ty + 'px'
}

function _hideTooltip() {
  _tooltip.classList.remove('visible')
}


// Helpers
function _cssVar(name) {
  return window.getComputedStyle(document.body).getPropertyValue(name).trim()
}

function _scaleY(values, padTop, cH) {
  const mn  = Math.min(...values)
  const mx  = Math.max(...values)
  const rng = mx - mn || 1
  return { mn, mx, rng, toY: v => padTop + cH - ((v - mn) / rng) * cH }
}

function _drawPolyline(ctx, pts, color, fillColor, lineWidth, padTop, cH) {
  if (!pts.length) return
  ctx.beginPath()
  pts.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y))
  if (fillColor) {
    ctx.lineTo(pts[pts.length - 1].x, padTop + cH)
    ctx.lineTo(pts[0].x, padTop + cH)
    ctx.closePath()
    ctx.fillStyle = fillColor
    ctx.fill()
    ctx.beginPath()
    pts.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y))
  }
  ctx.strokeStyle = color
  ctx.lineWidth   = lineWidth
  ctx.stroke()
}

function _i18n(key, fallback) {
  return (key && typeof t === 'function') ? t(key) : (fallback || key || '')
}


// CanvasLineChart
/**
 * @param {string} canvasId
 * @param {object} config
 *   curves: Array<{
 *     key          string          - unique id, used for toggle btn & CSS
 *     label?       string          - static label (alternative to i18nKey)
 *     i18nKey?     string          - i18n key resolved at render time
 *     getData      (r) => number[] - extracts y-values from job result
 *     axis         'left'|'right'
 *     prefix?      string          e.g. '$'
 *     suffix?      string          e.g. '%'
 *     color?       string          CSS color; omit to use default
 *     fillColor?   string|null
 *     lineWidth?   number
 *     dynamic?     bool            auto green/red based on first last delta
 *     defaultActive? bool          default true
 *   }>
 *   getTimestamps        (r) => number[]  - X-axis timestamps in ms
 *   togglesContainerId   string
 *   height?              number           default 300
 *   gridLines?           number           default 4
 *   formatDate?          (ts) => string   X-axis label formatter
 *   formatTooltipDate?   (ts) => string
 */
class CanvasLineChart {
  constructor(canvasId, config) {
    this.canvasId = canvasId
    this.config   = { height: 300, gridLines: 4, ...config }
    this._result  = null
    this._active  = Object.fromEntries(
      config.curves.map(c => [c.key, c.defaultActive !== false])
    )
    this._togglesReady = false
    this._bindCanvasEvents()
  }

  render(result) {
    this._result = result
    if (!this._togglesReady) {
      this._initToggles()
      this._togglesReady = true
    }
    this._draw()
  }

  // Private
  _getPad(W) {
    return W < 640
      ? { top: 16, right: 50, bottom: 24, left: 52 }
      : { top: 20, right: 70, bottom: 30, left: 70 }
  }

  _initToggles() {
    const container = document.getElementById(this.config.togglesContainerId)
    if (!container) return
    container.innerHTML = this.config.curves.map(c => {
      const label = _i18n(c.i18nKey, c.label || c.key)
      return `<button class="toggle-btn ${this._active[c.key] ? 'active' : ''}" data-curve="${c.key}">${label}</button>`
    }).join('')
    container.addEventListener('click', e => {
      const btn = e.target.closest('.toggle-btn')
      if (!btn) return
      const key = btn.dataset.curve
      this._active[key] = !this._active[key]
      btn.classList.toggle('active', this._active[key])
      this._draw()
    })
  }

  _bindCanvasEvents() {
    const bind = () => {
      const canvas = document.getElementById(this.canvasId)
      if (!canvas) return
      window.addEventListener('resize', () => {
        const canvas = document.getElementById(this.canvasId)
        if (!canvas) return
        canvas.style.width  = ''
        canvas.style.height = ''
        this._draw()
      })
      canvas.addEventListener('mousemove',  e => this._onMouseMove(e))
      canvas.addEventListener('mouseleave', () => this._onMouseLeave())
      canvas.addEventListener('touchmove', e => {
        e.preventDefault()
        canvas.dispatchEvent(new MouseEvent('mousemove', {
          clientX: e.touches[0].clientX,
          clientY: e.touches[0].clientY,
        }))
      }, { passive: false })
      canvas.addEventListener('touchend', () => canvas.dispatchEvent(new MouseEvent('mouseleave')))
    }
    document.readyState === 'loading'
      ? document.addEventListener('DOMContentLoaded', bind)
      : bind()
  }

  _draw() {
    const r      = this._result
    const canvas = document.getElementById(this.canvasId)
    if (!canvas || !r) return

    const timestamps = this.config.getTimestamps(r)
    if (!timestamps?.length) { canvas.style.display = 'none'; return }

    const W   = canvas.offsetWidth || 800
    const H   = this.config.height
    const pad = this._getPad(W)
    const cW  = W - pad.left - pad.right
    const cH  = H - pad.top  - pad.bottom
    const n   = timestamps.length
    const toX = i => pad.left + (i / Math.max(n - 1, 1)) * cW

    canvas.width        = W * devicePixelRatio
    canvas.height       = H * devicePixelRatio
    canvas.style.width  = W + 'px'
    canvas.style.height = H + 'px'
    const ctx = canvas.getContext('2d')
    ctx.scale(devicePixelRatio, devicePixelRatio)
    ctx.clearRect(0, 0, W, H)

    // Grid
    ctx.strokeStyle = '#2a2f3d'
    ctx.lineWidth   = 1
    for (let i = 0; i <= this.config.gridLines; i++) {
      const y = pad.top + (cH / this.config.gridLines) * i
      ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(pad.left + cW, y); ctx.stroke()
    }

    // Curves
    this.config.curves.forEach(c => {
      if (!this._active[c.key]) return
      const vals = c.getData(r)
      if (!vals?.length) return

      const curveN = vals.length
      const { mn, mx, toY } = _scaleY(vals, pad.top, cH)
      const pts = vals.map((v, i) => ({
        x: toX(Math.round(i / Math.max(curveN - 1, 1) * (n - 1))),
        y: toY(v),
      }))

      let color     = c.color     || 'rgba(108,142,255,0.8)'
      let fillColor = c.fillColor !== undefined ? c.fillColor : null

      if (c.dynamic) {
        const isPos = vals[vals.length - 1] >= vals[0]
        color     = _cssVar(isPos ? '--success' : '--danger')
        fillColor = _cssVar(isPos ? '--success-dim' : '--danger-dim')
        const btn = document.querySelector(`#${this.config.togglesContainerId} [data-curve="${c.key}"]`)
        if (btn) {
          btn.classList.remove('positive', 'negative')
          btn.classList.add(isPos ? 'positive' : 'negative')
        }
      }

      _drawPolyline(ctx, pts, color, fillColor, c.lineWidth || 1.5, pad.top, cH)

      const fmtVal = v => (c.prefix || '') + v.toFixed(v > 100 ? 0 : 2) + (c.suffix || '')
      ctx.font = '10px system-ui'
      if (c.axis === 'left') {
        ctx.fillStyle = color; ctx.textAlign = 'right'
        for (let i = 0; i <= this.config.gridLines; i++) {
          const v = mx - ((mx - mn) / this.config.gridLines) * i
          ctx.fillText(fmtVal(v), pad.left - 6, pad.top + (cH / this.config.gridLines) * i + 4)
        }
      }
      if (c.axis === 'right') {
        ctx.fillStyle = color; ctx.textAlign = 'left'
        for (let i = 0; i <= this.config.gridLines; i++) {
          const v = mx - ((mx - mn) / this.config.gridLines) * i
          ctx.fillText(fmtVal(v), pad.left + cW + 6, pad.top + (cH / this.config.gridLines) * i + 4)
        }
      }
    })
    
    const markers = r.equityMarkers
    if (markers?.length) {
      const tss      = this.config.getTimestamps(r)
      const t0       = tss[0]
      const t1       = tss[tss.length - 1]
      const span     = t1 - t0 || 1
      const eqCurve  = this.config.curves.find(c => c.key === 'equity')
      if (eqCurve && this._active['equity']) {
        const vals       = eqCurve.getData(r)
        const { toY }    = _scaleY(vals, pad.top, cH)
        markers.forEach(m => {
          const ratio = (m.t * 1000 - t0) / span
          if (ratio < 0 || ratio > 1) return
          const x     = pad.left + ratio * cW
          const y     = toY(m.e)
          const isBuy = m.s === 0
          const color = isBuy ? (_cssVar('--success') || '#34c47a') : (_cssVar('--danger') || '#e24b4a')
          // Outer ring
          ctx.beginPath()
          ctx.arc(x, y, 8, 0, Math.PI * 2)
          ctx.fillStyle = color + '33'
          ctx.fill()
          // Inner dot
          ctx.beginPath()
          ctx.arc(x, y, 4, 0, Math.PI * 2)
          ctx.fillStyle = color
          ctx.fill()
        })
      }
    }
    
    // Reference lines (e.g. initial capital)
    ;(this.config.referenceLines || []).forEach(rl => {
      const curve = this.config.curves.find(c => c.key === rl.curveKey)
      if (!curve || !this._active[curve.key]) return
      const vals = curve.getData(r)
      if (!vals?.length) return
      const { toY } = _scaleY(vals, pad.top, cH)
      const y = toY(rl.value)

      ctx.save()
      ctx.setLineDash(rl.dash || [5, 4])
      ctx.strokeStyle = rl.color || '#7c84a0'
      ctx.lineWidth   = rl.lineWidth || 1
      ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(pad.left + cW, y); ctx.stroke()
      ctx.restore()
      if (rl.label) {
        ctx.fillStyle = rl.color || '#7c84a0'
        ctx.font      = '10px system-ui'
        ctx.textAlign = 'left'
        ctx.fillText(rl.label, pad.left + 4, y - 4)
      }
    })

    // X-axis labels
    const fmtDate = this.config.formatDate || (ts => new Date(ts).toLocaleDateString())
    ctx.fillStyle = '#7c84a0'; ctx.font = '10px system-ui'; ctx.textAlign = 'center'
    const sampleLabelW = ctx.measureText(fmtDate(timestamps[0])).width + 12
    const maxLabels    = Math.max(2, Math.floor(cW / sampleLabelW))
    const step         = Math.max(1, Math.floor(n / maxLabels))
    for (let i = 0; i < n; i += step) {
      ctx.fillText(fmtDate(timestamps[i]), toX(i), pad.top + cH + 18)
    }
  }

  _onMouseMove(e) {
    const r = this._result
    if (!r) return
    const timestamps = this.config.getTimestamps(r)
    if (!timestamps?.length) return

    const canvas  = document.getElementById(this.canvasId)
    const rect    = canvas.getBoundingClientRect()
    const W       = canvas.offsetWidth
    const pad     = this._getPad(W)
    const ratio   = Math.max(0, Math.min(1, (e.clientX - rect.left - pad.left) / (W - pad.left - pad.right)))
    const idx     = Math.round(ratio * (timestamps.length - 1))
    const fmtDate = this.config.formatTooltipDate || this.config.formatDate || (ts => new Date(ts).toLocaleDateString())

    const lines = this.config.curves
      .filter(c => this._active[c.key])
      .map(c => {
        const vals = c.getData(r)
        if (!vals?.length) return null
        const v = vals[Math.round(ratio * (vals.length - 1))]
        if (v == null) return null
        const valStr  = (c.prefix || '') + (typeof v === 'number' ? v.toFixed(2) : v) + (c.suffix || '')
        const label   = _i18n(c.i18nKey, c.label || c.key)
        const classes = ['tt-' + c.key]
        if (c.dynamic) {
          const btn = document.querySelector(`#${this.config.togglesContainerId} [data-curve="${c.key}"]`)
          classes.push(btn?.classList.contains('positive') ? 'tt-positive' : 'tt-negative')
        }
        return `<span class="${classes.join(' ')}">● ${label} <strong>${valStr}</strong></span>`
      })
      .filter(Boolean)

    _showTooltip(e, `<div class="tt-date">${fmtDate(timestamps[idx])}</div>` + lines.join(''))

    // Cursor line overlay
    this._draw()
    const ctx  = canvas.getContext('2d')
    const pad2 = this._getPad(W)
    const cH   = this.config.height - pad2.top - pad2.bottom
    const x    = pad2.left + ratio * (W - pad2.left - pad2.right)
    ctx.save()
    ctx.setLineDash([4, 3])
    ctx.strokeStyle = 'rgba(255,255,255,0.15)'
    ctx.lineWidth   = 1
    ctx.beginPath(); ctx.moveTo(x, pad2.top); ctx.lineTo(x, pad2.top + cH); ctx.stroke()
    ctx.restore()
  }

  _onMouseLeave() {
    _hideTooltip()
    this._draw()
  }
}


// BarChart  (replaces HorizontalBarChart)
/**
 * Generic horizontal bar chart. Each row can have N segments (e.g. win+loss,
 * or a single PnL bar, etc.) - fully driven by config.
 *
 * @param {string} containerId
 * @param {string} filtersId        - container for toggle buttons (pass '' to disable)
 * @param {object} config
 *   getBars       (r) => Record<string, object>
 *                       - each value is the data object passed to getValue / getLabel
 *   getLabel      (key, d) => { title: string, sub?: string }
 *   segments      Array<{
 *                   key       string
 *                   getValue  (d) => number   - the numeric value for this segment
 *                   suffix?   string          e.g. '%'
 *                   prefix?   string
 *                   color?    string          CSS color or var(--...)
 *                   label?    string          shown in tooltip / legend
 *                 }>
 *   order?        string[]          - optional sort order for bar keys
 *   defaultActive?(key) => bool     - which keys start active (default: all true)
 */
class BarChart {
  constructor(containerId, filtersId, config) {
    this.containerId = containerId
    this.filtersId   = filtersId
    this.config      = config
    this._result     = null
    this._active     = {}
    this._data       = null
  }

  render(result) {
    this._result = result
    this._data   = this.config.getBars(result)
    const keys   = Object.keys(this._data)

    if (!keys.length) {
      document.getElementById(this.containerId)?.closest('.card')?.classList.add('hidden')
      return
    }

    // Init active state once
    keys.forEach(k => {
      if (this._active[k] === undefined)
        this._active[k] = this.config.defaultActive ? this.config.defaultActive(k) : true
    })

    this._renderFilters()
    this._draw()
  }

  // Private
  _sortedKeys(keys) {
    const order = this.config.order || []
    return [...keys].sort((a, b) => {
      const ia = order.indexOf(a), ib = order.indexOf(b)
      if (ia === -1 && ib === -1) return a.localeCompare(b)
      return (ia === -1 ? Infinity : ia) - (ib === -1 ? Infinity : ib)
    })
  }

  _renderFilters() {
    const el = document.getElementById(this.filtersId)
    if (!el) return

    // Only re-build DOM if the key set changed (avoids resetting button state)
    const keys   = this._sortedKeys(Object.keys(this._data))
    const newHtml = keys.map(k => {
      const { title } = this.config.getLabel(k, this._data[k])
      return `<button class="toggle-btn ${this._active[k] ? 'active' : ''}" data-key="${k}">${title}</button>`
    }).join('')
    if (el.dataset.chartKeys === keys.join(',')) return // already rendered
    el.dataset.chartKeys = keys.join(',')
    el.innerHTML = newHtml

    el.addEventListener('click', e => {
      const btn = e.target.closest('[data-key]')
      if (!btn) return
      const k = btn.dataset.key
      this._active[k] = !this._active[k]
      btn.classList.toggle('active', this._active[k])
      this._draw()
    })
  }

  _draw() {
    const container = document.getElementById(this.containerId)
    if (!container || !this._data) return

    const activeKeys = this._sortedKeys(Object.keys(this._data)).filter(k => this._active[k])
    if (!activeKeys.length) {
      container.innerHTML = `<div class="text-muted text-sm p-sm" style="padding:.75rem 0">Nothing to display.</div>`
      return
    }

    // Normalise all segment values to [0, 100] relative to the max across all bars
    const allValues = activeKeys.flatMap(k =>
      this.config.segments.map(s => s.getValue(this._data[k]) || 0)
    )
    const maxVal = Math.max(...allValues) || 1

    container.innerHTML = activeKeys.map(k => {
      const d              = this._data[k]
      const { title, sub } = this.config.getLabel(k, d)

      const barsHtml = this.config.segments.map(s => {
        const val    = s.getValue(d) || 0
        const pct    = (val / maxVal * 100).toFixed(1)
        const valStr = (s.prefix || '') + (Number.isInteger(val) ? val : val.toFixed(1)) + (s.suffix || '')
        const color  = s.color || 'var(--accent)'
        return `
          <div class="er-bar-wrap">
            <div class="er-bar" style="width:${pct}%; background:${color}"></div>
            <span class="er-bar-val">${valStr}</span>
          </div>`
      }).join('')

      return `
        <div class="er-row">
          <div class="er-label">
            <span class="er-${k}-title">${title}</span>
            ${sub ? `<span class="text-muted text-sm">${sub}</span>` : ''}
          </div>
          <div class="er-bars">${barsHtml}</div>
        </div>`
    }).join('')
  }
}


// CanvasHistogram
/**
 * Vertical bar histogram - ideal for PnL distribution.
 * Bars left of zero are red, right of zero are green.
 *
 * @param {string} canvasId
 * @param {object} config
 *   getBuckets   (r) => Array<{ label, count, wins, losses }>
 *                       - use buildPnlBuckets() output converted via Object.values()
 *   height?      number   default 240
 *   gridLines?   number   default 4
 *   colorWin?    string   CSS color for profitable buckets
 *   colorLoss?   string   CSS color for loss buckets
 *
 * Usage:
 *   const pnlChart = new CanvasHistogram('pnlDistributionCanvas', {
 *     getBuckets: r => buildPnlBuckets(r.trades || []),
 *   })
 *   pnlChart.render(jobResult)
 */
class CanvasHistogram {
  constructor(canvasId, config) {
    this.canvasId = canvasId
    this.config   = { height: 240, gridLines: 4, ...config }
    this._result  = null
    this._bindEvents()
  }

  render(result) {
    this._result = result
    this._draw()
  }

  // Private
  _getPad() {
    return { top: 16, right: 8, bottom: 32, left: 16 }
  }

  _getBuckets() {
    const raw = this.config.getBuckets(this._result)
    // Accept both Record<label, {count,wins,losses}> and Array
    if (Array.isArray(raw)) return raw
    return Object.entries(raw).map(([label, d]) => ({ label, ...d }))
  }

  _draw() {
    const canvas = document.getElementById(this.canvasId)
    if (!canvas || !this._result) return

    const buckets = this._getBuckets()
    if (!buckets.length) { canvas.style.display = 'none'; return }

    const W   = canvas.offsetWidth || 600
    const H   = this.config.height
    
    const pad = this._getPad()
    const cW  = W - pad.left - pad.right
    const cH  = H - pad.top  - pad.bottom

    canvas.width        = W * devicePixelRatio
    canvas.height       = H * devicePixelRatio
    canvas.style.width  = W + 'px'
    canvas.style.height = H + 'px'
    const ctx = canvas.getContext('2d')
    ctx.scale(devicePixelRatio, devicePixelRatio)
    ctx.clearRect(0, 0, W, H)

    const maxCount  = Math.max(...buckets.map(b => b.count))
    const n         = buckets.length
    const barW      = Math.max(2, (cW / n) * 0.72)
    const gap       = cW / n
    const colorWin  = this.config.colorWin  || _cssVar('--success') || '#22c55e'
    const colorLoss = this.config.colorLoss || _cssVar('--danger')  || '#ef4444'
    const colorWinDim  = this.config.colorWinDim  || _cssVar('--success-dim') || 'rgba(34,197,94,0.35)'
    const colorLossDim = this.config.colorLossDim || _cssVar('--danger-dim')  || 'rgba(239,68,68,0.35)'

    // Grid lines
    ctx.strokeStyle = '#2a2f3d'
    ctx.lineWidth   = 1
    for (let i = 0; i <= this.config.gridLines; i++) {
      const y = pad.top + (cH / this.config.gridLines) * i
      ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(pad.left + cW, y); ctx.stroke()
    }

    // Y axis labels
    ctx.fillStyle = '#7c84a0'; ctx.font = '10px system-ui'; ctx.textAlign = 'right'
    for (let i = 0; i <= this.config.gridLines; i++) {
      const v = Math.round(maxCount - (maxCount / this.config.gridLines) * i)
      const y = pad.top + (cH / this.config.gridLines) * i
      ctx.fillText(v, pad.left - 6, y + 4)
    }

    // Bars
    buckets.forEach((b, i) => {
      const x      = pad.left + i * gap + (gap - barW) / 2
      const barH   = (b.count / maxCount) * cH
      const y      = pad.top + cH - barH
      // Determine color: bucket is a win bucket if label starts with '+'
      const isWin  = b.label.trimStart().startsWith('+')
      const fill   = isWin ? colorWin  : colorLoss
      const dimFill = isWin ? colorWinDim : colorLossDim

      // Bar body
      ctx.fillStyle = this._hoveredIdx === i ? fill : dimFill
      ctx.beginPath()
      ctx.roundRect?.(x, y, barW, barH, [3, 3, 0, 0]) || ctx.rect(x, y, barW, barH)
      ctx.fill()

      // Bar border top
      ctx.fillStyle = fill
      ctx.fillRect(x, y, barW, 2)

      // X label - show every other if tight
      if (n <= 12 || i % 2 === 0) {
        ctx.save()
        ctx.fillStyle   = '#7c84a0'
        ctx.font        = '9px system-ui'
        ctx.textAlign   = 'center'
        ctx.translate(x + barW / 2, pad.top + cH + 10)
        ctx.rotate(-Math.PI / 4)
        // Show only the left bound of the range for brevity
        const shortLabel = (b.lo >= 0 ? '+' : '') + b.lo.toFixed(1) + '%'
        ctx.fillText(shortLabel, 0, 0)
        ctx.restore()
      }
    })

    this._buckets = buckets
    this._pad     = pad
    this._gap     = gap
    this._barW    = barW
    this._cH      = cH
  }

  _bindEvents() {
    const bind = () => {
      const canvas = document.getElementById(this.canvasId)
      if (!canvas) return
      window.addEventListener('resize', () => {
        const canvas = document.getElementById(this.canvasId)
        if (!canvas) return
        canvas.style.width  = ''
        canvas.style.height = ''
        this._draw()
      })
      canvas.addEventListener('mousemove', e => {
        const rect  = canvas.getBoundingClientRect()
        const mouseX = e.clientX - rect.left
        const pad   = this._getPad()
        const n     = this._buckets?.length || 0
        const gap   = (canvas.offsetWidth - pad.left - pad.right) / (n || 1)
        const idx   = Math.floor((mouseX - pad.left) / gap)
        if (idx >= 0 && idx < n) {
          const b = this._buckets[idx]
          _showTooltip(e,
            `<div class="tt-date">${b.label}</div>` +
            `<span>Trades : <strong>${b.count}</strong></span>`
          )
          if (this._hoveredIdx !== idx) {
            this._hoveredIdx = idx
            this._draw()
          }
        } else {
          _hideTooltip()
          if (this._hoveredIdx != null) { this._hoveredIdx = null; this._draw() }
        }
      })
      canvas.addEventListener('mouseleave', () => {
        _hideTooltip()
        if (this._hoveredIdx != null) { this._hoveredIdx = null; this._draw() }
      })
      canvas.addEventListener('touchmove', e => {
        e.preventDefault()
        const touch = e.touches[0]
        canvas.dispatchEvent(new MouseEvent('mousemove', {
          clientX: touch.clientX,
          clientY: touch.clientY,
        }))
      }, { passive: false })
      canvas.addEventListener('touchend', () => canvas.dispatchEvent(new MouseEvent('mouseleave')))
    }
    document.readyState === 'loading'
      ? document.addEventListener('DOMContentLoaded', bind)
      : bind()
  }
}

// TradesHeatmap
/**
 * 1D row heatmap - distribution des trades dans le temps.
 * Le pas de la grille s'adapte au timeframe de la strat pour éviter
 * le vide artificiel (ex: pas 1d sur du 1w, pas 1min sur du 1d).
 *
 * Timeframes supportés : 1m 5m 15m 30m 1h 4h 1d 1w
 *
 * @param {string} canvasId
 * @param {object} config
 *   getBucket      (r) => Record<ISOstring, number>  - date->count
 *   getTimeframe   (r) => string                     - '1d', '1h', etc.
 *   height?        number   hauteur canvas en px (default 72)
 *   gap?           number   gap entre cellules (default 2)
 *   radius?        number   arrondi cellules (default 3)
 *   colorEmpty?    string   couleur vide
 *   colorMax?      string   couleur max
 */
class TradesHeatmap {
  constructor(canvasId, config) {
    this.canvasId = canvasId
    this.config   = {
      height:     36,
      gap:        2,
      radius:     3,
      colorEmpty: '#1e2130',
      ...config,
    }
    this._result  = null
    this._slots   = []
    this._hovered = -1
    this._bindEvents()
  }

  render(result, snapshot) {
    this._result   = result
    this._snapshot = snapshot
    this._draw()
  }

  // Timeframe -> durée d'un slot en ms 
  _slotMs(timeframe) {
    const map = {
      '1m':  60 * 1000,
      '5m':  5  * 60 * 1000,
      '15m': 15 * 60 * 1000,
      '30m': 30 * 60 * 1000,
      '1h':  60 * 60 * 1000,
      '4h':  4  * 60 * 60 * 1000,
      '1d':  24 * 60 * 60 * 1000,
      '1w':  7  * 24 * 60 * 60 * 1000,
    }
    return map[timeframe] || (24 * 60 * 60 * 1000)
  }

  _autoSlotMs(entries) {
    const spanDays = (entries[entries.length - 1].ms - entries[0].ms) / 86400000
    if (spanDays <= 2)   return this._slotMs('1h')
    if (spanDays <= 14)  return this._slotMs('1d')
    if (spanDays <= 90)  return this._slotMs('1w')
    return 30 * 86400000 // 1 mois
  }

  // Format tooltip selon le timeframe 
  _fmtDate(ms, timeframe) {
    const d = new Date(ms)
    const hasTime = !['1d','1w'].includes(timeframe)
    return d.toLocaleDateString(undefined, {
      day: 'numeric', month: 'short', year: 'numeric',
      ...(hasTime ? { hour: '2-digit', minute: '2-digit' } : {})
    })
  }

  // Format axe X : plus court que le tooltip 
  _fmtAxis(ms, timeframe) {
    const d = new Date(ms)
    if (['1w'].includes(timeframe))
      return d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
    if (['1d'].includes(timeframe))
      return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) +
      ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  }

  _parseBucket() {
    const raw = this.config.getBucket(this._result)
    if (!raw) return []
    return Object.entries(raw)
      .map(([iso, count]) => ({ ms: new Date(iso).getTime(), count }))
      .filter(e => !isNaN(e.ms))
      .sort((a, b) => a.ms - b.ms)
  }

  _lerpColor(t) {
    const parse = str => {
      const h = str.replace(/^#/, '')
      return h.length === 6
        ? [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)]
        : [0,0,0]
    }
    const [r2,g2,b2] = parse((this.config.colorMax || _cssVar('--accent') || '#6c8eff').trim())
    const [r1,g1,b1] = parse(this.config.colorEmpty)
    return `rgb(${Math.round(r1+(r2-r1)*t)},${Math.round(g1+(g2-g1)*t)},${Math.round(b1+(b2-b1)*t)})`
  }

  _roundRect(ctx, x, y, w, h, r) {
    if (ctx.roundRect) { ctx.roundRect(x, y, w, h, r); return }
    const m = Math.min(r, w/2, h/2)
    ctx.moveTo(x+m,y); ctx.arcTo(x+w,y,x+w,y+h,m); ctx.arcTo(x+w,y+h,x,y+h,m)
    ctx.arcTo(x,y+h,x,y,m); ctx.arcTo(x,y,x+w,y,m); ctx.closePath()
  }

  _draw() {
    const canvas = document.getElementById(this.canvasId)
    if (!canvas || !this._result) return

    const entries = this._parseBucket()
    if (!entries.length) { canvas.style.display = 'none'; return }
    canvas.style.display = ''

    const timeframe = this.config.getTimeframe(this._snapshot)
    const slotMs    = this._slotMs(timeframe)

    const startMs  = entries[0].ms
    const endMs    = entries[entries.length - 1].ms
    const numSlots = Math.round((endMs - startMs) / slotMs) + 1

    const countMap = {}
    entries.forEach(({ ms, count }) => {
      const key = Math.floor((ms - startMs) / slotMs) * slotMs + startMs
      countMap[key] = (countMap[key] || 0) + count
    })

    const { height: H, gap, radius } = this.config
    const PAD = { top: 8, right: 8, bottom: 20, left: 8 }

    const W  = canvas.offsetWidth || 700
    const cW = W - PAD.left - PAD.right
    const cH = H - PAD.top  - PAD.bottom

    const dpr = devicePixelRatio || 1
    canvas.width        = W * dpr
    canvas.height       = H * dpr
    canvas.style.width  = W + 'px'
    canvas.style.height = H + 'px'
    const ctx = canvas.getContext('2d')
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, W, H)

    const minCellW = 4
    const rawCellW = (cW - gap * (numSlots - 1)) / numSlots
    const mergeBy  = Math.max(1, Math.ceil(minCellW / rawCellW))
    const blocks   = []
    for (let i = 0; i < Math.ceil(numSlots / mergeBy); i++) {
      let total = 0
      for (let j = 0; j < mergeBy; j++) {
        const key = startMs + (i * mergeBy + j) * slotMs
        total += countMap[key] || 0
      }
      blocks.push({ count: total, slotStart: startMs + i * mergeBy * slotMs })
    }

    const cellW    = (cW - gap * (blocks.length - 1)) / blocks.length
    const cellH    = cH
    const maxCount = Math.max(...blocks.map(b => b.count), 1)

    this._slots = blocks.map((b, i) => ({
      count:     b.count,
      slotStart: b.slotStart,
      x:         PAD.left + i * (cellW + gap),
      y:         PAD.top,
      w:         cellW,
      h:         cellH,
    }))

    // Draw cells 
    this._slots.forEach((slot, i) => {
      const t     = slot.count > 0 ? Math.pow(slot.count / maxCount, 0.55) : 0
      const color = slot.count > 0 ? this._lerpColor(t) : this.config.colorEmpty
      ctx.beginPath()
      this._roundRect(ctx, slot.x, slot.y, Math.max(slot.w, 1), slot.h, radius)
      ctx.fillStyle = color
      ctx.fill()
      if (this._hovered === i) {
        ctx.beginPath()
        this._roundRect(ctx, slot.x, slot.y, Math.max(slot.w, 1), slot.h, radius)
        ctx.strokeStyle = 'rgba(255,255,255,0.6)'
        ctx.lineWidth   = 1.5
        ctx.stroke()
      }
    })

    // Axis labels (bottom) 
    ctx.fillStyle    = '#7c84a0'
    ctx.font         = '10px system-ui'
    ctx.textBaseline = 'bottom'
    const sampleW    = ctx.measureText(this._fmtAxis(startMs, timeframe)).width + 12
    const maxLabels  = Math.min(Math.max(2, Math.floor(cW / sampleW)), 6)
    for (let li = 0; li <= maxLabels; li++) {
      const frac = li / maxLabels
      const ms   = startMs + frac * (endMs - startMs)
      const x    = PAD.left + frac * cW
      ctx.textAlign = li === 0 ? 'left' : li === maxLabels ? 'right' : 'center'
      ctx.fillText(this._fmtAxis(ms, timeframe), x, H - 2)
    }
  }

  _bindEvents() {
    const bind = () => {
      const canvas = document.getElementById(this.canvasId)
      if (!canvas) return
      window.addEventListener('resize', () => {
        const c = document.getElementById(this.canvasId)
        if (!c) return
        c.style.width = ''; c.style.height = ''
        this._draw()
      })
    }
    document.readyState === 'loading'
      ? document.addEventListener('DOMContentLoaded', bind)
      : bind()
  }
}

// MonthlyPerfChart
/**
 * Grouped bar chart — monthly perf: strategy vs asset, with optional delta line.
 *
 * @param {string} canvasId
 * @param {object} config
 *   getData      (r) => Array<{ month: string, strat: number, asset: number }>
 *   showDelta?   bool     overlay delta line (strat − asset), default true
 *   height?      number   default 220
 *   gridLines?   number   default 4
 */
class MonthlyPerfChart {
  constructor(canvasId, config) {
    this.canvasId   = canvasId
    this.config     = { height: 220, gridLines: 4, showDelta: true, windowSize: 12, ...config }
    this._result    = null
    this._data      = []
    this._winStart  = 0
    this._isMobile  = false
    this._bindEvents()
  }

  render(result) {
    this._result  = result
    this._data    = this.config.getData(result) || []
    if (this._isMobileNow()) this._winStart = Math.max(0, this._data.length - this.config.windowSize)
    this._syncNav()
    this._draw()
  }

  _isMobileNow() {
      const c = document.getElementById(this.canvasId)
      const w = c?.offsetWidth || 0
      return w > 0 && w < 640
    }

    _visibleData() {
      if (!this._isMobileNow()) return this._data
      const start = Math.max(0, this._winStart)
      const slice = this._data.slice(start, start + this.config.windowSize)
      return slice.length ? slice : this._data.slice(0, this.config.windowSize)
    }

  _syncNav() {
    const nav = document.getElementById(this.canvasId + 'Nav')
    if (!nav) return
    nav.style.display = this._isMobileNow() && this._data.length > this.config.windowSize ? 'flex' : 'none'
    const total = this._data.length
    const end   = Math.min(this._winStart + this.config.windowSize, total)
    nav.querySelector('.mpf-range').textContent =
      `${this._data[this._winStart]?.month} - ${this._data[end - 1]?.month}`
    nav.querySelector('#mpfPrev').disabled = this._winStart === 0
    nav.querySelector('#mpfNext').disabled = end >= total
    nav.querySelector('#mpfPrevFast').disabled = this._winStart === 0
    nav.querySelector('#mpfNextFast').disabled = end >= total
  }

  // Private
  _getPad(W) {
    return W < 640
      ? { top: 16, right: 8, bottom: 28, left: 42 }
      : { top: 16, right: 8, bottom: 28, left: 48 }
  }

  _draw(hoveredIdx = -1) {
    const canvas = document.getElementById(this.canvasId)
    if (!canvas || !this._result) return

    const data = this._visibleData()
    if (!data?.length) { canvas.style.display = 'none'; return }
    canvas.style.display = ''

    const W   = canvas.offsetWidth || 700
    const H   = this.config.height
    const pad = this._getPad(W)
    const cW  = W - pad.left - pad.right
    const cH  = H - pad.top  - pad.bottom

    const dpr = devicePixelRatio || 1
    canvas.width        = W * dpr
    canvas.height       = H * dpr
    canvas.style.width  = W + 'px'
    canvas.style.height = H + 'px'
    const ctx = canvas.getContext('2d')
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, W, H)

    const n      = data.length
    const allVals = data.flatMap(d => [d.strat, d.asset ?? 0, this.config.showDelta ? d.strat - (d.asset ?? 0) : 0])
    const mn     = Math.min(...allVals, 0)
    const mx     = Math.max(...allVals, 0)
    const rng    = mx - mn || 1
    const toY    = v => pad.top + cH - ((v - mn) / rng) * cH
    const zeroY  = toY(0)

    const colorStrat    = _cssVar('--success') || '#22c55e'
    const colorStratNeg = _cssVar('--danger') || '#ef4444'
    const colorAsset    = '#c8cdd8'
    const colorAssetNeg = '#5a6075'
    const colorDelta    = _cssVar('--warning') || '#e8a838'

    // Grid
    ctx.strokeStyle = '#2a2f3d'
    ctx.lineWidth   = 1
    for (let i = 0; i <= this.config.gridLines; i++) {
      const y = pad.top + (cH / this.config.gridLines) * i
      ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(pad.left + cW, y); ctx.stroke()
    }

    // Zero line
    if (zeroY > pad.top && zeroY < pad.top + cH) {
      ctx.strokeStyle = '#4a5068'
      ctx.lineWidth   = 1
      ctx.beginPath(); ctx.moveTo(pad.left, zeroY); ctx.lineTo(pad.left + cW, zeroY); ctx.stroke()
    }

    // Y labels
    ctx.fillStyle = '#7c84a0'; ctx.font = '10px system-ui'; ctx.textAlign = 'right'
    for (let i = 0; i <= this.config.gridLines; i++) {
      const v = mx - (rng / this.config.gridLines) * i
      const y = pad.top + (cH / this.config.gridLines) * i
      ctx.fillText((v >= 0 ? '+' : '') + v.toFixed(1) + '%', pad.left - 5, y + 4)
    }

    // Bars
    const slotW   = cW / n
    const barW    = Math.max(2, slotW * 0.38)
    const spacing = 0

    this._bars = []
    data.forEach((d, i) => {
      const cx      = pad.left + i * slotW + slotW / 2
      const xA      = cx - barW - spacing / 2
      const xS      = cx + spacing / 2
      const dimmed  = hoveredIdx >= 0 && i !== hoveredIdx
      const alpha   = dimmed ? '55' : ''

      const drawBar = (x, v, pos, neg) => {
        if (v === null || v === undefined) return
        const y  = toY(Math.max(v, 0))
        const y2 = toY(Math.min(v, 0))
        const bH = Math.abs(y2 - y) || 1
        ctx.fillStyle = (v >= 0 ? pos : neg) + alpha
        ctx.beginPath()
        ctx.roundRect?.(x, Math.min(y, y2), barW, bH, v >= 0 ? [2, 2, 0, 0] : [0, 0, 2, 2])
          || ctx.rect(x, Math.min(y, y2), barW, bH)
        ctx.fill()
      }

      drawBar(xA, d.asset, colorAsset, colorAssetNeg)
      drawBar(xS, d.strat, colorStrat, colorStratNeg)
      this._bars.push({ d, x: cx - barW - spacing / 2, w: barW * 2 + spacing, slotX: pad.left + i * slotW, slotW })
    })

    // Delta line
    if (this.config.showDelta) {
      const pts = data.map((d, i) => ({
        x: pad.left + i * slotW + slotW / 2,
        y: toY(d.strat - (d.asset ?? 0)),
        dimmed: hoveredIdx >= 0 && i !== hoveredIdx,
      }))
      ctx.beginPath()
      pts.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y))
      ctx.strokeStyle = hoveredIdx >= 0 ? colorDelta + '33' : colorDelta
      ctx.lineWidth   = 1.5
      ctx.setLineDash([3, 3])
      ctx.stroke()
      ctx.setLineDash([])
      pts.forEach((p, i) => {
        const isHovered = i === hoveredIdx
        ctx.beginPath()
        ctx.arc(p.x, p.y, isHovered ? 3 : 2.5, 0, Math.PI * 2)
        ctx.fillStyle = p.dimmed ? colorDelta + '33' : colorDelta
        ctx.fill()
        if (isHovered) {
          ctx.beginPath()
          ctx.arc(p.x, p.y, 4.5, 0, Math.PI * 2)
          ctx.strokeStyle = colorDelta
          ctx.lineWidth   = 1.5
          ctx.stroke()
        }
      })
    }

    // X labels
  ctx.fillStyle = '#7c84a0'; ctx.font = '10px system-ui'; ctx.textAlign = 'center'
  let lastLabelX = -Infinity
  const minGap   = 8
  data.forEach((d, i) => {
    const x   = pad.left + i * slotW + slotW / 2
    const lbl = n > 14
      ? d.month.slice(2).replace('-', '/')
      : new Date(d.month + '-01').toLocaleDateString(undefined, { month: 'short', year: '2-digit' })
    const w = ctx.measureText(lbl).width
    if (x - w / 2 < lastLabelX + minGap) return
    ctx.fillText(lbl, x, pad.top + cH + 16)
    lastLabelX = x + w / 2
  })

    this._pad   = pad
    this._slotW = slotW
    this._toY   = toY
    this._mn    = mn; this._mx = mx
  }

  _bindEvents() {
    const bind = () => {
      const canvas = document.getElementById(this.canvasId)
      if (!canvas) return
      window.addEventListener('resize', () => {
        const c = document.getElementById(this.canvasId)
        if (!c) return
        c.style.width = ''; c.style.height = ''
        this._draw()
      })
      // Nav buttons (mobile window)
      const nav = document.getElementById(this.canvasId + 'Nav')
      if (nav) {
        nav.querySelector('#mpfPrevFast').addEventListener('click', () => {
          this._winStart = Math.max(0, this._winStart - this.config.windowSize)
          this._syncNav()
          this._draw()
        })
        nav.querySelector('#mpfPrev').addEventListener('click', () => {
          // this._winStart = Math.max(0, this._winStart - this.config.windowSize)
          this._winStart = Math.max(0, this._winStart - 1)
          this._syncNav()
          this._draw()
        })
        nav.querySelector('#mpfNext').addEventListener('click', () => {
          this._winStart = Math.min(
            this._data.length - 1,
            this._winStart + 1
          )
          this._syncNav()
          this._draw()
        })
        nav.querySelector('#mpfNextFast').addEventListener('click', () => {
          this._winStart = Math.min(
            this._data.length - this.config.windowSize,
            this._winStart + this.config.windowSize
          )
          this._syncNav()
          this._draw()
        })
      }

      // Re-evaluate mobile on resize
      window.addEventListener('resize', () => {
        const c = document.getElementById(this.canvasId)
        if (!c) return
        c.style.width = ''; c.style.height = ''
        this._syncNav()
        this._draw()
      })
      canvas.addEventListener('mousemove', e => {
        const visible = this._visibleData()
        if (!visible?.length) return
        const rect  = canvas.getBoundingClientRect()
        const mouseX = e.clientX - rect.left
        const pad   = this._getPad(canvas.offsetWidth)
        const i = Math.floor((mouseX - pad.left) / this._slotW)
        if (i >= 0 && i < visible.length) {
          const d = visible[i]
          const delta = d.strat - (d.asset ?? 0)
          const fmt   = v => (v >= 0 ? '+' : '') + v.toFixed(2) + '%'
          _showTooltip(e,
            `<div class="tt-date">${d.month}</div>` +
            `<span>Strat : <strong>${fmt(d.strat)}</strong></span>` +
            `<span>Asset : <strong>${fmt(d.asset ?? 0)}</strong></span>` +
            (this.config.showDelta ? `<span>Delta : <strong style="color:#e8a838">${fmt(delta)}</strong></span>` : '')
          )
          // Cursor line
          this._draw(i)
          const ctx2 = canvas.getContext('2d')
          const x    = pad.left + i * this._slotW + this._slotW / 2
          const cH   = this.config.height - pad.top - pad.bottom
          ctx2.save()
          ctx2.setLineDash([4, 3])
          ctx2.strokeStyle = 'rgba(255,255,255,0.15)'
          ctx2.lineWidth   = 1
          ctx2.beginPath(); ctx2.moveTo(x, pad.top); ctx2.lineTo(x, pad.top + cH); ctx2.stroke()
          ctx2.restore()
        } else {
          _hideTooltip()
          this._draw()
        }
      })
      canvas.addEventListener('mouseleave', e => {
        _hideTooltip()
        this._draw()
      })
      canvas.addEventListener('touchmove', e => {
        e.preventDefault()
        const touch = e.touches[0]
        canvas.dispatchEvent(new MouseEvent('mousemove', {
          clientX: touch.clientX,
          clientY: touch.clientY,
        }))
      }, { passive: false })
      canvas.addEventListener('touchend', () => canvas.dispatchEvent(new MouseEvent('mouseleave')))
    }
    document.readyState === 'loading'
      ? document.addEventListener('DOMContentLoaded', bind)
      : bind()
  }
}