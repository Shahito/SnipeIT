/**
 * strategy-form.js
 *
 * Owns everything outside of condition rows: reading/writing the form fields,
 * building the API payload, save and save+run actions, trading hours slots,
 * ATR visibility, mobile step nav, and the leave-page guard.
 *
 * Depends on (must be loaded before this file):
 *   - indicator-config.js    (INDICATOR_SOURCES)
 *   - condition-renderer.js  (conditions, normalizeConditions, renderConditions)
 *   - api.js, toast.js, i18n (api(), toast(), t())
 *   - ICONS global
 *
 * Entry point: call initStrategyForm() once inside the 'header:ready' handler.
 */

// Leave-page guard 

const confirmLeave = (e) => { e.preventDefault(); e.returnValue = '' }
window.addEventListener('beforeunload', confirmLeave)
document.querySelector('a[href="/strategies.html"]')
  .addEventListener('click', () => window.removeEventListener('beforeunload', confirmLeave))

// ATR visibility 

function updateAtrVisibility() {
  const show = document.getElementById('fSlType').value === 'atr'
            || document.getElementById('fTpType').value === 'atr'
  document.getElementById('atrPeriodGroup').style.display = show ? 'grid' : 'none'
}

document.getElementById('fSlType').addEventListener('change', () => {
  updateAtrVisibility()
  if (document.getElementById('fSlType').value === 'atr') {
    document.getElementById('fSlTrailing').checked = false
    document.getElementById('fSlTrailing').closest('label').style.display = 'none'
  } else {
    document.getElementById('fSlTrailing').closest('label').style.display = ''
  }
  updatePreview()
})
document.getElementById('fTpType').addEventListener('change', () => { updateAtrVisibility(); updatePreview() })

// Trading hours 

function addTradingHourSlot(slot = null) {
  const container = document.getElementById('tradingHoursContainer')
  const div = document.createElement('div')
  div.className = 'trading-hour-row'
  div.dataset.idx = container.children.length
  div.innerHTML = `
    <div class="th-row-wrap">
      <input type="time" class="th-start" value="${slot?.start || '08:00'}">
      <input type="time" class="th-end"   value="${slot?.end   || '17:00'}">
      <label class="checkbox-label th-block-sell-label">
        <input type="checkbox" class="th-block-sell" ${slot ? !slot.blockSell ? 'checked' : '' : ''}>
        ${t('editor.field.trading_hours_block_sell')}
      </label>
    </div>
    <button type="button" class="btn btn-danger btn-sm th-remove-btn"
      onclick="this.parentElement.remove(); updatePreview()">${ICONS.cross}</button>
  `
  div.querySelectorAll('input').forEach(el => el.addEventListener('change', updatePreview))
  container.appendChild(div)
  updatePreview()
}

function getTradingHours() {
  return Array.from(document.querySelectorAll('#tradingHoursContainer .trading-hour-row'))
    .map(row => ({
      start:     row.querySelector('.th-start').value,
      end:       row.querySelector('.th-end').value,
      blockSell: !row.querySelector('.th-block-sell').checked,
    }))
    .filter(s => s.start && s.end)
}

// Payload & preview 

function buildPayload() {
  return {
    name:             document.getElementById('fName').value,
    pair:             document.getElementById('fPair').value,
    timeframe:        document.getElementById('fTimeframe').value,
    startDate:        document.getElementById('fStartDate').value,
    endDate:          document.getElementById('fEndDate').value,
    initialCapital:   parseFloat(document.getElementById('fCapital').value)      || 1000,
    positionSize:     parseFloat(document.getElementById('fPositionSize').value)  || 100,
    stopLoss:         !document.getElementById('fSlTrailing').checked && document.getElementById('fStopLoss').value
                        ? parseFloat(document.getElementById('fStopLoss').value) : null,
    trailingStopLoss: document.getElementById('fSlTrailing').checked && document.getElementById('fStopLoss').value
                        ? parseFloat(document.getElementById('fStopLoss').value) : null,
    takeProfit:       document.getElementById('fTakeProfit').value
                        ? parseFloat(document.getElementById('fTakeProfit').value) : null,
    slType:           document.getElementById('fSlType').value,
    tpType:           document.getElementById('fTpType').value,
    atrPeriod:        parseInt(document.getElementById('fAtrPeriod').value) || 14,
    feeTaker:         parseFloat(document.getElementById('fFeeTaker').value) || 0.1,
    feeMaker:         parseFloat(document.getElementById('fFeeMaker').value) || 0.1,
    tradingHours:     getTradingHours().length ? getTradingHours() : null,
    description:      document.getElementById('fDescription').value,
    conditions,
  }
}

function updatePreview() {
  document.getElementById('jsonPreview').textContent = JSON.stringify(buildPayload(), null, 2)
}

// Load existing strategy 

async function loadStrategy(id) {
  try {
    const { strategy: s } = await api(`/strategies/${id}`)
    document.getElementById('fName').value         = s.name
    document.getElementById('fDescription').value  = s.description || ''
    document.getElementById('fPair').value         = s.pair
    document.getElementById('fTimeframe').value    = s.timeframe
    document.getElementById('fStartDate').value    = s.startDate.slice(0, 10)
    document.getElementById('fEndDate').value      = s.endDate.slice(0, 10)
    document.getElementById('fCapital').value      = s.initialCapital
    document.getElementById('fPositionSize').value = s.positionSize
    document.getElementById('fStopLoss').value     = s.stopLoss ?? s.trailingStopLoss ?? ''
    document.getElementById('fTakeProfit').value   = s.takeProfit || ''
    document.getElementById('fSlTrailing').checked = !!s.trailingStopLoss && !s.stopLoss
    document.getElementById('fSlType').value       = s.slType  || 'percent'
    document.getElementById('fSlTrailing').closest('label').style.display = s.slType !== 'percent' ? 'none' : ''
    document.getElementById('fTpType').value       = s.tpType  || 'percent'
    document.getElementById('fAtrPeriod').value    = s.atrPeriod || 14
    updateAtrVisibility()
    document.getElementById('fFeeTaker').value = s.feeTaker ?? 0.1
    document.getElementById('fFeeMaker').value = s.feeMaker ?? 0.1
    document.getElementById('tradingHoursContainer').innerHTML = ''
    if (s.tradingHours) s.tradingHours.forEach(slot => addTradingHourSlot(slot))

    const raw = s.conditions
    conditions.entry = normalizeConditions(raw.entry || [])
    conditions.exit  = normalizeConditions(raw.exit  || [])
    renderConditions(); updatePreview()
  } catch (e) {
    toast(t('editor.not_found'), 'error')
    setTimeout(() => window.location.href = '/strategies.html', 1500)
  }
}

// Save / Save+Run 

function _setSaveBtnsState(disabled, labels = null) {
  const saveBtn       = document.getElementById('saveBtn')
  const saveAndRunBtn = document.getElementById('saveAndRunBtn')
  saveBtn.disabled       = disabled
  saveAndRunBtn.disabled = disabled
  if (labels) {
    saveBtn.innerHTML       = labels.save
    saveAndRunBtn.innerHTML = labels.run
  } else if (disabled) {
    saveBtn.innerHTML       = '...'
    saveAndRunBtn.innerHTML = '...'
  }
}

async function _savePayload() {
  const editId = window._editId
  const payload = buildPayload()
  if (editId) {
    await api(`/strategies/${editId}`, { method: 'PUT', body: payload })
    toast(t('editor.saved'), 'success')
    return editId
  } else {
    const result = await api('/strategies', { method: 'POST', body: payload })
    toast(t('editor.created'), 'success')
    return result.strategy.id
  }
}

document.getElementById('saveBtn').addEventListener('click', async () => {
  document.getElementById('globalError').textContent = ''
  _setSaveBtnsState(true)
  try {
    await _savePayload()
    window.removeEventListener('beforeunload', confirmLeave)
    setTimeout(() => window.location.href = '/strategies.html', 800)
  } catch (e) {
    document.getElementById('globalError').textContent = t('error.' + e.code)
    _setSaveBtnsState(false, {
      save: `${ICONS.save}<span>${t('editor.save')}</span>`,
      run:  `${ICONS.play}<span>${t('editor.save_and_run')}</span>`,
    })
  }
})

document.getElementById('saveAndRunBtn').addEventListener('click', async () => {
  document.getElementById('globalError').textContent = ''
  _setSaveBtnsState(true)
  let targetId
  try {
    targetId = await _savePayload()
  } catch (e) {
    document.getElementById('globalError').textContent = t('error.' + e.code)
    _setSaveBtnsState(false, {
      save: `${ICONS.save}<span>${t('editor.save')}</span>`,
      run:  `${ICONS.play}<span>${t('editor.save_and_run')}</span>`,
    })
    return
  }
  try {
    await api('/jobs', { method: 'POST', body: { strategyId: targetId } })
    toast(t('strategies.job_launched'), 'success')
    window.removeEventListener('beforeunload', confirmLeave)
    setTimeout(() => window.location.href = '/strategies.html', 800)
  } catch (e) {
    toast(t('error.' + e.code), 'error')
    _setSaveBtnsState(false, {
      save: `${ICONS.save}<span>${t('editor.save')}</span>`,
      run:  `${ICONS.play}<span>${t('editor.save_and_run')}</span>`,
    })
  }
})

// Field change → preview 

;['fName','fPair','fTimeframe','fStartDate','fEndDate','fCapital',
  'fPositionSize','fStopLoss','fTakeProfit','fAtrPeriod'].forEach(id => {
  const el = document.getElementById(id)
  if (el) { el.addEventListener('input', updatePreview); el.addEventListener('change', updatePreview) }
})
document.getElementById('fSlTrailing').addEventListener('change', updatePreview)

document.getElementById('addGroupBtn').addEventListener('click', () => {
  conditions[currentTab].push([{ indicator: 'RSI', period: INDICATOR_DEFAULT_PERIOD['RSI'], operator: '<', value: 30 }])
  renderConditions(); updatePreview()
})

// Mobile step nav 

function goToStep(n) {
  document.querySelectorAll('.mnav-item').forEach((el, i) => el.classList.toggle('active', i === n))
  if (window.innerWidth <= 1100) {
    document.getElementById('editorLayout').style.transform = `translateX(${-n * 100}vw)`
  }
}

document.querySelectorAll('.mnav-item').forEach((el, i) => {
  el.addEventListener('click', () => goToStep(i))
})

window.addEventListener('resize', () => {
  if (window.innerWidth > 1100) {
    document.getElementById('editorLayout').style.transform = ''
  } else {
    const active = document.querySelector('.mnav-item.active')
    const n = active ? parseInt(active.dataset.step) : 0
    document.getElementById('editorLayout').style.transform = `translateX(${-n * 100}vw)`
  }
})

// Exports 

window.updatePreview      = updatePreview
window.buildPayload       = buildPayload
window.loadStrategy       = loadStrategy
window.addTradingHourSlot = addTradingHourSlot
window.updateAtrVisibility = updateAtrVisibility
window.goToStep           = goToStep