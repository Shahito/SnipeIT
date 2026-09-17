// Usage : toast('Message', 'success' | 'error' | 'info')
// Usage w/ action: toast('Message', 'info', { duration: 6000, action: { label: 'Undo', onClick: fn } })
function toast(message, type = 'info', opts = {}) {
  const { duration = 3500, action = null } = opts
  const container = document.getElementById('toastContainer')
  if (!container) return

  const el = document.createElement('div')
  el.className = `toast toast-${type}`

  const textEl = document.createElement('span')
  textEl.className = 'toast-text'
  textEl.textContent = message
  el.appendChild(textEl)

  let dismissed = false
  const dismiss = () => {
    if (dismissed) return
    dismissed = true
    el.style.opacity = '0'
    el.style.transition = 'opacity .2s'
    setTimeout(() => el.remove(), 200)
  }

  if (action) {
    const actionBtn = document.createElement('button')
    actionBtn.type = 'button'
    actionBtn.className = 'toast-action'
    actionBtn.textContent = action.label
    actionBtn.addEventListener('click', () => {
      dismiss()
      action.onClick()
    })
    el.appendChild(actionBtn)
  }

  // Auto-dismiss, paused while hovered so a toast with an action (like
  // Undo) doesn't vanish out from under the cursor while reading/aiming.
  let timer = null
  let remaining = duration
  let startedAt = Date.now()

  function startTimer() {
    startedAt = Date.now()
    timer = setTimeout(dismiss, remaining)
  }
  function pauseTimer() {
    clearTimeout(timer)
    remaining -= Date.now() - startedAt
  }

  el.addEventListener('mouseenter', pauseTimer)
  el.addEventListener('mouseleave', startTimer)

  container.appendChild(el)
  startTimer()
  return { dismiss }
}

window.toast = toast
