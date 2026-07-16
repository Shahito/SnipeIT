// Usage : toast('Message', 'success' | 'error' | 'info')
function toast(message, type = 'info', duration = 3500) {
  const container = document.getElementById('toastContainer')
  if (!container) return

  const el = document.createElement('div')
  el.className = `toast toast-${type}`
  el.textContent = message
  container.appendChild(el)

  setTimeout(() => {
    el.style.opacity = '0'
    el.style.transition = 'opacity .2s'
    setTimeout(() => el.remove(), 200)
  }, duration)
}

window.toast = toast
