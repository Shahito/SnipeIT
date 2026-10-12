/** Exits overlay: SL / TSL / TP / signal order / slippage on one slider. The DOM is the state. See docs/exits.md */

(function () {
  const $ = id => document.getElementById(id)
  const r2 = n => Math.round(n * 100) / 100
  const fmt = n => String(r2(n))

  const LEGS = {
    sl:  { cap: 'Sl',  types: ['percent', 'atr'],      side: -1 },
    tsl: { cap: 'Tsl', types: ['percent', 'atr'],      side: -1 },
    tp:  { cap: 'Tp',  types: ['percent', 'atr', 'r'], side: 1 },
  }
  const TYPE_LABEL = { percent: '%', atr: '× ATR', r: 'R' }
  const SCALE_STEPS = [5, 10, 20, 30, 50, 100] // slider half-width, in % from entry
  const ATR_REF_DEFAULT = 1.5                  // % of price, when live data isn't available
  const MIN_VALUE = 0.05

  const unit = { sl: 'percent', tsl: 'percent', tp: 'percent' }
  let atrRef = { pct: ATR_REF_DEFAULT, live: false, pair: null, timeframe: null }
  let lastStopRef = null // stop distance (%) as of the last refresh - lets a toggle convert R -> % afterwards
  let atrFetchToken = 0

  const legOn = k => $(`ex${LEGS[k].cap}On`).checked
  const legText = k => $(`ex${LEGS[k].cap}Value`).value

  function parseList(text, parser) {
    const v = parseSweepNumber(text, parser)
    if (v === null || v === undefined) return []
    return typeof v === 'object' ? v.sweep : [v]
  }

  const num = id => {
    const v = parseSweepNumber($(id).value)
    if (v === null) return null
    return typeof v === 'object' ? null : v
  }

  function stopRefPcts() {
    if (legOn('sl')) return pctsFor('sl')
    if (legOn('tsl')) return pctsFor('tsl')
    return []
  }

  function toPct(k, type, v, ref) {
    if (type === 'atr') return v * atrRef.pct
    if (type === 'r') return v * ref
    return v
  }

  function fromPct(type, pct, ref) {
    if (type === 'atr') return pct / atrRef.pct
    if (type === 'r') return pct / ref
    return pct
  }

  function pctsFor(k) {
    const vals = parseList(legText(k)).filter(v => v > 0)
    if (unit[k] !== 'r') return vals.map(v => toPct(k, unit[k], v))
    const refs = stopRefPcts()
    return vals.flatMap(v => refs.map(r => toPct(k, 'r', v, r)))
  }

  function convertUnit(k, from, to, ref) {
    const vals = parseList(legText(k)).filter(v => v > 0)
    if (!vals.length) return
    const out = vals.map(v => fmt(fromPct(to, toPct(k, from, v, ref), ref)))
    $(`ex${LEGS[k].cap}Value`).value = out.join(', ')
  }

  function setType(k, next) {
    const prev = unit[k]
    if (prev === next) return
    const ref = stopRefPcts()[0]
    if (next === 'r' && !ref) { showErr(t('exits.err.r_needs_stop')); return }
    convertUnit(k, prev, next, ref)
    unit[k] = next
    showErr('')
    changed()
  }

  function leg(k) {
    const c = LEGS[k].cap
    const text = legText(k).trim()
    return {
      enabled: legOn(k),
      type: unit[k],
      value: text ? parseSweepNumber(text) : null,
      order: $(`ex${c}Order`).value,
    }
  }

  function readState() {
    const trailingTp = $('exTtpOn').checked
    const tp = trailingTp
      ? { enabled: true, mode: 'trailing', type: 'percent', value: null, order: 'limit' }
      : { mode: 'fixed', ...leg('tp') }
    const exits = {
      atrPeriod: parseSweepNumber($('exAtrPeriod').value, parseInt) ?? 14,
      sl: leg('sl'),
      tsl: leg('tsl'),
      tp,
      signal: { order: $('exSignalOrder').value },
    }
    const execution = { slippage: parseSweepNumber($('fSlippage').value) ?? 0 }
    return { exits, execution }
  }

  const firstOf = v => (v && typeof v === 'object' && Array.isArray(v.sweep)) ? v.sweep[0] : v

  function writeState(exits, execution) {
    const ex = exits || {}
    $('exAtrPeriod').value = formatSweepNumber(ex.atrPeriod ?? 14)
    for (const k of Object.keys(LEGS)) {
      const l = ex[k] || {}
      const c = LEGS[k].cap
      const trailing = k === 'tp' && l.mode === 'trailing'
      $(`ex${c}On`).checked = !!l.enabled && !trailing
      const type = firstOf(l.type)
      unit[k] = LEGS[k].types.includes(type) ? type : 'percent'
      $(`ex${c}Value`).value = formatSweepNumber(l.value)
      const order = firstOf(l.order)
      const sel = $(`ex${c}Order`)
      sel.value = [...sel.options].some(o => o.value === order && !o.disabled) ? order : sel.options[0].value
    }
    $('exTtpOn').checked = !!(ex.tp && ex.tp.enabled && ex.tp.mode === 'trailing')
    const sig = firstOf(ex.signal && ex.signal.order)
    $('exSignalOrder').value = sig === 'market' ? sig : 'market'
    $('fSlippage').value = formatSweepNumber(execution && execution.slippage != null ? execution.slippage : 0)
    showErr('')
    refresh()
  }

  function showErr(msg) { $('exErr').textContent = msg || '' }

  function scaleMax(all) {
    const need = Math.max(5, ...all) * 1.1
    return SCALE_STEPS.find(s => s >= need) || SCALE_STEPS[SCALE_STEPS.length - 1]
  }

  function describe(k) {
    const name = { sl: 'SL', tsl: 'TSL', tp: 'TP' }[k]
    const vals = parseList(legText(k)).filter(v => v > 0)
    if (!vals.length) return name
    const shown = vals.length > 3 ? `${fmt(Math.min(...vals))}–${fmt(Math.max(...vals))}` : vals.map(fmt).join(', ')
    const u = TYPE_LABEL[unit[k]]
    const pcts = pctsFor(k)
    const approx = unit[k] === 'percent' || !pcts.length
      ? ''
      : ` (~${pcts.length > 1 ? `${fmt(Math.min(...pcts))}–${fmt(Math.max(...pcts))}` : fmt(pcts[0])} %)`
    return `${name} ${shown} ${u}${approx}`
  }

  function renderSlider() {
    const all = Object.keys(LEGS).filter(legOn).flatMap(pctsFor)
    const max = scaleMax(all)
    const pos = (k, pct) => 50 + LEGS[k].side * (Math.min(pct, max) / max) * 50

    $('exAxisL').textContent = `−${max} %`
    $('exAxisR').textContent = `+${max} %`

    let leftEdge = 0, rightEdge = 0
    for (const k of Object.keys(LEGS)) {
      const on = legOn(k)
      const pcts = on ? pctsFor(k) : []
      const h = $(`exH_${k}`), lbl = $(`exL_${k}`), band = $(`exB_${k}`), stem = $(`exS_${k}`)
      const single = pcts.length === 1
      const lo = pcts.length ? Math.min(...pcts) : 0
      const hi = pcts.length ? Math.max(...pcts) : 0

      h.style.display = single ? '' : 'none'
      if (stem) stem.style.display = single ? '' : 'none'
      lbl.style.display = pcts.length ? '' : 'none'
      band.style.display = pcts.length > 1 ? '' : 'none'

      if (single) {
        h.style.left = `${pos(k, lo)}%`
        h.setAttribute('aria-valuenow', fmt(lo))
        h.setAttribute('aria-valuemax', String(max))
        if (stem) stem.style.left = `${pos(k, lo)}%`
        lbl.style.left = `${pos(k, lo)}%`
      } else if (pcts.length > 1) {
        const a = pos(k, lo), b = pos(k, hi)
        band.style.left = `${Math.min(a, b)}%`
        band.style.width = `${Math.abs(b - a)}%`
        lbl.style.left = `${(a + b) / 2}%`
      }
      lbl.textContent = describe(k)

      if (pcts.length && k !== 'tp') leftEdge = Math.max(leftEdge, hi)
      if (pcts.length && k === 'tp') rightEdge = Math.max(rightEdge, hi)
    }
    $('exFillL').style.width = `${(Math.min(leftEdge, max) / max) * 50}%`
    $('exFillL').style.left = `${50 - (Math.min(leftEdge, max) / max) * 50}%`
    $('exFillR').style.width = `${(Math.min(rightEdge, max) / max) * 50}%`
    $('exFillR').style.left = '50%'
    return max
  }

  function bindHandle(k) {
    const h = $(`exH_${k}`)
    const c = LEGS[k].cap

    const writeFromPct = (pct) => {
      const ref = stopRefPcts()[0]
      if (unit[k] === 'r' && !ref) return
      const v = Math.max(MIN_VALUE, fromPct(unit[k], pct, ref))
      $(`ex${c}Value`).value = fmt(v)
      changed()
    }

    h.addEventListener('pointerdown', e => { h.setPointerCapture(e.pointerId); h._drag = true })
    h.addEventListener('pointerup', () => { h._drag = false })
    h.addEventListener('pointercancel', () => { h._drag = false })
    h.addEventListener('pointermove', e => {
      if (!h._drag) return
      const rect = $('exTrack').getBoundingClientRect()
      const f = (e.clientX - rect.left) / rect.width
      const max = Number(h.getAttribute('aria-valuemax')) || 10
      const past = LEGS[k].side === 1 ? f < 0.5 : f > 0.5
      const pct = past ? 0.1 : Math.min(max, Math.max(0.1, Math.round(Math.abs(f - 0.5) * 2 * max * 10) / 10))
      writeFromPct(pct)
    })
    h.addEventListener('keydown', e => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      e.preventDefault()
      const vals = parseList(legText(k))
      if (vals.length !== 1) return
      const more = (e.key === 'ArrowRight') === (LEGS[k].side === 1)
      $(`ex${c}Value`).value = fmt(Math.max(MIN_VALUE, vals[0] + (more ? 0.1 : -0.1)))
      changed()
    })
  }

  function renderChips() {
    for (const k of Object.keys(LEGS)) {
      const group = $(`ex${LEGS[k].cap}TypeGroup`)
      const on = legOn(k)
      const canR = stopRefPcts().length > 0
      group.innerHTML = LEGS[k].types.map(type => {
        const needsStop = type === 'r' && !canR && unit[k] !== 'r'
        const disabled = !on || needsStop
        const title = on && needsStop ? ` title="${t('exits.err.r_needs_stop')}"` : ''
        return `<button type="button" class="ex-chip${unit[k] === type ? ' on' : ''}" data-leg="${k}" data-type="${type}"${title}${disabled ? ' disabled' : ''}>${TYPE_LABEL[type]}</button>`
      }).join('')
    }
  }

  function renderRows() {
    const ttp = $('exTtpOn').checked
    for (const k of Object.keys(LEGS)) {
      const c = LEGS[k].cap
      const on = legOn(k)
      $(`ex${c}Value`).disabled = !on
      $(`ex${c}Order`).disabled = !on
      const u = $(`ex${c}Unit`)
      u.textContent = TYPE_LABEL[unit[k]]
      u.classList.toggle('off', !on)
      $(`ex${c}Row`).classList.toggle('is-off', !on)
    }
    $('exTtpRow').classList.toggle('is-off', !ttp)
    const usesAtr = Object.keys(LEGS).some(k => legOn(k) && unit[k] === 'atr')
    $('exAtrRow').classList.toggle('hidden', !usesAtr)
    if (usesAtr) {
      $('exAtrNote').textContent = atrRef.live
        ? t('exits.atr.ref', { pct: fmt(atrRef.pct), pair: atrRef.pair, tf: atrRef.timeframe })
        : t('exits.atr.ref_default', { pct: fmt(atrRef.pct) })
    }
  }

  function renderMetrics() {
    const set = (rr, be, cost, note) => {
      $('exMetricRR').textContent = rr
      $('exMetricBE').textContent = be
      $('exMetricCost').textContent = cost
      $('exMetricNote').textContent = note
    }
    const stops = stopRefPcts()
    const tps = legOn('tp') ? pctsFor('tp') : []
    const slip = $('fSlippage').value.trim() === '' ? 0 : num('fSlippage')
    const taker = parseFloat($('fFeeTaker').value)
    const maker = parseFloat($('fFeeMaker').value)
    const feeT = Number.isNaN(taker) ? 0.1 : taker
    const feeM = Number.isNaN(maker) ? 0.1 : maker

    if ($('exTtpOn').checked) return set('–', '–', '–', t('exits.metric.ttp'))
    if (!stops.length || !tps.length) return set('–', '–', '–', t('exits.metric.none'))
    if (stops.length > 1 || tps.length > 1 || slip === null) return set('–', '–', '–', t('exits.metric.sweep'))

    const d = stops[0], tp = tps[0]
    const entry = feeT + slip
    const lossExit = feeT + slip // stop-market: taker + slippage
    const winExit = $('exTpOrder').value === 'limit' ? feeM : feeT + slip
    const gain = tp - entry - winExit
    const loss = d + entry + lossExit
    const rr = `1 : ${Math.round((tp / d) * 10) / 10}`
    const cost = `${fmt(entry + lossExit)} %`
    if (gain <= 0) return set(rr, '> 100 %', cost, t('exits.metric.tp_below_costs'))
    const be = (loss / (gain + loss)) * 100
    set(rr, `${Math.round(be * 10) / 10} %`, cost, t('exits.metric.note', { pct: Math.round(be) }))
  }

  function renderSummary() {
    const box = $('exitsSummary')
    if (!box) return
    const { exits, execution } = readState()
    const chips = []
    const add = (cls, text) => chips.push(`<span class="tag ${cls}">${text}</span>`)
    if (exits.sl.enabled) add('tag-danger', describe('sl'))
    if (exits.tsl.enabled) add('tag-danger', describe('tsl'))
    if (exits.tp.mode === 'trailing' && exits.tp.enabled) add('tag-success', t('exits.leg.ttp'))
    else if (exits.tp.enabled) add('tag-success', describe('tp'))
    const slip = formatSweepNumber(execution.slippage)
    if (slip && slip !== '0') add('tag-secondary', `${t('exits.summary.slippage')} ${slip} %`)
    box.innerHTML = chips.length ? chips.join('') : `<span class="text-muted text-sm">${t('exits.summary.none')}</span>`
  }

  function refresh() {
    lastStopRef = stopRefPcts()[0] || null
    renderChips()
    renderRows()
    renderSlider()
    renderMetrics()
    renderSummary()
  }

  function changed() {
    refresh()
    if (typeof updatePreview === 'function') updatePreview()
  }

  async function fetchAtrRef() {
    const token = ++atrFetchToken
    const pair = (typeof _currentPairs !== 'undefined' && _currentPairs[0]) || null
    const timeframe = getChipGroupSelected('fTimeframeGroup')[0] || '1h'
    const period = parseList($('exAtrPeriod').value, parseInt)[0] || 14
    if (!pair) { atrRef = { pct: ATR_REF_DEFAULT, live: false, pair: null, timeframe }; refresh(); return }
    try {
      const data = await api(`/coins/atr-ref?pair=${encodeURIComponent(pair)}&timeframe=${encodeURIComponent(timeframe)}&period=${period}`)
      if (token !== atrFetchToken) return
      atrRef = data.atrPct > 0
        ? { pct: data.atrPct, live: true, pair, timeframe }
        : { pct: ATR_REF_DEFAULT, live: false, pair, timeframe }
    } catch (e) {
      if (token !== atrFetchToken) return
      atrRef = { pct: ATR_REF_DEFAULT, live: false, pair, timeframe }
    }
    refresh()
  }

  function fillSelect(id, options) {
    $(id).innerHTML = options
      .map(([value, key, disabled]) => `<option value="${value}"${disabled ? ' disabled' : ''}>${t(key)}</option>`)
      .join('')
  }

  function onLegToggle(k) {
    if (!legOn('sl') && !legOn('tsl') && unit.tp === 'r' && lastStopRef) {
      convertUnit('tp', 'r', 'percent', lastStopRef)
      unit.tp = 'percent'
      showErr(t('exits.err.r_reverted'))
    } else {
      showErr('')
    }
    if (k === 'tp' && legOn('tp')) $('exTtpOn').checked = false
    changed()
  }

  const DEFAULT_EXITS = {
    atrPeriod: 14,
    sl: { enabled: false, type: 'percent', value: null, order: 'stop_market' },
    tsl: { enabled: false, type: 'percent', value: null, order: 'stop_market' },
    tp: { enabled: false, mode: 'fixed', type: 'percent', value: null, order: 'limit' },
    signal: { order: 'market' },
  }
  const DEFAULT_EXECUTION = { slippage: 0 }

  function resetExits() {
    writeState(DEFAULT_EXITS, DEFAULT_EXECUTION)
    changed()
  }

  function open() {
    openModal('exitsModal')
    fetchAtrRef()
  }

  function close() { closeModal('exitsModal') }

  function init() {
    fillSelect('exSlOrder', [['stop_market', 'exits.order.stop_market'], ['stop_limit', 'exits.order.stop_limit_soon', true]])
    fillSelect('exTslOrder', [['stop_market', 'exits.order.stop_market'], ['stop_limit', 'exits.order.stop_limit_soon', true]])
    fillSelect('exTpOrder', [['limit', 'exits.order.limit'], ['market', 'exits.order.market']])
    fillSelect('exSignalOrder', [['market', 'exits.order.market'], ['limit', 'exits.order.limit_soon', true]])

    for (const k of Object.keys(LEGS)) {
      const c = LEGS[k].cap
      $(`ex${c}On`).addEventListener('change', () => onLegToggle(k))
      $(`ex${c}Value`).addEventListener('input', () => changed())
      $(`ex${c}Order`).addEventListener('change', () => changed())
      $(`ex${c}TypeGroup`).addEventListener('click', e => {
        const btn = e.target.closest('.ex-chip')
        if (btn && !btn.disabled) setType(btn.dataset.leg, btn.dataset.type)
      })
      bindHandle(k)
    }
    $('exTtpOn').addEventListener('change', () => {
      if ($('exTtpOn').checked) $('exTpOn').checked = false
      showErr('')
      changed()
    })
    $('exSignalOrder').addEventListener('change', () => changed())
    $('exAtrPeriod').addEventListener('input', () => { changed(); fetchAtrRefDebounced() })
    ;['fSlippage', 'fFeeTaker', 'fFeeMaker'].forEach(id => $(id).addEventListener('input', () => changed()))

    $('openExitsBtn').addEventListener('click', open)
    $('exitsClose').addEventListener('click', close)
    $('exitsDone').addEventListener('click', close)
    $('exitsReset').addEventListener('click', resetExits)
    bindModalKeys('exitsModal', { onCancel: close })

    writeState(DEFAULT_EXITS, DEFAULT_EXECUTION)
  }

  let _atrTimer
  function fetchAtrRefDebounced() {
    clearTimeout(_atrTimer)
    _atrTimer = setTimeout(fetchAtrRef, 400)
  }

  window.ExitsOverlay = { init, open, close, readState, writeState, refresh }
})()