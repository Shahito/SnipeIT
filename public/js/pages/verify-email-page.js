document.addEventListener('i18n:ready', async () => {
  const params = new URLSearchParams(location.search)
  const token = params.get('token')
  const msgEl = document.getElementById('verifyMessage')
  if (!token) {
    msgEl.textContent = t('error.TOKEN_INVALID')
    return
  }
  try {
    await api('/auth/verify-email', { method: 'POST', body: { token } })
    msgEl.textContent = t('verify.success')
  } catch (err) {
    msgEl.textContent = t('error.' + err.code)
  }
})
initI18n()