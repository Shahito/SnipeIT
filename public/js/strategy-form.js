/**
 * strategy-form.js
 *
 * Owns everything outside of condition rows: reading/writing the form fields,
 * building the API payload, save and save+run actions, trading hours slots,
 * ATR visibility, mobile step nav, and the leave-page guard.
 *
 * Sweep refonte : pairs/timeframe/positionSize/stopLoss/takeProfit/
 * trailingStopLoss/slType/tpType/atrPeriod peuvent tous être des listes
 * (sweep) plutôt qu'une valeur unique - voir sweep-parse.js pour la
 * convention (chips multi-select pour les énumérés, "a, b, c" pour les
 * champs numériques).
 *
 * Depends on (must be loaded before this file):
 *   - sweep-parse.js         (parseSweepNumber, formatSweepNumber, chip-group helpers)
 *   - indicator-config.js    (INDICATOR_SOURCES)
 *   - condition-renderer.js  (conditions, normalizeConditions, renderConditions)
 *   - api.js, toast.js, i18n (api(), toast(), t())
 *   - overlay-a11y.js        (openModal/closeModal/bindModalKeys)
 *   - ICONS global
 *
 * Entry point: call initStrategyForm() once inside the 'header:ready' handler.
 */

// Constantes de listes (remplacent les anciennes <option> statiques)

const TIMEFRAMES_LIST = ['1m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '12h', '1d', '3d', '1w']
const RISK_TYPES = [{ value: 'percent', label: '%' }, { value: 'atr', label: '× ATR' }]

const STRATEGY_NAME_ADJECTIVES = [
  'Diamond', 'Feral', 'Reckless', 'Caffeinated', 'Nocturnal', 'Greedy',
  'Rogue', 'Savage', 'Sneaky', 'Unhinged', 'Legendary', 'Lucky', 'Chaotic', 'Ruthless',
]
const STRATEGY_NAME_NOUNS = [
  'Whale', 'Wolf', 'Rocket', 'Moonshot', 'Sniper', 'Gambit',
  'Heist', 'Bandit', 'Maverick', 'Outlaw', 'Prophet', 'Oracle', 'Vulture', 'Hustle',
]

function generateStrategyName() {
  const adj  = STRATEGY_NAME_ADJECTIVES[Math.floor(Math.random() * STRATEGY_NAME_ADJECTIVES.length)]
  const noun = STRATEGY_NAME_NOUNS[Math.floor(Math.random() * STRATEGY_NAME_NOUNS.length)]
  return `${adj} ${noun}`
}
window.generateStrategyName = generateStrategyName

// Garde-fou d'avertissement, purement indicatif côté front (l'API refait le
// calcul et applique la vraie limite - voir src/config/sweep.js, à garder
// synchronisé si la valeur change côté serveur).
const SWEEP_WARNING_THRESHOLD_CLIENT = 200

// Leave-page guard

const confirmLeave = (e) => { e.preventDefault(); e.returnValue = '' }
window.addEventListener('beforeunload', confirmLeave)
document.querySelector('a[href="/strategies.html"]')
  .addEventListener('click', () => window.removeEventListener('beforeunload', confirmLeave))

// ATR visibility / trailing visibility (dépend des chips slType/tpType)

function updateAtrVisibility() {
  const slTypes = getChipGroupSelected('fSlTypeGroup')
  const tpTypes = getChipGroupSelected('fTpTypeGroup')
  const show = slTypes.includes('atr') || tpTypes.includes('atr')
  document.getElementById('atrPeriodGroup').style.display = show ? 'grid' : 'none'

  const trailingLabel = document.getElementById('fSlTrailing').closest('label')
  if (slTypes.includes('atr')) {
    document.getElementById('fSlTrailing').checked = false
    trailingLabel.style.display = 'none'
  } else {
    trailingLabel.style.display = ''
  }
}
function bindSweepChipGroups() {
  ;['fTimeframeGroup'].forEach(id => bindChipGroup(id, updatePreview))
  ;['fSlTypeGroup', 'fTpTypeGroup'].forEach(id => bindChipGroup(id, () => { updateAtrVisibility(); updatePreview() }))
}

// Coins de base × coins de cotation -> pairs[]. Filtré côté serveur sur ce
// qui existe vraiment sur Binance (voir POST /api/coins/validate-pairs) -
// toutes les combinaisons base×quote ne sont pas forcément des paires
// tradables réelles (ex: deux coins qui ne se cotent jamais l'un contre l'autre).
let _currentPairs = []

function cartesianPairs() {
  const bases  = document.getElementById('fBaseCoins').value
  const quotes = document.getElementById('fQuoteCoins').value
  const out = []
  bases.forEach(b => quotes.forEach(q => { if (b !== q) out.push(`${b}/${q}`) }))
  return out
}

let _pairsPreviewPromise = null
const INVALID_PAIRS_TAG_LIMIT = 3

function renderLimitedTags(items, cssClass, limit) {
  const shown = items.slice(0, limit)
  const extra = items.length - shown.length
  let html = shown.map(p => `<span class="tag ${cssClass}">${p}</span>`).join('')
  if (extra > 0) html += `<span class="extra">+${extra}</span>`
  return html
}

async function updatePairsPreview() {
  const candidates = cartesianPairs()
  const emptyMsg  = document.getElementById('pairsEmptyMsg')
  const validEl   = document.getElementById('pairsValidTags')
  const invalidEl = document.getElementById('pairsInvalidTags')

  if (!candidates.length) {
    _currentPairs = []
    emptyMsg.textContent = t('editor.field.pairs_generated_empty')
    validEl.innerHTML = ''
    invalidEl.innerHTML = ''
    updatePreview()
    return
  }
  emptyMsg.textContent = ''

  _pairsPreviewPromise = (async () => {
    try {
      const { valid, invalid } = await api('/coins/validate-pairs', { method: 'POST', body: { pairs: candidates } })
      _currentPairs = valid
      validEl.innerHTML   = valid.map(p => `<span class="tag tag-primary">${p}</span>`).join('')
      invalidEl.innerHTML = renderLimitedTags(invalid, 'tag-danger', INVALID_PAIRS_TAG_LIMIT)
    } catch (e) {
      _currentPairs = candidates
      validEl.innerHTML   = candidates.map(p => `<span class="tag tag-primary">${p}</span>`).join('')
      invalidEl.innerHTML = ''
    }
    updatePreview()
  })()

  await _pairsPreviewPromise
}

function bindCoinPickers() {
  ;['fBaseCoins', 'fQuoteCoins'].forEach(id => {
    document.getElementById(id).addEventListener('change', updatePairsPreview)
  })
}

// Timeframe "de référence" utilisé uniquement par l'overlay de réglages de
// condition (condition-settings.js) pour filtrer les timeframes proposées à
// >= celle-ci - purement indicatif côté UI, aucun rapport avec la résolution
// réelle du sweep (qui se fait côté serveur, combinaison par combinaison).
// Si plusieurs timeframes sont sweepées, on prend la plus courte des deux
// pour ne jamais masquer une option valide pour l'une des combinaisons.
function getPrimaryTimeframe() {
  const selected = getChipGroupSelected('fTimeframeGroup')
  if (!selected.length) return '1h'
  const idx = tf => TIMEFRAMES_LIST.indexOf(tf)
  return selected.reduce((shortest, tf) => idx(tf) < idx(shortest) ? tf : shortest, selected[0])
}
window.getPrimaryTimeframe = getPrimaryTimeframe

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
function _resolveConditionDefaults(cond) {
  const c = { ...cond }
  const REFS = [
    { ind: 'indicator',             per: 'period',              src: 'source',              set: 'settings' },
    { ind: 'combineIndicator',      per: 'combinePeriod',        src: 'combineSource',        set: 'combineSettings' },
    { ind: 'valueIndicator',        per: 'valueIndicatorPeriod', src: 'valueIndicatorSource', set: 'valueIndicatorSettings' },
    { ind: 'valueCombineIndicator', per: 'valueCombinePeriod',   src: 'valueCombineSource',   set: 'valueCombineSettings' },
  ]
  REFS.forEach(({ ind, per, src, set }) => {
    const indicator = c[ind]
    if (!indicator) return
    if (INDICATORS_WITH_PERIOD.includes(indicator)) {
      c[per] = c[per] ?? INDICATOR_DEFAULT_PERIOD[indicator] ?? 14
    }
    if (INDICATORS_WITH_SOURCES.includes(indicator)) {
      c[src] = c[src] || 'CLOSE'
    }
    const extra = INDICATOR_EXTRA_PARAMS[indicator]
    if (extra) {
      const existing = c[set] || {}
      c[set] = extra.reduce((acc, p) => {
        acc[p.key] = existing[p.key] ?? p.default
        return acc
      }, {})
    }
  })
  return c
}

function _resolveConditionGroupsDefaults(groups) {
  return (groups || []).map(g => g.map(_resolveConditionDefaults))
}

function buildPayload() {
  return {
    name:             document.getElementById('fName').value,
    pairs:            _currentPairs,
    timeframe:        parseSweepChoice(getChipGroupSelected('fTimeframeGroup')),
    startDate:        document.getElementById('fStartDate').value,
    endDate:          document.getElementById('fEndDate').value,
    initialCapital:   parseFloat(document.getElementById('fCapital').value)      || 1000,
    positionSize:     parseSweepNumber(document.getElementById('fPositionSize').value) ?? 10,
    stopLoss:         !document.getElementById('fSlTrailing').checked && document.getElementById('fStopLoss').value
                        ? parseSweepNumber(document.getElementById('fStopLoss').value) : null,
    trailingStopLoss: document.getElementById('fSlTrailing').checked && document.getElementById('fStopLoss').value
                        ? parseSweepNumber(document.getElementById('fStopLoss').value) : null,
    takeProfit:       document.getElementById('fTakeProfit').value
                        ? parseSweepNumber(document.getElementById('fTakeProfit').value) : null,
    slType:           parseSweepChoice(getChipGroupSelected('fSlTypeGroup')),
    tpType:           parseSweepChoice(getChipGroupSelected('fTpTypeGroup')),
    atrPeriod:        parseSweepNumber(document.getElementById('fAtrPeriod').value, parseInt) ?? 14,
    feeTaker:         Number.isNaN(parseFloat(document.getElementById('fFeeTaker').value)) ? 0.1 : parseFloat(document.getElementById('fFeeTaker').value),
    feeMaker:         Number.isNaN(parseFloat(document.getElementById('fFeeMaker').value)) ? 0.1 : parseFloat(document.getElementById('fFeeMaker').value),
    tradingHours:     getTradingHours().length ? getTradingHours() : null,
    description:      document.getElementById('fDescription').value,
    conditions: {
      entry: _resolveConditionGroupsDefaults(conditions.entry),
      exit:  _resolveConditionGroupsDefaults(conditions.exit),
    },
  }
}

// Compte le nombre de combinaisons côté client, purement informatif (l'API
// refait le calcul exact - voir sweepEngine.js). Parcourt tout marqueur
// { sweep: [...] } dans le payload + pairs[].
function countCombinationsClientSide(payload) {
  const { pairs, ...rest } = payload
  let count = Math.max(Array.isArray(pairs) ? pairs.length : 1, 1)
  const walk = (node) => {
    if (node && typeof node === 'object' && !Array.isArray(node) && Array.isArray(node.sweep)) {
      count *= node.sweep.length || 1
      return
    }
    if (Array.isArray(node)) { node.forEach(walk); return }
    if (node && typeof node === 'object') Object.values(node).forEach(walk)
  }
  walk(rest)
  return count
}

function updateRunsBadge(payload) {
  const n = countCombinationsClientSide(payload)
  const badge = document.getElementById('sweepRunsBadge')
  if (n > 1) {
    badge.style.display = ''
    badge.className = 'tag ' + (n > SWEEP_WARNING_THRESHOLD_CLIENT ? 'tag-warning' : 'tag-primary')
    badge.textContent = t('editor.sweep_runs_badge', { n })
  } else {
    badge.style.display = 'none'
  }
}

function updatePreview() {
  const payload = buildPayload()
  document.getElementById('jsonPreview').textContent = JSON.stringify(payload, null, 2)
  updateRunsBadge(payload)
}

// Load existing strategy

async function loadStrategy(id) {
  try {
    const { strategy: s } = await api(`/strategies/${id}`)
    document.getElementById('fName').value         = s.name
    document.getElementById('fDescription').value  = s.description || ''
    document.getElementById('fBaseCoins').setSilent([...new Set(s.pairs.map(p => p.split('/')[0]))])
    document.getElementById('fQuoteCoins').setSilent([...new Set(s.pairs.map(p => p.split('/')[1]))])
    _currentPairs = s.pairs
    document.getElementById('pairsEmptyMsg').textContent = ''
    document.getElementById('pairsValidTags').innerHTML   = s.pairs.map(p => `<span class="tag tag-primary">${p}</span>`).join('')
    document.getElementById('pairsInvalidTags').innerHTML = ''
    renderChipGroup('fTimeframeGroup', TIMEFRAMES_LIST, formatSweepChoice(s.timeframe))
    document.getElementById('fStartDate').value    = s.startDate.slice(0, 10)
    document.getElementById('fEndDate').value      = s.endDate.slice(0, 10)
    document.getElementById('fCapital').value      = s.initialCapital
    document.getElementById('fPositionSize').value = formatSweepNumber(s.positionSize)
    document.getElementById('fStopLoss').value     = formatSweepNumber(s.stopLoss ?? s.trailingStopLoss)
    document.getElementById('fTakeProfit').value   = formatSweepNumber(s.takeProfit)
    document.getElementById('fSlTrailing').checked = !!s.trailingStopLoss && !s.stopLoss
    renderChipGroup('fSlTypeGroup', RISK_TYPES, formatSweepChoice(s.slType || 'percent'))
    renderChipGroup('fTpTypeGroup', RISK_TYPES, formatSweepChoice(s.tpType || 'percent'))
    document.getElementById('fAtrPeriod').value    = formatSweepNumber(s.atrPeriod ?? 14)
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

function _restoreSaveBtnsLabels() {
  _setSaveBtnsState(false, {
    save: `${ICONS.save}<span>${t('editor.save')}</span>`,
    run:  `${ICONS.play}<span>${t('editor.save_and_run')}</span>`,
  })
}

async function _savePayload() {
  if (_pairsPreviewPromise) await _pairsPreviewPromise
  const editId = window._editId
  const payload = buildPayload()
  if (editId) {
    await api(`/strategies/${editId}`, { method: 'PUT', body: payload })
    toast(t('editor.saved'), 'success')
    return editId
  } else {
    const result = await api('/strategies', { method: 'POST', body: payload })
    window._editId = result.strategy.id
    toast(t('editor.created'), 'success')
    return result.strategy.id
  }
}

// Lance le sweep (point d'entrée unique, run classique = totalRuns 1). Si le
// nombre de combinaisons dépasse le seuil d'avertissement côté serveur,
// demande confirmation via sweepConfirmModal avant de relancer avec confirmLarge.
async function _launchSweepFlow(strategyId) {
  const preview = await api(`/strategies/${strategyId}/sweep/preview`)

  if (!preview.requiresConfirmation) {
    return api(`/strategies/${strategyId}/sweep`, { method: 'POST' })
  }

  return new Promise((resolve, reject) => {
    document.getElementById('sweepConfirmDesc').textContent = t('editor.sweep_confirm.desc', { n: preview.totalRuns })
    openModal('sweepConfirmModal', 'sweepConfirmCancel')
    const okBtn     = document.getElementById('sweepConfirmOk')
    const cancelBtn = document.getElementById('sweepConfirmCancel')
    const cleanup = () => { okBtn.onclick = null; cancelBtn.onclick = null }

    okBtn.onclick = async () => {
      cleanup(); closeModal('sweepConfirmModal')
      try {
        resolve(await api(`/strategies/${strategyId}/sweep`, { method: 'POST', body: { confirmLarge: true } }))
      } catch (e) { reject(e) }
    }
    cancelBtn.onclick = () => {
      cleanup(); closeModal('sweepConfirmModal')
      reject({ code: 'CANCELLED_BY_USER', _silent: true })
    }
  })
}

document.getElementById('saveBtn').addEventListener('click', async () => {
  document.getElementById('globalError').textContent = ''
  if (!validateForm()) {
    document.getElementById('globalError').textContent = t('editor.validation.fix_errors')
    return
  }
  _setSaveBtnsState(true)
  try {
    await _savePayload()
    window.removeEventListener('beforeunload', confirmLeave)
    setTimeout(() => window.location.href = '/strategies.html', 800)
  } catch (e) {
    document.getElementById('globalError').textContent = t('error.' + e.code)
    _restoreSaveBtnsLabels()
  }
})

document.getElementById('saveAndRunBtn').addEventListener('click', async () => {
  document.getElementById('globalError').textContent = ''
  if (!validateForm()) {
    document.getElementById('globalError').textContent = t('editor.validation.fix_errors')
    return
  }
  _setSaveBtnsState(true)
  let targetId
  try {
    targetId = await _savePayload()
  } catch (e) {
    document.getElementById('globalError').textContent = t('error.' + e.code)
    _restoreSaveBtnsLabels()
    return
  }
  try {
    const { sweepGroup } = await _launchSweepFlow(targetId)
    window.removeEventListener('beforeunload', confirmLeave)
    if (sweepGroup.totalRuns > 1) {
      toast(t('editor.sweep_launched', { n: sweepGroup.totalRuns }), 'success')
      setTimeout(() => window.location.href = `/sweep-results.html?id=${sweepGroup.id}`, 800)
    } else {
      toast(t('strategies.job_launched'), 'success')
      setTimeout(() => window.location.href = '/strategies.html', 800)
    }
  } catch (e) {
    if (!e._silent) toast(t('error.' + e.code, { requested: e.data?.totalRuns, limit: e.data?.limit }), 'error')
    _restoreSaveBtnsLabels()
  }
})

// Field change -> preview

;['fName', 'fStartDate', 'fEndDate', 'fCapital',
  'fPositionSize', 'fStopLoss', 'fTakeProfit', 'fAtrPeriod'].forEach(id => {
  const el = document.getElementById(id)
  if (el) { el.addEventListener('input', updatePreview); el.addEventListener('change', updatePreview) }
})
document.getElementById('fSlTrailing').addEventListener('change', updatePreview)

document.getElementById('addGroupBtn').addEventListener('click', () => {
  conditions[currentTab].push([{ indicator: 'RSI', period: INDICATOR_DEFAULT_PERIOD['RSI'], operator: '<', value: 30 }])
  renderConditions(); updatePreview()
})

bindModalKeys('sweepConfirmModal', {
  onCancel: () => document.getElementById('sweepConfirmCancel').click(),
})
document.getElementById('sweepConfirmClose').addEventListener('click', () => document.getElementById('sweepConfirmCancel').click())

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

window.updatePreview       = updatePreview
window.buildPayload        = buildPayload
window.loadStrategy        = loadStrategy
window.addTradingHourSlot  = addTradingHourSlot
window.updateAtrVisibility = updateAtrVisibility
window.goToStep            = goToStep
