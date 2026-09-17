// Keeps the "Deleted items" entry point in sync: hidden when there's nothing
// recoverable, showing a live count otherwise. Piggybacks on the same
// header:ready hook and 5s refresh cadence as strategies-list.js.
document.addEventListener('header:ready', async () => {
  await loadTrash()
  setInterval(loadTrash, 5000)
})

// Mirrors STRATEGY_TRASH_GRACE_MS in strategyService.js - only used here to
// show a countdown; the server is what actually enforces the grace period.
const STRATEGY_TRASH_GRACE_MS = 24 * 60 * 60 * 1000

let _lastTrashHash = null

async function loadTrash() {
  try {
    const { strategies } = await api('/strategies/deleted')
    const btn = document.getElementById('trashBtn')
    btn.classList.toggle('hidden', strategies.length === 0)
    btn.querySelector('span').textContent = t('strategies.trash.btn', { n: strategies.length })

    const hash = JSON.stringify(strategies)
    if (hash === _lastTrashHash) return // no change, skip DOM rebuild
    _lastTrashHash = hash
    renderTrashList(strategies)
  } catch (e) {
    // Silent - this is a secondary panel, not worth interrupting the page
    // over (the main strategies list already surfaces load errors).
  }
}

function renderTrashList(strategies) {
  const list = document.getElementById('trashList')
  if (!list) return

  if (strategies.length === 0) {
    list.innerHTML = `<p class="text-muted text-sm">${t('common.nothing_to_display')}</p>`
    return
  }

  list.innerHTML = strategies.map(s => {
    const msLeft = new Date(s.deletedAt).getTime() + STRATEGY_TRASH_GRACE_MS - Date.now()
    const hoursLeft = Math.floor(msLeft / (60 * 60 * 1000))
    const timeLabel = hoursLeft >= 1
      ? t('strategies.trash.time_left', { time: `${hoursLeft}h` })
      : t('strategies.trash.expiring')
    return `
      <div class="tag-manage-row" data-id="${s.id}">
        <span>${escHtml(s.name)}</span>
        <div class="tag-manage-actions">
          <span class="text-muted text-sm">${timeLabel}</span>
          <button class="btn btn-ghost btn-sm restore-btn" data-id="${s.id}">${ICONS.replay}<span>${t('strategies.trash.restore')}</span></button>
        </div>
      </div>`
  }).join('')

  list.querySelectorAll('.restore-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = parseInt(btn.dataset.id)
      btn.disabled = true
      try {
        await api(`/strategies/${id}/restore`, { method: 'POST' })
        toast(t('strategies.restored'), 'success')
        _lastTrashHash = null // force a re-render even if the count coincidentally matches
        await loadTrash()
        loadStrategies()
      } catch (e) {
        toast(t('error.' + e.code), 'error')
        btn.disabled = false
      }
    })
  })
}

document.getElementById('trashBtn').addEventListener('click', () => {
  renderTrashList(JSON.parse(_lastTrashHash || '[]'))
  openModal('trashModal', 'trashModalClose')
})
document.getElementById('trashModalClose').addEventListener('click', () => closeModal('trashModal'))
bindModalKeys('trashModal', { onCancel: () => closeModal('trashModal') })