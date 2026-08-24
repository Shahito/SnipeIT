/**
 * sweep-parse.js
 *
 * Convention shared across the front end for sweepable fields:
 *   - Un champ NUMÉRIQUE (positionSize, stopLoss, period, value...) accepte
 *     accepts either a single value ("14") or a comma-separated list
 *     ("14, 15, 16") -> { sweep: [14,15,16] }.
 *   - An ENUM field (pairs, timeframe, slType, tpType, source) is chosen
 *     via a chip group (.toggle-group/.toggle-btn): a single chip
 *     checked = scalar value, several checked = { sweep: [...] }.
 *
 * Exposes:
 *   window.parseSweepNumber(raw, parser?)   -> number | {sweep:[...]} | null
 *   window.formatSweepNumber(value)         -> string (for <input type=text>)
 *   window.parseSweepChoice(selectedArray)   -> string | {sweep:[...]} | null
 *   window.formatSweepChoice(value)          -> string[] (checked values)
 *   window.renderChipGroup(containerId, options[], selectedValues[])
 *   window.getChipGroupSelected(containerId) -> string[]
 *   window.bindChipGroup(containerId, onChange)
 */

function parseSweepNumber(raw, parser = parseFloat) {
  const parts = String(raw ?? '').split(',').map(s => s.trim()).filter(s => s !== '')
  const nums = parts.map(p => parser(p)).filter(n => !isNaN(n))
  if (nums.length === 0) return null
  return nums.length === 1 ? nums[0] : { sweep: nums }
}

function formatSweepNumber(value) {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object' && !Array.isArray(value) && Array.isArray(value.sweep)) return value.sweep.join(', ')
  return String(value)
}

function parseSweepChoice(selected) {
  if (!selected || selected.length === 0) return null
  return selected.length === 1 ? selected[0] : { sweep: [...selected] }
}

function formatSweepChoice(value) {
  if (value === null || value === undefined) return []
  if (typeof value === 'object' && !Array.isArray(value) && Array.isArray(value.sweep)) return value.sweep
  return [value]
}

// Chip group reusing .toggle-group/.toggle-btn (already used for
// the jobs.html filters): simple multi-select, each chip toggles
// independently (no "only one active at a time").
function renderChipGroup(containerId, options, selectedValues = []) {
  const el = document.getElementById(containerId)
  if (!el) return
  el.innerHTML = options.map(opt => {
    const value = typeof opt === 'object' ? opt.value : opt
    const label = typeof opt === 'object' ? opt.label : opt
    const active = selectedValues.includes(value)
    return `<button type="button" class="toggle-btn${active ? ' active' : ''}" data-chip-value="${value}">${label}</button>`
  }).join('')
}

function getChipGroupSelected(containerId) {
  const el = document.getElementById(containerId)
  if (!el) return []
  return Array.from(el.querySelectorAll('.toggle-btn.active')).map(b => b.dataset.chipValue)
}

function bindChipGroup(containerId, onChange) {
  const el = document.getElementById(containerId)
  if (!el) return
  el.addEventListener('click', e => {
    const btn = e.target.closest('.toggle-btn')
    if (!btn) return
    const willBeActive = !btn.classList.contains('active')
    // Prevents unchecking everything: at least one value must stay selected.
    if (!willBeActive && el.querySelectorAll('.toggle-btn.active').length <= 1) return
    btn.classList.toggle('active')
    onChange(getChipGroupSelected(containerId))
  })
}

window.parseSweepNumber     = parseSweepNumber
window.formatSweepNumber    = formatSweepNumber
window.parseSweepChoice     = parseSweepChoice
window.formatSweepChoice    = formatSweepChoice
window.renderChipGroup      = renderChipGroup
window.getChipGroupSelected = getChipGroupSelected
window.bindChipGroup        = bindChipGroup
