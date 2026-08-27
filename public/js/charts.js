/**
 * charts.js - Reusable chart primitives for SnipeIT results page.
 *
 * Classes:
 *   CanvasLineChart  - multi-curve canvas chart with toggles & hover tooltip
 *   BarChart         - generic horizontal bar chart; segments are fully configurable
 *   CanvasHistogram  - bucketed distribution chart (win/loss or single-color)
 *   CanvasScatter    - X/Y scatter plot with nearest-point hover tooltip
 *   MonthlyPerfChart - grouped bar chart, strategy vs asset, optional delta line
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
window.addEventListener('scroll', () => _hideTooltip(), { passive: true })
window.addEventListener('wheel', () => _hideTooltip(), { passive: true })
window.addEventListener('touchmove', () => _hideTooltip(), { passive: true })

// Helpers
function _cssVar(name) {
  return window.getComputedStyle(document.body).getPropertyValue(name).trim()
}

function _scaleY(values, padTop, cH) {
  const mn = Math.min(...values)
  const mx = Math.max(...values)
  const rng = mx - mn || 1
  return { mn, mx, rng, toY: v => padTop + cH - ((v - mn) / rng) * cH }
}

function _scaleX(values, padLeft, cW) {
  const mn = Math.min(...values)
  const mx = Math.max(...values)
  const rng = mx - mn || 1
  return { mn, mx, rng, toX: v => padLeft + ((v - mn) / rng) * cW }
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
  ctx.lineWidth = lineWidth
  ctx.stroke()
}

function _i18n(key, fallback) {
  return (key && typeof t === 'function') ? t(key) : (fallback || key || '')
}

function _toggleChartCard(elementId, hasData) {
  document.getElementById(elementId)?.closest('.card')?.classList.toggle('hidden', !hasData)
}

// Re-run a canvas chart's draw whenever the canvas's actual box size
// changes - covers window resizes AND layout shifts caused by something
// else entirely (e.g. a sibling card in the same row growing taller),
// which a plain window 'resize' listener can't see since the viewport
// itself didn't change.
function _observeCanvasResize(canvas, onResize) {
  let lastW = canvas.offsetWidth
  let lastH = canvas.offsetHeight
  const ro = new ResizeObserver(entries => {
    const { width, height } = entries[0].contentRect
    // Round + compare to avoid a feedback loop: onResize() itself sets
    // canvas.style.width/height, which would otherwise re-trigger this.
    const w = Math.round(width)
    const h = Math.round(height)
    if (w === lastW && h === lastH) return
    lastW = w; lastH = h
    onResize()
  })
  ro.observe(canvas)
  return ro
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
    this.config = { height: 300, gridLines: 4, ...config }
    this._result = null
    this._active = Object.fromEntries(
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
  _measurePad(canvas, r) {
    const W = canvas.offsetWidth || 800
    const small = W < 640
    const ctx = canvas.getContext('2d')
    ctx.font = '10px system-ui'

    const widestLabel = axis => {
      let max = 0
      this.config.curves.forEach(c => {
        if (c.axis !== axis || !this._active[c.key]) return
        const vals = c.getData(r)
        if (!vals?.length) return
        const mn = Math.min(...vals), mx = Math.max(...vals)
        const fmtVal = v => (c.prefix || '') + v.toFixed(v > 100 ? 0 : 2) + (c.suffix || '')
        for (let i = 0; i <= this.config.gridLines; i++) {
          const v = mx - ((mx - mn) / this.config.gridLines) * i
          max = Math.max(max, ctx.measureText(fmtVal(v)).width)
        }
      })
      return max
    }

    const margin = 0 // small ? 20 : 25
    const wLeft = widestLabel('left')
    const wRight = widestLabel('right')
    return {
      top: small ? 16 : 20,
      right: wRight ? wRight + margin : 8,
      bottom: small ? 24 : 30,
      left: wLeft ? wLeft + margin : 8,
    }
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
      const activeCount = Object.values(this._active).filter(Boolean).length
      // Refuse to turn off the last remaining curve to avoid empty chart
      if (this._active[key] && activeCount <= 1) return
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
        canvas.style.width = ''
        canvas.style.height = ''
        this._draw()
      })
      canvas.addEventListener('mousemove', e => this._onMouseMove(e))
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
    const r = this._result
    const canvas = document.getElementById(this.canvasId)
    if (!canvas || !r) return

    const timestamps = this.config.getTimestamps(r)
    _toggleChartCard(this.canvasId, !!timestamps?.length)
    if (!timestamps?.length) { canvas.style.display = 'none'; return }
    canvas.style.display = ''

    canvas.style.width = ''
    canvas.style.height = ''
    canvas.width = 0
    canvas.height = 0
    const W = canvas.offsetWidth || 800
    const H = this.config.height
    const pad = this._measurePad(canvas, r)
    const cW = W - pad.left - pad.right
    const cH = H - pad.top - pad.bottom
    const n = timestamps.length
    const toX = i => pad.left + (i / Math.max(n - 1, 1)) * cW

    canvas.width = W * devicePixelRatio
    canvas.height = H * devicePixelRatio
    canvas.style.width = W + 'px'
    canvas.style.height = H + 'px'
    const ctx = canvas.getContext('2d')
    ctx.scale(devicePixelRatio, devicePixelRatio)
    ctx.clearRect(0, 0, W, H)

    // Grid
    ctx.strokeStyle = '#2a2f3d'
    ctx.lineWidth = 1
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

      let color = c.color || 'rgba(108,142,255,0.8)'
      let fillColor = c.fillColor !== undefined ? c.fillColor : null

      if (c.dynamic) {
        const isPos = vals[vals.length - 1] >= vals[0]
        color = _cssVar(isPos ? '--success' : '--danger')
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

      // Reference lines (e.g. initial capital)
      ; (this.config.referenceLines || []).forEach(rl => {
        const curve = this.config.curves.find(c => c.key === rl.curveKey)
        if (!curve || !this._active[curve.key]) return
        const vals = curve.getData(r)
        if (!vals?.length) return
        const { toY } = _scaleY(vals, pad.top, cH)
        const y = toY(rl.value)

        ctx.save()
        ctx.setLineDash(rl.dash || [5, 4])
        ctx.strokeStyle = rl.color || '#7c84a0'
        ctx.lineWidth = rl.lineWidth || 1
        ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(pad.left + cW, y); ctx.stroke()
        ctx.restore()
        if (rl.label) {
          ctx.fillStyle = rl.color || '#7c84a0'
          ctx.font = '10px system-ui'
          ctx.textAlign = 'left'
          ctx.fillText(rl.label, pad.left + 4, y - 4)
        }
      })

    // X-axis labels
    const fmtDate = this.config.formatDate || (ts => new Date(ts).toLocaleDateString())
    ctx.fillStyle = '#7c84a0'; ctx.font = '10px system-ui'; ctx.textAlign = 'center'
    const sampleLabelW = ctx.measureText(fmtDate(timestamps[0])).width + 12
    const maxLabels = Math.max(2, Math.floor(cW / sampleLabelW))
    const step = Math.max(1, Math.floor(n / maxLabels))
    for (let i = 0; i < n; i += step) {
      ctx.fillText(fmtDate(timestamps[i]), toX(i), pad.top + cH + 18)
    }
    // Cache the fully rendered chart so hover can restore it with a cheap raster copy
    // instead of a full vector redraw (grid/curves/labels) on every pointer move
    if (!this._baseSnapshot) this._baseSnapshot = document.createElement('canvas')
    this._baseSnapshot.width = canvas.width
    this._baseSnapshot.height = canvas.height
    this._baseSnapshot.getContext('2d').drawImage(canvas, 0, 0)
  }

  _onMouseMove(e) {
    const r = this._result
    if (!r) return
    const timestamps = this.config.getTimestamps(r)
    if (!timestamps?.length) return

    const canvas = document.getElementById(this.canvasId)
    const rect = canvas.getBoundingClientRect()
    const W = canvas.offsetWidth
    const pad = this._measurePad(canvas, r)
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left - pad.left) / (W - pad.left - pad.right)))
    const idx = Math.round(ratio * (timestamps.length - 1))
    const fmtDate = this.config.formatTooltipDate || this.config.formatDate || (ts => new Date(ts).toLocaleDateString())

    const lines = this.config.curves
      .filter(c => this._active[c.key])
      .map(c => {
        const vals = c.getData(r)
        if (!vals?.length) return null
        const v = vals[Math.round(ratio * (vals.length - 1))]
        if (v == null) return null
        const valStr = (c.prefix || '') + (typeof v === 'number' ? v.toFixed(2) : v) + (c.suffix || '')
        const label = _i18n(c.i18nKey, c.label || c.key)
        const classes = ['tt-' + c.key]
        if (c.dynamic) {
          const btn = document.querySelector(`#${this.config.togglesContainerId} [data-curve="${c.key}"]`)
          classes.push(btn?.classList.contains('positive') ? 'tt-positive' : 'tt-negative')
        }
        return `<span class="${classes.join(' ')}">● ${label} <strong>${valStr}</strong></span>`
      })
      .filter(Boolean)

    _showTooltip(e, `<div class="tt-date">${fmtDate(timestamps[idx])}</div>` + lines.join(''))

    // Cursor line overlay - restore the cached base render (cheap raster copy) instead
    // of redoing the full vector redraw on every pointer move
    const ctx = canvas.getContext('2d')
    if (this._baseSnapshot) {
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(this._baseSnapshot, 0, 0)
    } else {
      this._draw()
    }
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0)
    const cH = this.config.height - pad.top - pad.bottom
    const x = pad.left + ratio * (W - pad.left - pad.right)
    ctx.save()
    ctx.setLineDash([4, 3])
    ctx.strokeStyle = 'rgba(255,255,255,0.15)'
    ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(x, pad.top); ctx.lineTo(x, pad.top + cH); ctx.stroke()
    ctx.restore()
  }

  _onMouseLeave() {
    _hideTooltip()
    const canvas = document.getElementById(this.canvasId)
    const ctx = canvas?.getContext('2d')
    if (ctx && this._baseSnapshot) {
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(this._baseSnapshot, 0, 0)
    } else {
      this._draw()
    }
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
    this.filtersId = filtersId
    this.config = config
    this._result = null
    this._active = {}
    this._data = null
  }

  render(result) {
    this._result = result
    this._data = this.config.getBars(result)
    const keys = Object.keys(this._data)

    _toggleChartCard(this.containerId, !!keys.length)
    if (!keys.length) return

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
    const keys = this._sortedKeys(Object.keys(this._data))
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
      const activeCount = Object.values(this._active).filter(Boolean).length
      // Refuse to turn off the last remaining bar to avoid empty section
      if (this._active[k] && activeCount <= 1) return
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
      container.innerHTML = `<div class="text-muted text-sm p-sm" style="padding:.75rem 0">${t('common.nothing_to_display')}</div>`
      return
    }

    // Normalise all segment values to [0, 100] relative to the max across all bars
    const allValues = activeKeys.flatMap(k =>
      this.config.segments.map(s => s.getValue(this._data[k]) || 0)
    )
    const maxVal = Math.max(...allValues) || 1

    container.innerHTML = activeKeys.map(k => {
      const d = this._data[k]
      const { title, sub } = this.config.getLabel(k, d)

      const barsHtml = this.config.segments.map(s => {
        const val = s.getValue(d) || 0
        const pct = (val / maxVal * 100).toFixed(1)
        const valStr = (s.prefix || '') + (Number.isInteger(val) ? val : val.toFixed(1)) + (s.suffix || '')
        const color = s.color || 'var(--accent)'
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
    this.config = { height: 240, gridLines: 4, ...config }
    this._result = null
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

  _fmtBucket(v) {
    const decimals = this.config.labelDecimals ?? 1
    const suffix = this.config.labelSuffix ?? '%'
    return (v >= 0 ? '+' : '') + v.toFixed(decimals) + suffix
  }

  _draw() {
    const canvas = document.getElementById(this.canvasId)
    if (!canvas || !this._result) return

    const buckets = this._getBuckets()
    _toggleChartCard(this.canvasId, !!buckets.length)
    if (!buckets.length) { canvas.style.display = 'none'; return }
    canvas.style.display = ''

    canvas.style.width = ''
    canvas.style.height = ''
    canvas.width = 0
    canvas.height = 0
    const W = canvas.offsetWidth || 600
    const H = canvas.offsetHeight || this.config.height

    const pad = this._getPad()
    const cW = W - pad.left - pad.right
    const cH = H - pad.top - pad.bottom

    canvas.width = W * devicePixelRatio
    canvas.height = H * devicePixelRatio
    canvas.style.width = W + 'px'
    canvas.style.height = H + 'px'
    const ctx = canvas.getContext('2d')
    ctx.scale(devicePixelRatio, devicePixelRatio)
    ctx.clearRect(0, 0, W, H)

    const maxCount = Math.max(...buckets.map(b => b.count))
    const n = buckets.length
    const barW = Math.max(2, (cW / n) * 0.72)
    const gap = cW / n
    const colorWin = this.config.colorWin || _cssVar('--success') || '#22c55e'
    const colorLoss = this.config.colorLoss || _cssVar('--danger') || '#ef4444'
    const colorWinDim = this.config.colorWinDim || _cssVar('--success-dim') || 'rgba(34,197,94,0.35)'
    const colorLossDim = this.config.colorLossDim || _cssVar('--danger-dim') || 'rgba(239,68,68,0.35)'
    const labelSuffix = this.config.labelSuffix ?? '%'
    const labelDecimals = this.config.labelDecimals ?? 1

    // Grid lines
    ctx.strokeStyle = '#2a2f3d'
    ctx.lineWidth = 1
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
      const x = pad.left + i * gap + (gap - barW) / 2
      const barH = (b.count / maxCount) * cH
      const y = pad.top + cH - barH
      // Determine color: single-color mode (e.g. MAE, not a win/loss metric)
      // bypasses the win/loss split entirely.
      const isWin = b.lo >= 0
      const fill = this.config.singleColor || (isWin ? colorWin : colorLoss)
      const dimFill = this.config.singleColorDim || (isWin ? colorWinDim : colorLossDim)

      // Bar body
      ctx.fillStyle = (this._hoveredIdx == null || this._hoveredIdx === i) ? fill : dimFill
      ctx.beginPath()
      ctx.roundRect?.(x, y, barW, barH, [3, 3, 0, 0]) || ctx.rect(x, y, barW, barH)
      ctx.fill()

      // Bar border top
      ctx.fillStyle = (this._hoveredIdx == null || this._hoveredIdx === i) ? fill : dimFill
      ctx.fillRect(x, y, barW, 2)

      // X label - show every other if tight
      if (n <= 12 || i % 2 === 0) {
        ctx.save()
        ctx.fillStyle = '#7c84a0'
        ctx.font = '9px system-ui'
        ctx.textAlign = 'center'
        ctx.translate(x + barW / 2, pad.top + cH + 18)
        ctx.rotate(-Math.PI / 4)
        // Show only the left bound of the range for brevity
        const shortLabel = (b.lo >= 0 ? '+' : '') + b.lo.toFixed(labelDecimals) + labelSuffix
        ctx.fillText(shortLabel, 0, 0)
        ctx.restore()
      }
    })

    this._buckets = buckets
    this._pad = pad
    this._gap = gap
    this._barW = barW
    this._cH = cH
  }

  _bindEvents() {
    const bind = () => {
      const canvas = document.getElementById(this.canvasId)
      if (!canvas) return
      window.addEventListener('resize', () => {
        const canvas = document.getElementById(this.canvasId)
        if (!canvas) return
        canvas.style.width = ''
        canvas.style.height = ''
        this._draw()
      })
      canvas.addEventListener('mousemove', e => {
        const rect = canvas.getBoundingClientRect()
        const mouseX = e.clientX - rect.left
        const pad = this._getPad()
        const n = this._buckets?.length || 0
        const gap = (canvas.offsetWidth - pad.left - pad.right) / (n || 1)
        const idx = Math.floor((mouseX - pad.left) / gap)
        if (idx >= 0 && idx < n) {
          const b = this._buckets[idx]
          _showTooltip(e,
            `<div class="tt-date">${this._fmtBucket(b.lo)} · ${this._fmtBucket(b.hi)}</div>` +
            `<span>Trade${b.count > 1 ? 's' : ''}: <strong>${b.count}</strong></span>`
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

/**
 * Converts a binned scatter payload ({xMin, xW, yMin, yW, cells: [{ix, iy, n}]})
 * into pseudo-points usable by CanvasScatter: {x, y, n} at each cell's center.
 * Radius is scaled by sqrt(n) so area (not radius) is proportional to count.
 */
// REASON_CODES order must match python's REASON_CODES: risk, tsl, signal, end.
const SCATTER_REASON_ORDER = ['risk', 'tsl', 'signal', 'end']

/** Total trade count across all cells of a binned scatter payload. */
function _binnedTotalCount(binned) {
  return (binned?.cells || []).reduce((sum, c) => sum + c.n, 0)
}

function _binnedToPoints(binned) {
  if (!binned || !binned.cells || !binned.cells.length) return []
  const maxN = Math.max(...binned.cells.map(c => c.n))
  return binned.cells.map(c => ({
    x: binned.xMin + (c.ix + 0.5) * binned.xW,
    y: binned.yMin + (c.iy + 0.5) * binned.yW,
    n: c.n,
    br: c.br, // [riskCount, tslCount, signalCount, endCount]
    _radiusScale: Math.sqrt(c.n / maxN),
  }))
}

/**
 * Collapses a binned scatter payload into a 1D histogram over x (sums `n`
 * across all iy for each ix), shaped to match what CanvasHistogram expects
 * ({label, count, lo}) - same shape the backend's _mae_buckets/_mfe_buckets
 * used to return, but computed client-side from the scatter cells.
 */
function _bucketsFromBinned(binned, decimals = 1, suffix = '%') {
  if (!binned || !binned.cells || !binned.cells.length) return []
  const nx = Math.max(...binned.cells.map(c => c.ix)) + 1
  const counts = new Array(nx).fill(0)
  binned.cells.forEach(c => { counts[c.ix] += c.n })
  const fmt = v => (v >= 0 ? '+' : '') + v.toFixed(decimals) + suffix
  return counts
    .map((count, ix) => {
      const lo = binned.xMin + ix * binned.xW
      const hi = lo + binned.xW
      return { label: `${fmt(lo)} · ${fmt(hi)}`, count, lo }
    })
    .filter(b => b.count > 0)
}

// CanvasScatter
/**
 * Scatter plot - one point per item (e.g. MAE on X vs PnL on Y for winning trades).
 *
 * @param {string} canvasId
 * @param {object} config
 *   getPoints       (r) => Array<{x:number, y:number}>
 *   height?         number   default 240
 *   gridLines?      number   default 4
 *   pointColor?     string   CSS color, used when getColor is not set
 *   getColor?       (p) => string   CSS color per point - overrides pointColor,
 *                    lets points be colored by category (e.g. exit reason)
 *   pointRadius?    number   default 3
 *   labelSuffixX?   string   default '%'
 *   labelSuffixY?   string   default '%'
 *   labelDecimalsX? number   default 1
 *   labelDecimalsY? number   default 1
 *   yAxisSide?      'left'|'right'  default 'left'. Use 'right' when the X
 *                    domain is always <= 0 (e.g. MAE), so the Y axis sits
 *                    next to the natural 0 column instead of far from it.
 *   tooltip?        (p) => string   HTML for a point's tooltip; defaults to "x / y"
 */
class CanvasScatter {
  constructor(canvasId, config) {
    this.canvasId = canvasId
    this.config = { height: 240, gridLines: 4, pointRadius: 3, ...config }
    this._result = null
    this._bindEvents()
  }

  render(result) {
    this._result = result
    this._draw()
  }

  // Private
  _getPad() {
    return this.config.yAxisSide === 'right'
      ? { top: 16, right: 40, bottom: 32, left: 16 }
      : { top: 16, right: 16, bottom: 32, left: 40 }
  }

  _draw() {
    const canvas = document.getElementById(this.canvasId)
    if (!canvas || !this._result) return

    const points = this.config.getPoints(this._result) || []
    _toggleChartCard(this.canvasId, !!points.length)
    if (!points.length) { canvas.style.display = 'none'; return }
    canvas.style.display = ''

    canvas.style.width = ''
    canvas.style.height = ''
    canvas.width = 0
    canvas.height = 0
    const W = canvas.offsetWidth || 600
    const H = canvas.offsetHeight || this.config.height

    const pad = this._getPad()
    const cW = W - pad.left - pad.right
    const cH = H - pad.top - pad.bottom

    canvas.width = W * devicePixelRatio
    canvas.height = H * devicePixelRatio
    canvas.style.width = W + 'px'
    canvas.style.height = H + 'px'
    const ctx = canvas.getContext('2d')
    ctx.scale(devicePixelRatio, devicePixelRatio)
    ctx.clearRect(0, 0, W, H)

    const xScale = _scaleX(points.map(p => p.x), pad.left, cW)
    const yScale = _scaleY(points.map(p => p.y), pad.top, cH)

    const color = this.config.pointColor || _cssVar('--primary') || '#6c8eff'
    const radiusFn = typeof this.config.pointRadius === 'function'
      ? this.config.pointRadius
      : () => this.config.pointRadius
    const suffixX = this.config.labelSuffixX ?? '%'
    const suffixY = this.config.labelSuffixY ?? '%'
    const decX = this.config.labelDecimalsX ?? 1
    const decY = this.config.labelDecimalsY ?? 1

    // Grid lines
    ctx.strokeStyle = '#2a2f3d'
    ctx.lineWidth = 1
    for (let i = 0; i <= this.config.gridLines; i++) {
      const y = pad.top + (cH / this.config.gridLines) * i
      ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(pad.left + cW, y); ctx.stroke()
    }

    // Y axis labels
    const onRight = this.config.yAxisSide === 'right'
    ctx.fillStyle = '#7c84a0'; ctx.font = '10px system-ui'
    ctx.textAlign = onRight ? 'left' : 'right'
    const labelX = onRight ? pad.left + cW + 6 : pad.left - 6
    for (let i = 0; i <= this.config.gridLines; i++) {
      const v = yScale.mx - (yScale.rng / this.config.gridLines) * i
      const y = pad.top + (cH / this.config.gridLines) * i
      ctx.fillText(v.toFixed(decY) + suffixY, labelX, y + 4)
    }

    // X axis labels
    ctx.textAlign = 'center'
    for (let i = 0; i <= this.config.gridLines; i++) {
      const v = xScale.mn + (xScale.rng / this.config.gridLines) * i
      const x = pad.left + (cW / this.config.gridLines) * i
      ctx.fillText(v.toFixed(decX) + suffixX, x, pad.top + cH + 16)
    }

    // Points - colored per-point via getColor when provided (e.g. by exit
    // reason), otherwise the single pointColor. Non-hovered points fade via
    // opacity instead of swapping color, so this works the same whether
    // points share one color or many.
    points.forEach((p, i) => {
      const x = xScale.toX(p.x)
      const y = yScale.toY(p.y)
      const r = radiusFn(p)
      ctx.globalAlpha = (this._hoveredIdx == null || this._hoveredIdx === i) ? 1 : 0.35

      if (this.config.colorByReason?.() && p.br) {
        // Multi-color donut: one arc slice per reason, proportional to its count.
        let angle = -Math.PI / 2
        p.br.forEach((count, idx) => {
          if (!count) return
          const slice = (count / p.n) * Math.PI * 2
          ctx.fillStyle = REASON_COLORS[SCATTER_REASON_ORDER[idx]] || REASON_COLORS.unknown
          ctx.beginPath()
          ctx.moveTo(x, y)
          ctx.arc(x, y, r, angle, angle + slice)
          ctx.closePath()
          ctx.fill()
          angle += slice
        })
      } else {
        ctx.fillStyle = this.config.getColor ? this.config.getColor(p) : color
        ctx.beginPath()
        ctx.arc(x, y, r, 0, Math.PI * 2)
        ctx.fill()
      }
    })
    ctx.globalAlpha = 1

    this._points = points
    this._pad = pad
    this._cW = cW
    this._cH = cH
    this._xScale = xScale
    this._yScale = yScale
  }

  _bindEvents() {
    const bind = () => {
      const canvas = document.getElementById(this.canvasId)
      if (!canvas) return
      window.addEventListener('resize', () => {
        const canvas = document.getElementById(this.canvasId)
        if (!canvas) return
        canvas.style.width = ''
        canvas.style.height = ''
        this._draw()
      })
      canvas.addEventListener('mousemove', e => {
        const rect = canvas.getBoundingClientRect()
        const mx = e.clientX - rect.left
        const my = e.clientY - rect.top
        const pts = this._points || []
        // Nearest point within a small pixel radius (screen space, not data
        // space, so the hit-test feels consistent regardless of axis scale).
        let bestIdx = -1, bestDist = 12
        pts.forEach((p, i) => {
          const x = this._xScale.toX(p.x)
          const y = this._yScale.toY(p.y)
          const d = Math.hypot(mx - x, my - y)
          if (d < bestDist) { bestDist = d; bestIdx = i }
        })
        if (bestIdx >= 0) {
          const p = pts[bestIdx]
          const html = this.config.tooltip
            ? this.config.tooltip(p)
            : `<span>X: <strong>${p.x}</strong></span><br><span>Y: <strong>${p.y}</strong></span>`
          _showTooltip(e, html)
          if (this._hoveredIdx !== bestIdx) { this._hoveredIdx = bestIdx; this._draw() }
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

// MonthlyPerfChart
/**
 * Grouped bar chart - monthly perf: strategy vs asset, with optional delta line.
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
    this.canvasId = canvasId
    // this.config      = { height: 220, gridLines: 4, showDelta: true, windowSize: 12, ...config }
    this.config = { height: 280, gridLines: 4, showDelta: true, minSlotWidth: 34, minWindowSize: 3, ...config }
    this._result = null
    this._data = []
    this._winStart = 0
    this._isMobile = false
    this._showTrades = false
    this._showDelta = this.config.showDelta
    this._bindEvents()
  }

  _isWindowed() {
    return this._data.length > this._activeWindowSize()
  }

  _activeWindowSize() {
    const c = document.getElementById(this.canvasId)
    const W = c?.offsetWidth || 700
    const pad = this._getPad(W)
    const cW = W - pad.left - pad.right
    const fit = Math.floor(cW / this.config.minSlotWidth)
    return Math.max(this.config.minWindowSize, Math.min(fit, this._data.length || fit))
  }

  toggleTrades(force) {
    this._showTrades = force ?? !this._showTrades
    this._draw()
  }

  toggleDelta(force) {
    this._showDelta = force ?? !this._showDelta
    this._draw()
  }

  render(result) {
    this._result = result
    this._data = this.config.getData(result) || []
    if (this._isWindowed()) this._winStart = Math.max(0, this._data.length - this._activeWindowSize())
    this._syncNav()
    this._draw()
  }

  _isMobileNow() {
    const c = document.getElementById(this.canvasId)
    const w = c?.offsetWidth || 0
    return w > 0 && w < 640
  }

  _visibleData() {
    if (!this._isWindowed()) return this._data
    const size = this._activeWindowSize()
    const start = Math.max(0, this._winStart)
    const slice = this._data.slice(start, start + size)
    return slice.length ? slice : this._data.slice(0, size)
  }

  _syncNav() {
    const nav = document.getElementById(this.canvasId + 'Nav')
    if (!nav) return
    const windowed = this._isWindowed()
    nav.style.display = windowed ? 'flex' : 'none'
    if (!windowed) return
    const size = this._activeWindowSize()
    const total = this._data.length
    const end = Math.min(this._winStart + size, total)
    nav.querySelector('.mpf-range').textContent =
      `${this._data[this._winStart]?.month} - ${this._data[end - 1]?.month}`
    nav.querySelector('#mpfPrev').disabled = this._winStart === 0
    nav.querySelector('#mpfNext').disabled = end >= total
    nav.querySelector('#mpfPrevFast').disabled = this._winStart === 0
    nav.querySelector('#mpfNextFast').disabled = end >= total
  }

  // Private
  // Left/right margins sized to the widest axis label, same approach as CanvasLineChart._measurePad
  _getPad(W) {
    const small = W < 640
    const fallbackRight = this._showTrades ? (small ? 34 : 40) : 8
    const ctx = document.getElementById(this.canvasId)?.getContext('2d')
    if (!ctx || !this._data.length) {
      return { top: 16, right: fallbackRight, bottom: 28, left: small ? 42 : 48 }
    }
    ctx.font = '10px system-ui'

    const allVals = this._data.flatMap(d => [d.strat, d.asset ?? 0, this._showDelta ? d.strat - (d.asset ?? 0) : 0])
    const mn = Math.min(...allVals, 0)
    const mx = Math.max(...allVals, 0)
    const rng = mx - mn || 1
    let wLeft = 0
    for (let i = 0; i <= this.config.gridLines; i++) {
      const v = mx - (rng / this.config.gridLines) * i
      wLeft = Math.max(wLeft, ctx.measureText((v >= 0 ? '+' : '') + v.toFixed(1) + '%').width)
    }

    let wRight = 0
    if (this._showTrades) {
      const maxTrades = Math.max(...this._data.map(d => d.trades || 0), 1)
      wRight = ctx.measureText(Math.round(maxTrades).toString()).width
    }

    return {
      top: 16,
      right: this._showTrades ? wRight + 10 : 8,
      bottom: 28,
      left: wLeft + 10,
    }
  }

  _draw(hoveredIdx = -1) {
    const canvas = document.getElementById(this.canvasId)
    if (!canvas || !this._result) return

    const data = this._visibleData()
    _toggleChartCard(this.canvasId, !!data?.length)
    if (!data?.length) { canvas.style.display = 'none'; return }
    canvas.style.display = ''

    canvas.style.width = ''
    canvas.style.height = ''
    canvas.width = 0
    canvas.height = 0
    const W = canvas.offsetWidth || 700
    const H = canvas.offsetHeight || this.config.height
    const pad = this._getPad(W)
    const cW = W - pad.left - pad.right
    const cH = H - pad.top - pad.bottom

    const dpr = devicePixelRatio || 1
    canvas.width = W * dpr
    canvas.height = H * dpr
    canvas.style.width = W + 'px'
    canvas.style.height = H + 'px'
    const ctx = canvas.getContext('2d')
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, W, H)

    const n = data.length
    const allVals = data.flatMap(d => [d.strat, d.asset ?? 0, this._showDelta ? d.strat - (d.asset ?? 0) : 0])
    const mn = Math.min(...allVals, 0)
    const mx = Math.max(...allVals, 0)
    const rng = mx - mn || 1
    const toY = v => pad.top + cH - ((v - mn) / rng) * cH
    const zeroY = toY(0)

    const colorStrat = _cssVar('--success') || '#22c55e'
    const colorStratNeg = _cssVar('--danger') || '#ef4444'
    const colorAsset = '#c8cdd8'
    const colorAssetNeg = '#5a6075'
    const colorDelta = _cssVar('--warning') || '#e8a838'

    // Grid
    ctx.strokeStyle = '#2a2f3d'
    ctx.lineWidth = 1
    for (let i = 0; i <= this.config.gridLines; i++) {
      const y = pad.top + (cH / this.config.gridLines) * i
      ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(pad.left + cW, y); ctx.stroke()
    }

    // Zero line
    if (zeroY > pad.top && zeroY < pad.top + cH) {
      ctx.strokeStyle = '#4a5068'
      ctx.lineWidth = 1
      ctx.beginPath(); ctx.moveTo(pad.left, zeroY); ctx.lineTo(pad.left + cW, zeroY); ctx.stroke()
    }

    // Y labels
    ctx.fillStyle = '#7c84a0'; ctx.font = '10px system-ui'; ctx.textAlign = 'right'
    for (let i = 0; i <= this.config.gridLines; i++) {
      const v = mx - (rng / this.config.gridLines) * i
      const y = pad.top + (cH / this.config.gridLines) * i
      ctx.fillText((v >= 0 ? '+' : '') + v.toFixed(1) + '%', pad.left - 5, y + 4)
    }

    // Secondary axis (trade count) - scale + right-hand labels
    const colorTrades = _cssVar('--info') || '#5b8def'
    const maxTrades = Math.max(...data.map(d => d.trades || 0), 1)
    const toTradesY = v => pad.top + cH - (v / maxTrades) * cH
    if (this._showTrades) {
      ctx.fillStyle = colorTrades; ctx.font = '10px system-ui'; ctx.textAlign = 'left'
      for (let i = 0; i <= this.config.gridLines; i++) {
        const v = maxTrades - (maxTrades / this.config.gridLines) * i
        const y = pad.top + (cH / this.config.gridLines) * i
        ctx.fillText(Math.round(v).toString(), pad.left + cW + 5, y + 4)
      }
    }

    // Bars
    const slotW = cW / n
    const barW = Math.max(2, slotW * 0.38)
    const spacing = 0

    this._bars = []
    data.forEach((d, i) => {
      const cx = pad.left + i * slotW + slotW / 2
      const xA = cx - barW - spacing / 2
      const xS = cx + spacing / 2
      const dimmed = hoveredIdx >= 0 && i !== hoveredIdx
      const alpha = dimmed ? '55' : ''

      const drawBar = (x, v, pos, neg) => {
        if (v === null || v === undefined) return
        const y = toY(Math.max(v, 0))
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
    if (this._showDelta) {
      const pts = data.map((d, i) => ({
        x: pad.left + i * slotW + slotW / 2,
        y: toY(d.strat - (d.asset ?? 0)),
        dimmed: hoveredIdx >= 0 && i !== hoveredIdx,
      }))
      ctx.beginPath()
      pts.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y))
      ctx.strokeStyle = hoveredIdx >= 0 ? colorDelta + '33' : colorDelta
      ctx.lineWidth = 1.5
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
          ctx.lineWidth = 1.5
          ctx.stroke()
        }
      })
    }

    // Trades line (secondary axis)
    if (this._showTrades) {
      const tPts = data.map((d, i) => ({
        x: pad.left + i * slotW + slotW / 2,
        y: toTradesY(d.trades || 0),
        dimmed: hoveredIdx >= 0 && i !== hoveredIdx,
      }))
      ctx.beginPath()
      tPts.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y))
      ctx.strokeStyle = hoveredIdx >= 0 ? colorTrades + '33' : colorTrades
      ctx.lineWidth = 1.5
      ctx.setLineDash([3, 3])
      ctx.stroke()
      ctx.setLineDash([])
      tPts.forEach((p, i) => {
        const isHovered = i === hoveredIdx
        ctx.beginPath()
        ctx.arc(p.x, p.y, isHovered ? 3 : 2.5, 0, Math.PI * 2)
        ctx.fillStyle = p.dimmed ? colorTrades + '33' : colorTrades
        ctx.fill()
        if (isHovered) {
          ctx.beginPath()
          ctx.arc(p.x, p.y, 4.5, 0, Math.PI * 2)
          ctx.strokeStyle = colorTrades
          ctx.lineWidth = 1.5
          ctx.stroke()
        }
      })
    }

    // X labels
    ctx.fillStyle = '#7c84a0'; ctx.font = '10px system-ui'; ctx.textAlign = 'center'
    let lastLabelX = -Infinity
    const minGap = 8
    data.forEach((d, i) => {
      const x = pad.left + i * slotW + slotW / 2
      const lbl = n > 14
        ? d.month.slice(2).replace('-', '/')
        : new Date(d.month + '-01').toLocaleDateString(undefined, { month: 'short', year: '2-digit' })
      const w = ctx.measureText(lbl).width
      if (x - w / 2 < lastLabelX + minGap) return
      ctx.fillText(lbl, x, pad.top + cH + 16)
      lastLabelX = x + w / 2
    })

    this._pad = pad
    this._slotW = slotW
    this._toY = toY
    this._mn = mn; this._mx = mx
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
          this._winStart = Math.max(0, this._winStart - this._activeWindowSize())
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
            this._data.length - this._activeWindowSize(),
            this._winStart + this._activeWindowSize()
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
        const rect = canvas.getBoundingClientRect()
        const mouseX = e.clientX - rect.left
        const pad = this._getPad(canvas.offsetWidth)
        const i = Math.floor((mouseX - pad.left) / this._slotW)
        if (i >= 0 && i < visible.length) {
          const d = visible[i]
          const delta = d.strat - (d.asset ?? 0)
          const fmt = v => (v >= 0 ? '+' : '') + v.toFixed(2) + '%'
          _showTooltip(e,
            `<div class="tt-date">${d.month}</div>` +
            `<span>Asset: <span class="${(d.asset ?? 0) < 0 ? 'pnl-negative' : 'pnl-positive'}">${fmt(d.asset ?? 0)}</span></span>` +
            `<span>Strat: <span class="${d.strat < 0 ? 'pnl-negative' : 'pnl-positive'}">${fmt(d.strat)}</span></span>` +
            (this._showDelta ? `<span>Delta: <span class="pnl-delta">${fmt(delta)}</span></span>` : '') +
            (d.trades !== undefined && this._showTrades ? `<span>Trade${d.trades > 1 ? 's' : ''}: <span class="trades-count">${d.trades}</span></span>` : '')
          )
          // Cursor line
          this._draw(i)
          const ctx2 = canvas.getContext('2d')
          const x = pad.left + i * this._slotW + this._slotW / 2
          const cH = this.config.height - pad.top - pad.bottom
          ctx2.save()
          ctx2.setLineDash([4, 3])
          ctx2.strokeStyle = 'rgba(255,255,255,0.15)'
          ctx2.lineWidth = 1
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