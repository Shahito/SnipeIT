function escHtml(s) {
  const d = document.createElement('div')
  d.textContent = s
  return d.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function escAttr(s) {
  return s.replace(/"/g, '&quot;')
}

function fmtDuration(ms) {
  if (!ms || ms < 0) return null
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}min ${s % 60}s`
  const h = Math.floor(m / 60)
return `${h}h ${m % 60}min`
}

// Runs a visible per-second countdown on a clickable element (link, button):
// disables it, calls onTick(remainingSeconds) every second, and restores it
// via onDone() once it hits zero. Returns a stop() you can call to cancel
// early (e.g. if the element gets removed from the DOM).
function startResendCountdown(el, seconds, { onTick, onDone } = {}) {
  let remaining = Math.max(0, Math.ceil(seconds))
  let timer = null
  el.classList.add('is-cooldown')
  el.setAttribute('aria-disabled', 'true')

  function tick() {
    if (remaining <= 0) {
      el.classList.remove('is-cooldown')
      el.removeAttribute('aria-disabled')
      if (onDone) onDone()
      return
    }
    if (onTick) onTick(remaining)
    remaining -= 1
    timer = setTimeout(tick, 1000)
  }
  tick()

  return function stop() {
    clearTimeout(timer)
    el.classList.remove('is-cooldown')
    el.removeAttribute('aria-disabled')
  }
}

// localStorage-backed helper so a resend cooldown survives a page reload
function resendCooldownRemaining(key, cooldownSeconds) {
  const last = Number(localStorage.getItem(key) || 0)
  if (!last) return 0
  const elapsedS = (Date.now() - last) / 1000
  const remaining = cooldownSeconds - elapsedS
  return remaining > 0 ? Math.ceil(remaining) : 0
}

function markResendSent(key) {
  localStorage.setItem(key, String(Date.now()))
}