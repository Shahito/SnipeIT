/**
 * info-tip.js - reusable info icon with a hover (desktop) / tap (touch) tooltip
 *
 * Usage: copy one of these lines wherever it is needed, no JS call required.
 * Works in static HTML and in HTML injected later (innerHTML), the icon is
 * built automatically.
 *
 *   <span class="info-tip" data-info="info.metric.sharpe"></span>
 *   <span class="info-tip" data-info-text="Literal text"></span>
 *
 * data-info        i18n key, resolved with t() when the tooltip opens
 * data-info-text   literal text, used instead of the key when present
 * data-info-side   optional, "top" or "bottom" to force the side
 *
 * Requires: css/style.css (.info-tip, .info-tip-popup), js/icons.js
 * Optional: js/i18n.js (only needed for data-info keys)
 */
(function () {
  const SELECTOR = '.info-tip'
  const GAP = 8
  const MARGIN = 8

  let popup = null
  let activeEl = null
  let inputType = 'mouse'

  function getPopup() {
    if (popup) return popup
    popup = document.createElement('div')
    popup.id = 'infoTipPopup'
    popup.className = 'info-tip-popup'
    popup.setAttribute('role', 'tooltip')
    document.body.appendChild(popup)
    return popup
  }

  function resolveText(el) {
    if (el.dataset.infoText) return el.dataset.infoText
    const key = el.dataset.info
    if (!key) return ''
    return typeof t === 'function' ? t(key) : key
  }

  function place(el) {
    const rect = el.getBoundingClientRect()
    const vw = document.documentElement.clientWidth
    const w = popup.offsetWidth
    const h = popup.offsetHeight

    let side = el.dataset.infoSide
    if (side !== 'top' && side !== 'bottom') {
      side = rect.top - h - GAP >= MARGIN ? 'top' : 'bottom'
    }

    const centerX = rect.left + rect.width / 2
    const left = Math.max(MARGIN, Math.min(centerX - w / 2, vw - w - MARGIN))
    const top = side === 'top' ? rect.top - h - GAP : rect.bottom + GAP

    popup.dataset.side = side
    popup.style.left = `${Math.round(left)}px`
    popup.style.top = `${Math.round(top)}px`
    popup.style.setProperty('--arrow-x', `${Math.round(centerX - left)}px`)
  }

  function show(el) {
    const text = resolveText(el)
    if (!text) return
    getPopup().textContent = text
    place(el)
    popup.classList.add('is-open')
    el.setAttribute('aria-describedby', popup.id)
    activeEl = el
  }

  function hide() {
    if (!activeEl) return
    popup.classList.remove('is-open')
    activeEl.removeAttribute('aria-describedby')
    activeEl = null
  }

  function build(el) {
    el.dataset.ready = '1'
    el.setAttribute('role', 'button')
    el.setAttribute('tabindex', '0')
    if (!el.hasAttribute('aria-label')) el.setAttribute('aria-label', 'Info')
    if (!el.firstElementChild) {
      el.innerHTML = typeof ICONS !== 'undefined' ? ICONS.info : 'i'
    }
  }

  function upgrade(root) {
    if (root.nodeType !== 1) return
    if (root.matches(SELECTOR + ':not([data-ready])')) build(root)
    root.querySelectorAll(SELECTOR + ':not([data-ready])').forEach(build)
  }

  function closestTip(target) {
    return target instanceof Element ? target.closest(SELECTOR) : null
  }

  // Track the last input device: touch and pen use tap, mouse uses hover
  document.addEventListener('pointerdown', e => {
    inputType = e.pointerType
    if (activeEl && !closestTip(e.target)) hide()
  }, true)

  document.addEventListener('keydown', e => {
    inputType = 'key'
    if (e.key === 'Escape') hide()
  }, true)

  document.addEventListener('pointerover', e => {
    const el = closestTip(e.target)
    if (el && e.pointerType === 'mouse') show(el)
  })

  document.addEventListener('pointerout', e => {
    const el = closestTip(e.target)
    if (el && e.pointerType === 'mouse' && !el.contains(e.relatedTarget)) hide()
  })

  document.addEventListener('focusin', e => {
    const el = closestTip(e.target)
    if (el && inputType === 'key') show(el)
  })

  document.addEventListener('focusout', e => {
    if (closestTip(e.target)) hide()
  })

  // Capture phase so a tip inside a clickable parent (card, label, th)
  // never triggers the parent action
  document.addEventListener('click', e => {
    const el = closestTip(e.target)
    if (!el) return
    e.preventDefault()
    e.stopPropagation()
    if (inputType === 'mouse' || inputType === 'key') return
    if (activeEl === el) hide()
    else show(el)
  }, true)

  window.addEventListener('scroll', hide, true)
  window.addEventListener('resize', hide)

  function init() {
    upgrade(document.body)
    new MutationObserver(mutations => {
      for (const m of mutations) m.addedNodes.forEach(upgrade)
    }).observe(document.body, { childList: true, subtree: true })
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init)
  else init()
})()