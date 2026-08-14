/**
 * form-validate.js
 *
 * Prévalidation dynamique du formulaire de stratégie, purement front. Ne
 * remplace pas la validation serveur (src/services/strategyService.js#validateStrategy),
 * qui reste la source de vérité : ce fichier ne fait que réduire les allers-retours
 * inutiles en signalant les champs invalides avant l'envoi.
 *
 * Depends on (must be loaded after): sweep-parse.js, strategy-form.js, i18n.js
 */

const _touchedFields = new Set()

function _debounceValidate(fn, ms) {
  let timer
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms) }
}

function _fieldGroup(el) {
  return el.closest('.form-group') || el.parentElement
}

function _setFieldError(el, msg) {
  el.classList.add('field-invalid')
  const group = _fieldGroup(el)
  let hint = group.querySelector('.field-error-msg')
  if (!hint) {
    hint = document.createElement('p')
    hint.className = 'field-error-msg'
    group.appendChild(hint)
  }
  hint.textContent = msg
}

function _clearFieldError(el) {
  el.classList.remove('field-invalid')
  const group = _fieldGroup(el)
  const hint = group.querySelector('.field-error-msg')
  if (hint) hint.remove()
}

function _asSweepArray(parsed) {
  if (parsed === null || parsed === undefined) return []
  if (typeof parsed === 'object' && Array.isArray(parsed.sweep)) return parsed.sweep
  return [parsed]
}

// Validators keyed by input id - mirror validateStrategy() server-side rules.
const FIELD_VALIDATORS = {
  fName(el) {
    const v = el.value.trim()
    if (!v || v.length < 2) return t('error.NAME_REQUIRED')
    if (v.length > 70) return t('error.NAME_TOO_LONG')
    return null
  },
  fStartDate() { return _validateDateRange() },
  fEndDate()   { return _validateDateRange() },
  fCapital(el) {
    const v = parseFloat(el.value)
    if (!el.value || isNaN(v) || v <= 0) return t('error.CAPITAL_INVALID')
    return null
  },
  fPositionSize(el) {
    if (!el.value.trim()) return t('error.POSITION_SIZE_INVALID')
    const values = _asSweepArray(parseSweepNumber(el.value))
    if (!values.length || values.some(v => isNaN(v) || v <= 0 || v > 100)) return t('error.POSITION_SIZE_INVALID')
    return null
  },
  fStopLoss(el) {
    if (!el.value.trim()) return null
    const values = _asSweepArray(parseSweepNumber(el.value))
    if (!values.length || values.some(v => isNaN(v) || v <= 0)) return t('editor.validation.value_positive')
    return null
  },
  fTakeProfit(el) {
    if (!el.value.trim()) return null
    const values = _asSweepArray(parseSweepNumber(el.value))
    if (!values.length || values.some(v => isNaN(v) || v <= 0)) return t('editor.validation.value_positive')
    return null
  },
  fAtrPeriod(el) {
    if (document.getElementById('atrPeriodGroup').style.display === 'none') return null
    if (!el.value.trim()) return t('error.ATR_PERIOD_INVALID')
    const values = _asSweepArray(parseSweepNumber(el.value, parseInt))
    if (!values.length || values.some(v => isNaN(v) || v < 1 || v > 200)) return t('error.ATR_PERIOD_INVALID')
    return null
  },
  fFeeTaker(el) { return _validateFee(el) },
  fFeeMaker(el) { return _validateFee(el) },
}

function _validateDateRange() {
  const startEl = document.getElementById('fStartDate')
  const endEl   = document.getElementById('fEndDate')
  const start = new Date(startEl.value)
  const end   = new Date(endEl.value)
  if (!startEl.value || isNaN(start.getTime())) return t('error.DATE_INVALID')
  if (!endEl.value   || isNaN(end.getTime()))   return t('error.DATE_INVALID')
  if (end <= start) return t('error.DATE_RANGE_INVALID')
  return null
}

function _validateFee(el) {
  if (!el.value.trim()) return null
  const v = parseFloat(el.value)
  if (isNaN(v) || v < 0 || v > 10) return t('error.FEE_INVALID')
  return null
}

function _runFieldValidator(id) {
  const el = document.getElementById(id)
  const fn = FIELD_VALIDATORS[id]
  if (!el || !fn) return true
  const msg = fn(el)
  if (msg) { _setFieldError(el, msg); return false }
  _clearFieldError(el)
  return true
}

function _validatePairsField() {
  const anchor = document.getElementById('fBaseCoins')
  const row = anchor.closest('.form-row')
  if (!row) return true
  if (!_currentPairs.length) {
    row.classList.add('field-invalid-row')
    return false
  }
  row.classList.remove('field-invalid-row')
  return true
}

function validateTradingHours() {
  const rows = document.querySelectorAll('#tradingHoursContainer .trading-hour-row')
  let ok = true
  rows.forEach(row => {
    const startEl = row.querySelector('.th-start')
    const endEl   = row.querySelector('.th-end')
    const invalid = !startEl.value || !endEl.value || startEl.value >= endEl.value
    startEl.classList.toggle('field-invalid', invalid)
    endEl.classList.toggle('field-invalid', invalid)
    let hint = row.querySelector('.field-error-msg')
    if (invalid) {
      if (!hint) {
        hint = document.createElement('p')
        hint.className = 'field-error-msg'
        row.appendChild(hint)
      }
      hint.textContent = t('editor.validation.trading_hours_invalid')
      ok = false
    } else if (hint) {
      hint.remove()
    }
  })
  return ok
}

function _focusAndReveal(el) {
  if (!el) return
  if (window.innerWidth <= 1100) {
    const step = el.closest('.mobile-step')
    if (step) goToStep(parseInt(step.dataset.step))
  }
  el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  if (typeof el.focus === 'function') el.focus({ preventScroll: true })
}

function validateForm() {
  let ok = true
  let firstInvalid = null

  Object.keys(FIELD_VALIDATORS).forEach(id => {
    _touchedFields.add(id)
    if (!_runFieldValidator(id)) {
      ok = false
      if (!firstInvalid) firstInvalid = document.getElementById(id)
    }
  })

  if (!_validatePairsField()) {
    ok = false
    if (!firstInvalid) firstInvalid = document.getElementById('fBaseCoins')
  }

  if (!validateTradingHours()) {
    ok = false
    if (!firstInvalid) firstInvalid = document.querySelector('#tradingHoursContainer .field-invalid')
  }

  if (!ok) _focusAndReveal(firstInvalid)
  return ok
}

function _attachLiveValidation() {
  Object.keys(FIELD_VALIDATORS).forEach(id => {
    const el = document.getElementById(id)
    if (!el) return
    const revalidate = () => { if (_touchedFields.has(id)) _runFieldValidator(id) }
    el.addEventListener('blur', () => { _touchedFields.add(id); _runFieldValidator(id) })
    el.addEventListener('input', _debounceValidate(revalidate, 300))
    el.addEventListener('change', revalidate)
  })

  document.getElementById('fSlTrailing').addEventListener('change', () => {
    _touchedFields.add('fStopLoss')
    _runFieldValidator('fStopLoss')
  })

  document.getElementById('fBaseCoins').addEventListener('change', () => {
    _pairsPreviewPromise?.then(_validatePairsField)
  })
  document.getElementById('fQuoteCoins').addEventListener('change', () => {
    _pairsPreviewPromise?.then(_validatePairsField)
  })

  const thContainer = document.getElementById('tradingHoursContainer')
  thContainer.addEventListener('input', _debounceValidate(validateTradingHours, 200))
  thContainer.addEventListener('change', validateTradingHours)
  thContainer.addEventListener('click', () => setTimeout(validateTradingHours, 0))

  // Re-check ATR period as soon as its visibility (and therefore requirement) changes.
  const _origUpdateAtrVisibility = window.updateAtrVisibility
  window.updateAtrVisibility = function () {
    _origUpdateAtrVisibility()
    if (_touchedFields.has('fAtrPeriod')) _runFieldValidator('fAtrPeriod')
  }
}

document.addEventListener('header:ready', _attachLiveValidation, { once: true })

window.validateForm         = validateForm
window.validateTradingHours = validateTradingHours