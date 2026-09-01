document.addEventListener('i18n:ready', async () => {
  document.getElementById('langBtn').textContent = t('header.lang')
  try {
    const { user } = await api('/auth/me')
    if (user) window.location.href = '/strategies.html'
  } catch (_) {}
})
initI18n()

document.getElementById('langBtn').addEventListener('click', () => {
  setLang(i18nCurrentLang() === 'fr' ? 'en' : 'fr')
})

document.getElementById('toRegister').addEventListener('click', () => {
  document.getElementById('loginSection').classList.add('hidden')
  document.getElementById('registerSection').classList.remove('hidden')
})
document.getElementById('toLogin').addEventListener('click', () => {
  document.getElementById('registerSection').classList.add('hidden')
  document.getElementById('loginSection').classList.remove('hidden')
})

// --- Password visibility toggle ---
function wireupPasswordToggle(toggleId, inputId) {
  const toggle = document.getElementById(toggleId)
  const input = document.getElementById(inputId)
  toggle.addEventListener('click', () => {
    const showing = input.type === 'text'
    input.type = showing ? 'password' : 'text'
    toggle.setAttribute('aria-pressed', String(!showing))
    toggle.dataset.i18n = showing ? 'login.show_password' : 'login.hide_password'
    toggle.setAttribute('aria-label', t(toggle.dataset.i18n))
    toggle.querySelector('.icon-eye').hidden = !showing
    toggle.querySelector('.icon-eye-off').hidden = showing
  })
}
wireupPasswordToggle('loginPasswordToggle', 'loginPassword')
wireupPasswordToggle('regPasswordToggle', 'regPassword')
wireupPasswordToggle('regPasswordConfirmToggle', 'regPasswordConfirm')

// --- Email format validation (client-side, UX only - the server re-validates) ---
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const regEmail = document.getElementById('regEmail')
const regEmailHint = document.getElementById('regEmailHint')
regEmail.addEventListener('input', () => {
  const value = regEmail.value.trim()
  const valid = value.length === 0 || EMAIL_RE.test(value)
  regEmail.setCustomValidity(valid ? '' : t('error.EMAIL_INVALID'))
  regEmailHint.textContent = valid ? '' : t('error.EMAIL_INVALID')
  regEmailHint.classList.toggle('field-hint--error', !valid)
})

document.getElementById('loginBtn').addEventListener('click', async () => {
  document.getElementById('loginError').textContent = ''
  document.getElementById('resendVerificationWrap').classList.add('hidden')
  const btn = document.getElementById('loginBtn')
  btn.disabled = true
  try {
    await api('/auth/login', { method: 'POST', body: {
      username: document.getElementById('loginUsername').value,
      password: document.getElementById('loginPassword').value,
    }})
    window.location.href = '/strategies.html'
  } catch (err) {
    document.getElementById('loginError').textContent = t('error.' + err.code)
    if (err.code === 'EMAIL_NOT_VERIFIED') {
      document.getElementById('resendVerificationWrap').classList.remove('hidden')
    }
  } finally { btn.disabled = false }
})

document.getElementById('resendVerificationLink').addEventListener('click', async (e) => {
  const link = e.currentTarget
  const username = document.getElementById('loginUsername').value
  if (!username) return
  link.textContent = t('login.resend_verification_sending')
  try {
    await api('/auth/resend-verification', { method: 'POST', body: { username } })
  } catch (_) {
    // stays silent by design - backend never leaks account state either
  } finally {
    link.textContent = t('login.resend_verification_sent')
  }
})

document.getElementById('registerBtn').addEventListener('click', async () => {
  const errorEl = document.getElementById('registerError')
  errorEl.textContent = ''
  const btn = document.getElementById('registerBtn')

  const u = document.getElementById('regUsername').value
  const email = document.getElementById('regEmail').value.trim()
  const p = document.getElementById('regPassword').value
  const pConfirm = document.getElementById('regPasswordConfirm').value

  if (!EMAIL_RE.test(email)) {
    errorEl.textContent = t('error.EMAIL_INVALID')
    return
  }
  if (p !== pConfirm) {
    errorEl.textContent = t('error.PASSWORD_MISMATCH')
    return
  }

  btn.disabled = true
  try {
    await api('/auth/register', { method: 'POST', body: { username: u, email, password: p } })
    await api('/auth/login',    { method: 'POST', body: { username: u, password: p } })
    window.location.href = '/strategies.html'
  } catch (err) {
    errorEl.textContent = t('error.' + err.code)
  } finally { btn.disabled = false }
})

document.addEventListener('keydown', e => {
  if (e.key !== 'Enter') return
  const loginVisible = !document.getElementById('loginSection').classList.contains('hidden')
  if (loginVisible) document.getElementById('loginBtn').click()
  else document.getElementById('registerBtn').click()
})