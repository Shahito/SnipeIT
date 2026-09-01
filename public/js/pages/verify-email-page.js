function setVerifyState(state, messageKey) {
  document.getElementById('verifyStatus').dataset.state = state
  document.getElementById('verifyIconPending').toggleAttribute('hidden', state !== 'pending')
  document.getElementById('verifyIconSuccess').toggleAttribute('hidden', state !== 'success')
  document.getElementById('verifyIconError').toggleAttribute('hidden', state !== 'error')
  document.getElementById('verifyMessage').textContent = t(messageKey)
  document.getElementById('verifyBackBtn').classList.toggle('hidden', state === 'pending')
}

document.addEventListener('i18n:ready', async () => {
  setVerifyState('pending', 'verify.pending')
  const params = new URLSearchParams(location.search)
  const token = params.get('token')
  if (!token) {
    setVerifyState('error', 'error.TOKEN_INVALID')
    return
  }
  try {
    await api('/auth/verify-email', { method: 'POST', body: { token } })
    setVerifyState('success', 'verify.success')
  } catch (err) {
    setVerifyState('error', 'error.' + err.code)
  }
})
initI18n()