let deleteTargetId = null

document.addEventListener('header:ready', () => { loadKeys() })
initI18n()

function openCreateModal() {
  document.getElementById('keyName').value = ''
  document.getElementById('createKeyError').textContent = ''
  openModal('createModal', 'keyName')
}

async function loadKeys() {
  try {
    const { apiKeys } = await api('/apikeys')
    document.getElementById('loadingState').classList.add('hidden')
    if (!apiKeys.length) {
      document.getElementById('emptyState').classList.remove('hidden')
      document.getElementById('keysList').classList.add('hidden')
      return
    }
    document.getElementById('emptyState').classList.add('hidden')
    const list = document.getElementById('keysList')
    list.classList.remove('hidden')
    list.innerHTML = apiKeys.map(k => `
      <div class="apikey-item">
        <div class="apikey-info">
          <div class="apikey-name">${escHtml(k.name)}</div>
          <div class="apikey-meta">
            ${t('apikeys.item.prefix')} <code>${k.keyPrefix}…</code> ·
            ${t('apikeys.item.created')} ${fmtDate(k.createdAt)} ·
            ${k.lastUsedAt ? t('apikeys.item.last_used') + ' ' + fmtDate(k.lastUsedAt) : t('apikeys.item.never_used')}
          </div>
        </div>
        <button class="btn btn-danger btn-sm delete-key-btn" data-id="${k.id}">${ICONS.cross}${t('apikeys.item.delete_btn')}</button>
      </div>
    `).join('')

    document.querySelectorAll('.delete-key-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        deleteTargetId = parseInt(btn.dataset.id)
        openModal('deleteModal', 'deleteCancelBtn')
      })
    })
  } catch (e) { toast(t('apikeys.load_error'), 'error') }
}

document.getElementById('createKeyBtn').addEventListener('click', openCreateModal)
document.getElementById('createKeyFirstBtn').addEventListener('click', openCreateModal)

document.getElementById('createModalClose').addEventListener('click', () => closeModal('createModal'))
document.getElementById('createCancelBtn').addEventListener('click', () => closeModal('createModal'))

document.getElementById('createConfirmBtn').addEventListener('click', async () => {
  document.getElementById('createKeyError').textContent = ''
  const name = document.getElementById('keyName').value
  if (!name.trim()) { document.getElementById('createKeyError').textContent = t('apikeys.name_required'); return }
  const btn = document.getElementById('createConfirmBtn'); btn.disabled = true; btn.textContent = '...'
  try {
    const { apiKey } = await api('/apikeys', { method: 'POST', body: { name } })
    closeModal('createModal')
    document.getElementById('rawKeyText').textContent = apiKey.rawKey
    openModal('revealModal', 'revealCloseBtn')
    loadKeys()
  } catch (e) {
    document.getElementById('createKeyError').textContent = t('error.' + e.code)
  } finally { btn.disabled = false; btn.textContent = t('apikeys.modal.create') }
})
document.getElementById('keyName').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('createConfirmBtn').click()
})

document.getElementById('copyKeyBtn').addEventListener('click', () => {
  const text = document.getElementById('rawKeyText').textContent

  const fallbackCopy = (text) => {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.focus()
    textarea.select()
    try {
      document.execCommand('copy')
      toast(t('apikeys.copied'), 'success')
    } catch (err) {
      toast(t('apikeys.copy_error'), 'error')
    }
    document.body.removeChild(textarea)
  }

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text)
      .then(() => toast(t('apikeys.copied'), 'success'))
      .catch(() => fallbackCopy(text))
  } else {
    fallbackCopy(text)
  }
})

document.getElementById('revealCloseBtn').addEventListener('click', () => {
  closeModal('revealModal')
})

function closeDeleteModal() {
  deleteTargetId = null
  closeModal('deleteModal')
}

document.getElementById('deleteModalClose').addEventListener('click', closeDeleteModal)
document.getElementById('deleteCancelBtn').addEventListener('click', closeDeleteModal)
document.getElementById('deleteConfirmBtn').addEventListener('click', async () => {
  if (!deleteTargetId) return
  try {
    await api(`/apikeys/${deleteTargetId}`, { method: 'DELETE' })
    toast(t('apikeys.deleted'), 'success')
    closeDeleteModal()
    loadKeys()
  } catch (e) { toast(t('error.' + e.code), 'error') }
})

bindModalKeys('deleteModal', {
  onConfirm: () => document.getElementById('deleteConfirmBtn').click(),
  onCancel: closeDeleteModal,
})

function fmtDate(d) { return new Date(d).toLocaleDateString(i18nCurrentLang() === 'fr' ? 'fr-FR' : 'en-GB') }