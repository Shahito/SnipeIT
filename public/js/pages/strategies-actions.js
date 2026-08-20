let deleteTargetId = null

function bindCardActions() {
  bindTooltips()

  document.querySelectorAll('.launch-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = parseInt(btn.dataset.id)
      btn.disabled = true; btn.textContent = '...'
      try {
        const { sweepGroup } = await launchSweepFromCard(id)
        if (sweepGroup.totalRuns > 1) {
          toast(t('editor.sweep_launched', { n: sweepGroup.totalRuns }), 'success')
          window.location.href = `/sweep-results.html?id=${sweepGroup.id}`
          return
        }
        toast(t('strategies.job_launched'), 'success')
        loadStrategies()
      } catch (e) {
        if (!e._silent) toast(t('error.' + e.code, { requested: e.data?.totalRuns, limit: e.data?.limit }), 'error')
        btn.disabled = false; btn.innerHTML = `${ICONS.play}${t('strategies.btn.launch')}`
      }
    })
  })
  document.querySelectorAll('.clone-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      btn.disabled = true
      try {
        const { strategy } = await api(`/strategies/${btn.dataset.id}/clone`, { method: 'POST' })
        toast(t('strategies.cloned'), 'success')
        window.location.href = `/strategy-editor.html?id=${strategy.id}`
      } catch (e) { toast(t('error.' + e.code), 'error'); btn.disabled = false }
    })
  })
  document.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      deleteTargetId = parseInt(btn.dataset.id)
      openModal('deleteModal', 'deleteCancelBtn')
    })
  })
}

// Lancement (point d'entrée unique : /sweep, run classique = totalRuns 1)
async function launchSweepFromCard(strategyId) {
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
      try { resolve(await api(`/strategies/${strategyId}/sweep`, { method: 'POST', body: { confirmLarge: true } })) }
      catch (e) { reject(e) }
    }
    cancelBtn.onclick = () => {
      cleanup(); closeModal('sweepConfirmModal')
      reject({ code: 'CANCELLED_BY_USER', _silent: true })
    }
  })
}
bindModalKeys('sweepConfirmModal', {
  onCancel: () => document.getElementById('sweepConfirmCancel').click(),
})
document.getElementById('sweepConfirmClose').addEventListener('click', () => document.getElementById('sweepConfirmCancel').click())

document.getElementById('deleteModalClose').addEventListener('click', closeDeleteModal)
document.getElementById('deleteCancelBtn').addEventListener('click', closeDeleteModal)
document.getElementById('deleteConfirmBtn').addEventListener('click', async () => {
  if (!deleteTargetId) return
  try {
    await api(`/strategies/${deleteTargetId}`, { method: 'DELETE' })
    toast(t('strategies.deleted'), 'success')
    closeDeleteModal(); loadStrategies()
  } catch (e) { toast(t('error.' + e.code), 'error') }
})

bindModalKeys('deleteModal', {
  onConfirm: () => document.getElementById('deleteConfirmBtn').click(),
  onCancel: closeDeleteModal,
})

function closeDeleteModal() {
  deleteTargetId = null
  closeModal('deleteModal')
}