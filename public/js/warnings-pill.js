/**
 * warnings-pill.js - small status pill + overlay listing a run's engine warnings
 *
 * Usage: renderWarningsPill(result.warnings) once the result is loaded.
 * Nothing is shown when the list is empty, and the call can be repeated.
 *
 * Each warning: { level: 'info' | 'warning' | 'important', code, params, message }
 * The text comes from the i18n key "warning.code.<code>" (filled with params),
 * or from the English "message" sent by the engine when that key is missing.
 * Legacy plain strings are shown as level "warning".
 *
 * Requires: i18n.js, icons.js, overlay-a11y.js, css/style.css (.warn-*),
 * and an element with id "resultsMeta" to anchor the pill after.
 */
(function () {
  const LEVELS = ['important', 'warning', 'info'] // highest first
  const TAG_CLASS = { important: 'tag-danger', warning: 'tag-warning', info: 'tag-primary' }
  const MODAL_ID = 'warningsModal'

  function normalize(raw) {
    if (!Array.isArray(raw)) return []
    return raw
      .map(w => typeof w === 'string' ? { level: 'warning', message: w } : w)
      .filter(w => w && typeof w === 'object')
      .map(w => ({ ...w, level: LEVELS.includes(w.level) ? w.level : 'warning' }))
      .sort((a, b) => LEVELS.indexOf(a.level) - LEVELS.indexOf(b.level))
  }

  function warningText(w) {
    if (w.code) {
      const key = 'warning.code.' + w.code
      const text = t(key, w.params || {})
      if (text !== key) return text
    }
    return w.message || ''
  }

  function closeOverlay() { closeModal(MODAL_ID) }

  function ensureOverlay() {
    if (document.getElementById(MODAL_ID)) return
    const el = document.createElement('div')
    el.id = MODAL_ID
    el.className = 'modal-overlay hidden'
    el.innerHTML = `
      <div class="modal warn-modal">
        <div class="modal-header">
          <span class="modal-title">${ICONS.warning}${t('warning.title')}</span>
          <button class="modal-close" id="warnCloseBtn" aria-label="${t('warning.close')}">${ICONS.cross}</button>
        </div>
        <ul class="warn-list" id="warnList"></ul>
      </div>
    `
    document.body.appendChild(el)
    document.getElementById('warnCloseBtn').addEventListener('click', closeOverlay)
    bindModalKeys(MODAL_ID, { onCancel: closeOverlay })
  }

  function openOverlay(list) {
    ensureOverlay()
    const ul = document.getElementById('warnList')
    ul.replaceChildren(...list.map(w => {
      const li = document.createElement('li')
      li.className = 'warn-item warn-' + w.level
      const level = document.createElement('span')
      level.className = 'warn-level'
      level.textContent = t('warning.level.' + w.level)
      const text = document.createElement('span')
      text.className = 'warn-text'
      text.textContent = warningText(w)
      li.append(level, text)
      return li
    }))
    openModal(MODAL_ID, 'warnCloseBtn')
  }

  function renderWarningsPill(raw) {
    document.getElementById('warningsPill')?.remove()
    const list = normalize(raw)
    if (!list.length) return
    const pill = document.createElement('button')
    pill.id = 'warningsPill'
    pill.type = 'button'
    pill.className = 'tag warn-pill ' + TAG_CLASS[list[0].level]
    pill.setAttribute('aria-label', t('warning.pill_aria', { count: list.length }))
    pill.innerHTML = `${ICONS.warning}<span>${list.length}</span>`
    pill.addEventListener('click', () => openOverlay(list))
    document.getElementById('resultsMeta').after(pill)
  }

  window.renderWarningsPill = renderWarningsPill
})()