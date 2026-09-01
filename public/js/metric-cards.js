function scrollToMetricTarget(target) {
  const block = target.offsetHeight > window.innerHeight * 0.75 ? 'start' : 'center'

  const applyPulse = () => {
    target.classList.remove('metric-card--highlight')
    void target.offsetWidth
    target.classList.add('metric-card--highlight')
    target.addEventListener('animationend', () => {
      target.classList.remove('metric-card--highlight')
    }, { once: true })
  }

  if ('onscrollend' in window) {
    document.addEventListener('scrollend', applyPulse, { once: true })
    target.scrollIntoView({ behavior: 'smooth', block })
  } else {
    target.scrollIntoView({ behavior: 'smooth', block })
    let lastY = window.scrollY, stable = 0
    const check = () => {
      if (window.scrollY === lastY) {
        if (++stable >= 3) return applyPulse()
      } else { stable = 0; lastY = window.scrollY }
      requestAnimationFrame(check)
    }
    requestAnimationFrame(check)
  }
}

/**
 * Wires click delegation on a metrics grid, using a { metricKey: targetCardId } map.
 * Call once per grid, after the grid exists in the DOM.
 */
function initMetricCardInteractivity(gridId, targetMap) {
  const grid = document.getElementById(gridId)
  if (!grid) return
  grid.addEventListener('click', e => {
    const card = e.target.closest('.metric-card-interactive')
    if (!card) return
    const targetId = targetMap[card.dataset.metric]
    if (!targetId) return
    const target = document.getElementById(targetId)
    if (!target) return
    scrollToMetricTarget(target)
  })
}

/** Builds the interactive class/attrs string for a metric card given its key. */
function metricCardInteractiveAttrs(key, targetMap) {
  const isInteractive = key in targetMap
  return {
    cls: isInteractive ? ' metric-card-interactive' : '',
    attrs: isInteractive ? `data-metric="${key}" tabindex="0" role="button"` : '',
  }
}