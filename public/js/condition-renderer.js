/**
 * condition-renderer.js
 *
 * Owns everything to do with condition rows: rendering the HTML, binding DOM
 * events back to the `conditions` state object, and keeping the two in sync.
 *
 * Depends on (must be loaded before this file):
 *   - indicator-config.js  (INDICATORS, OPERATORS, INDICATORS_WITH_PERIOD, …)
 *   - indicator-picker.js  (<indicator-picker> custom element)
 *   - i18n (t())
 *   - ICONS global
 *
 * Exposes:
 *   window.conditions          - live state: { entry: Group[][], exit: Group[][] }
 *   window.currentTab          - 'entry' | 'exit'
 *   window.getRule(type, gIdx, rIdx) -> condition object
 *   window.normalizeConditions(arr)  -> grouped array
 *   window.renderConditions()
 *   window.showTab(tab)
 */

let currentTab = 'entry'
let conditions  = { entry: [], exit: [] }

function getRule(type, gIdx, rIdx) {
  return conditions[type][parseInt(gIdx)][parseInt(rIdx)]
}

// Normalise flat [rule, …] → [[rule, …]] (retro-compat with old save format)
function normalizeConditions(arr) {
  if (!arr.length) return []
  if (Array.isArray(arr[0])) return arr
  return [arr]
}

function showTab(tab) {
  currentTab = tab
  document.getElementById('entryConditions').classList.toggle('conditions-panel--hidden', tab !== 'entry')
  document.getElementById('exitConditions').classList.toggle('conditions-panel--hidden',  tab !== 'exit')
  // document.getElementById('tabEntry').className = 'condition-tab' + (tab === 'entry' ? ' active-entry' : '')
  // document.getElementById('tabExit').className  = 'condition-tab' + (tab === 'exit'  ? ' active-exit'  : '')
  document.getElementById('tabEntry').classList.toggle('active-entry', tab === 'entry')
  document.getElementById('tabExit').classList.toggle('active-exit', tab === 'exit')
  renderConditions()
}

// Rendering 

// Fallback gear glyph used if icons.js hasn't got ICONS.settings/ICONS.gear
// yet (TODO: add a proper "settings" icon to ICONS in icons.js and drop
// this fallback).
const GEAR_ICON_FALLBACK = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.65 1.65 0 004.6 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 009 4.6a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09A1.65 1.65 0 0015 4.6a1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>'
const GEAR_ICON = (typeof ICONS !== 'undefined' && (ICONS.settings || ICONS.gear)) || GEAR_ICON_FALLBACK

function renderConditionRow(type, gIdx, rIdx, cond) {
  const isIndVsInd   = !!cond.valueIndicator
  const lookback     = cond.lookback || 1
  // Whether the LHS / RHS-as-indicator ref has any non-default setting
  // buried in the overlay (offset, timeframe, extra settings, combine).
  // Drives the little dot on the gear button - purely cosmetic.
  const lhsHasSettings = hasNonDefaultConditionSettings(cond, '')
  const rhsHasSettings = isIndVsInd && hasNonDefaultConditionSettings(cond, 'value')
  const OPERATOR_LABELS = {
    '>': '>', '<': '<', '>=': '>=', '<=': '<=', '==': '==',
    'cross_above': t('editor.cond.cross_above'),
    'cross_below': t('editor.cond.cross_below'),
  }
  const isCross = ['cross_above', 'cross_below'].includes(cond.operator)
  const d = (show) => show ? '' : 'display:none'

  const row = document.createElement('div')
  row.className = 'condition-row'
  row.innerHTML = `
    <div class="cond-body">

      <!-- LHS : indicator A -->
      <div class="cond-side cond-lhs">
        <div class="cond-side-label">
          ${t('editor.cond.ind_a')}
          <button class="rm-rule-btn btn btn-ghost btn-sm" data-type="${type}" data-gidx="${gIdx}" data-ridx="${rIdx}">${ICONS.cross}</button>
        </div>
        <div class="cond-full">
          <div class="cond-side-main">
            <indicator-picker class="c-indicator" data-type="${type}" data-gidx="${gIdx}" data-ridx="${rIdx}" value="${cond.indicator}"></indicator-picker>
            <button type="button" class="btn btn-ghost btn-xs cs-gear-btn${lhsHasSettings ? ' cs-gear-btn--active' : ''}"
              data-type="${type}" data-gidx="${gIdx}" data-ridx="${rIdx}" data-prefix=""
              title="${t('editor.cond.settings')}">${GEAR_ICON}</button>
          </div>
        </div>
      </div>

      <!-- Operator -->
      <div class="cond-op">
        <select class="c-operator" data-type="${type}" data-gidx="${gIdx}" data-ridx="${rIdx}">
          ${OPERATORS.map(o => `<option value="${o}"${o === cond.operator ? ' selected' : ''}>${OPERATOR_LABELS[o]}</option>`).join('')}
        </select>
      </div>

      <!-- RHS : fixed value or indicator B -->
      <div class="cond-side cond-rhs">
        <div class="cond-side-label">
          ${isIndVsInd ? t('editor.cond.ind_b') : t('editor.cond.fixed_value')}
        </div>
        <div class="cond-full">
          <div class="cond-side-main">
            <button class="btn btn-ghost btn-xs c-value-toggle" data-type="${type}" data-gidx="${gIdx}" data-ridx="${rIdx}" title="${t('editor.cond.toggle_value')}">
              ${isIndVsInd ? ICONS.sigma : ICONS.chart_spline}
            </button>
            <input type="number" class="c-value condition-value" data-type="${type}" data-gidx="${gIdx}" data-ridx="${rIdx}"
              value="${cond.value ?? 0}" step="any" style="${d(!isIndVsInd)}">
            <indicator-picker class="c-value-ind" data-type="${type}" data-gidx="${gIdx}" data-ridx="${rIdx}" value="${cond.valueIndicator || ''}" style="${d(isIndVsInd)}"></indicator-picker>
            <button type="button" class="btn btn-ghost btn-xs cs-gear-btn${rhsHasSettings ? ' cs-gear-btn--active' : ''}"
              data-type="${type}" data-gidx="${gIdx}" data-ridx="${rIdx}" data-prefix="value"
              title="${t('editor.cond.settings')}" style="${d(isIndVsInd)}">${GEAR_ICON}</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Lookback footer -->
    <div class="cond-footer">
      <span class="cond-footer-label" title="${t('editor.cond.lookback_hint')}">${t('editor.cond.lookback_eval')}</span>
      <input type="number" class="c-lookback ${isCross ? 'input-ghost' : ''}"
        data-type="${type}" data-gidx="${gIdx}" data-ridx="${rIdx}"
        value="${lookback}" min="1" max="200"
        ${isCross ? 'disabled' : ''}>
      <span class="cond-footer-label">${t('editor.cond.lookback_candles')}</span>
      <select class="c-lookback-mode" data-type="${type}" data-gidx="${gIdx}" data-ridx="${rIdx}"
        style="${d(lookback > 1)}">
        <option value="all"${(cond.lookbackMode || 'all') === 'all' ? ' selected' : ''}>${t('editor.cond.lookback_all')}</option>
        <option value="any"${cond.lookbackMode === 'any' ? ' selected' : ''}>${t('editor.cond.lookback_any')}</option>
      </select>
    </div>
  `
  return row
}

function renderConditions() {
  ;['entry', 'exit'].forEach(type => {
    const container = document.getElementById(type + 'Conditions')
    container.innerHTML = ''
    const groups = conditions[type]

    if (!groups.length || (groups.length === 1 && !groups[0].length)) {
      container.innerHTML = `<div class="conditions-hint">${t('editor.cond.empty')}</div>`
    } else {
      groups.forEach((group, gIdx) => {
        if (gIdx > 0) {
          const sep = document.createElement('div')
          sep.className = 'group-separator'
          sep.innerHTML = `<span class="group-separator-label">OR</span>`
          container.appendChild(sep)
        }
        const groupEl = document.createElement('div')
        groupEl.className = 'condition-group'
        if (groups.length > 1) {
          const hdr = document.createElement('div')
          hdr.className = 'group-header'
          hdr.innerHTML = `
            <span class="group-label">${t('editor.cond.group')} ${gIdx + 1}</span>
            <button class="rm-group-btn btn btn-ghost btn-sm" data-type="${type}" data-gidx="${gIdx}">${ICONS.cross}${t('editor.cond.rm_group')}</button>
          `
          groupEl.appendChild(hdr)
        }
        group.forEach((cond, rIdx) => {
          if (rIdx > 0) {
            const andSep = document.createElement('div')
            andSep.className = 'and-separator'
            andSep.textContent = 'AND'
            groupEl.appendChild(andSep)
          }
          groupEl.appendChild(renderConditionRow(type, gIdx, rIdx, cond))
        })
        const addInGroup = document.createElement('button')
        addInGroup.className = 'add-rule-in-group-btn btn btn-ghost btn-sm'
        addInGroup.dataset.type = type
        addInGroup.dataset.gidx = gIdx
        addInGroup.innerHTML = `${ICONS.plus}<span>AND</span>`
        groupEl.appendChild(addInGroup)
        container.appendChild(groupEl)
      })
    }
  })
  bindConditionEvents()
}

// Event binding 

function bindConditionEvents() {
  document.querySelectorAll('.c-indicator').forEach(el => {
    el.addEventListener('change', e => {
      const { type, gidx, ridx } = e.target.dataset
      const cond = getRule(type, gidx, ridx)
      cond.indicator = e.target.value
      // period/source now live only in the settings overlay (gear button) -
      // clear whatever doesn't apply to the newly picked indicator so a
      // stale value can't leak into the payload.
      if (INDICATORS_WITH_PERIOD.includes(e.target.value)) {
        cond.period = INDICATOR_DEFAULT_PERIOD[e.target.value] || 14
      } else {
        delete cond.period
      }
      if (!INDICATORS_WITH_SOURCES.includes(e.target.value)) delete cond.source
      if (!INDICATOR_EXTRA_PARAMS[e.target.value])           delete cond.settings
      const gearBtn = e.target.closest('.cond-side-main').querySelector('.cs-gear-btn')
      gearBtn.classList.toggle('cs-gear-btn--active', hasNonDefaultConditionSettings(cond, ''))
      updatePreview()
    })
  })

  document.querySelectorAll('.cs-gear-btn').forEach(el => {
    el.addEventListener('click', e => {
      const { type, gidx, ridx, prefix } = e.target.closest('button').dataset
      openConditionSettings(type, gidx, ridx, prefix)
    })
  })

  document.querySelectorAll('.c-operator').forEach(el => {
    el.addEventListener('change', e => {
      const { type, gidx, ridx } = e.target.dataset
      const cond = getRule(type, gidx, ridx)
      cond.operator = e.target.value
      const isCross = ['cross_above', 'cross_below'].includes(e.target.value)
      const lookbackInput = e.target.closest('.condition-row').querySelector('.c-lookback')
      lookbackInput.classList.toggle('input-ghost', isCross)
      lookbackInput.disabled = isCross
      if (isCross) {
        delete cond.lookback
        delete cond.lookbackMode
        lookbackInput.value = 1
        e.target.closest('.condition-row').querySelector('.c-lookback-mode').style.display = 'none'
      }
      updatePreview()
    })
  })

  document.querySelectorAll('.c-value').forEach(el => {
    el.addEventListener('input', e => {
      const { type, gidx, ridx } = e.target.dataset
      getRule(type, gidx, ridx).value = parseFloat(e.target.value)
      updatePreview()
    })
  })

  document.querySelectorAll('.c-value-toggle').forEach(el => {
    el.addEventListener('click', e => {
      const btn  = e.target.closest('button')
      const { type, gidx, ridx } = btn.dataset
      const cond = getRule(type, gidx, ridx)
      const row  = btn.closest('.condition-row')
      const rhs  = row.querySelector('.cond-rhs')
      const lbl  = rhs.querySelector('.cond-side-label')
      const gearBtn = rhs.querySelector('.cs-gear-btn')
      if (cond.valueIndicator) {
        // Switch to fixed value - drop every RHS-as-indicator key (incl.
        // settings overlay ones: offset/timeframe/settings/combine*).
        delete cond.valueIndicator;         delete cond.valueIndicatorPeriod
        delete cond.valueIndicatorSource;   delete cond.valueIndicatorOffset
        delete cond.valueIndicatorTimeframe; delete cond.valueIndicatorSettings
        delete cond.valueMultiplier
        delete cond.valueCombineOp;     delete cond.valueCombineIndicator
        delete cond.valueCombinePeriod; delete cond.valueCombineSource
        delete cond.valueCombineOffset; delete cond.valueCombineSettings
        if (cond.value === undefined) cond.value = 0
        btn.innerHTML = ICONS.chart_spline
        lbl.childNodes[0].textContent = t('editor.cond.fixed_value') + ' '
        row.querySelector('.c-value').style.display     = ''
        row.querySelector('.c-value-ind').style.display = 'none'
        gearBtn.style.display = 'none'
      } else {
        // Switch to indicator vs indicator
        delete cond.value
        cond.valueIndicator = INDICATORS[0]
        btn.innerHTML = ICONS.sigma
        lbl.childNodes[0].textContent = t('editor.cond.ind_b') + ' '
        row.querySelector('.c-value').style.display     = 'none'
        row.querySelector('.c-value-ind').style.display = ''
        row.querySelector('.c-value-ind').setAttribute('value', cond.valueIndicator)
        gearBtn.style.display = ''
        gearBtn.classList.remove('cs-gear-btn--active')
      }
      updatePreview()
    })
  })

  document.querySelectorAll('.c-value-ind').forEach(el => {
    el.addEventListener('change', e => {
      const { type, gidx, ridx } = e.target.dataset
      const cond = getRule(type, gidx, ridx)
      cond.valueIndicator = e.target.value
      if (!INDICATORS_WITH_PERIOD.includes(e.target.value))  delete cond.valueIndicatorPeriod
      if (!INDICATORS_WITH_SOURCES.includes(e.target.value)) delete cond.valueIndicatorSource
      if (!INDICATOR_EXTRA_PARAMS[e.target.value])           delete cond.valueIndicatorSettings
      const gearBtn = e.target.closest('.cond-side-main').querySelector('.cs-gear-btn')
      gearBtn.classList.toggle('cs-gear-btn--active', hasNonDefaultConditionSettings(cond, 'value'))
      updatePreview()
    })
  })

  document.querySelectorAll('.c-lookback').forEach(el => {
    el.addEventListener('input', e => {
      const { type, gidx, ridx } = e.target.dataset
      const cond = getRule(type, gidx, ridx)
      const n = parseInt(e.target.value) || 1
      if (n > 1) cond.lookback = n
      else delete cond.lookback
      const modeSel = e.target.closest('.cond-footer').querySelector('.c-lookback-mode')
      modeSel.style.display = n > 1 ? '' : 'none'
      updatePreview()
    })
  })

  document.querySelectorAll('.c-lookback-mode').forEach(el => {
    el.addEventListener('change', e => {
      const { type, gidx, ridx } = e.target.dataset
      const cond = getRule(type, gidx, ridx)
      if (e.target.value === 'all') delete cond.lookbackMode
      else cond.lookbackMode = e.target.value
      updatePreview()
    })
  })

  document.querySelectorAll('.rm-rule-btn').forEach(el => {
    el.addEventListener('click', e => {
      const { type, gidx, ridx } = e.target.closest('button').dataset
      conditions[type][parseInt(gidx)].splice(parseInt(ridx), 1)
      if (!conditions[type][parseInt(gidx)].length) conditions[type].splice(parseInt(gidx), 1)
      renderConditions(); updatePreview()
    })
  })

  document.querySelectorAll('.rm-group-btn').forEach(el => {
    el.addEventListener('click', e => {
      const { type, gidx } = e.target.closest('button').dataset
      conditions[type].splice(parseInt(gidx), 1)
      renderConditions(); updatePreview()
    })
  })

  document.querySelectorAll('.add-rule-in-group-btn').forEach(el => {
    el.addEventListener('click', e => {
      const { type, gidx } = e.target.closest('button').dataset
      conditions[type][parseInt(gidx)].push({ indicator: 'RSI', period: INDICATOR_DEFAULT_PERIOD['RSI'], operator: '<', value: 30 })
      renderConditions(); updatePreview()
    })
  })
}

// Exports 

window.conditions         = conditions
window.currentTab         = currentTab
window.getRule            = getRule
window.normalizeConditions = normalizeConditions
window.renderConditions   = renderConditions
window.showTab            = showTab