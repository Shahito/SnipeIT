document.addEventListener('i18n:ready', async () => {
  document.getElementById('langBtn').textContent = t('header.lang')
  try {
    const { user } = await api('/auth/me')
    if (user) window.location.href = '/strategies.html'
  } catch (_) { }
})
initI18n()

document.getElementById('langBtn').addEventListener('click', () => {
  setLang(i18nCurrentLang() === 'fr' ? 'en' : 'fr')
})

function showAuthForm(form, updateUrl = true) {
  const isRegister = form === 'register'

  document.getElementById('loginSection').classList.toggle('hidden', isRegister)
  document.getElementById('registerSection').classList.toggle('hidden', !isRegister)

  if (updateUrl) {
    window.location.hash = isRegister ? 'register' : 'login'
  }
}

function getAuthFormFromHash() {
  return window.location.hash.slice(1).toLowerCase() === 'register'
    ? 'register'
    : 'login'
}

// Restore the form from the URL on page load.
showAuthForm(getAuthFormFromHash(), false)

document.getElementById('toRegister').addEventListener('click', () => {
  showAuthForm('register')
})

document.getElementById('toLogin').addEventListener('click', () => {
  showAuthForm('login')
})

// Handle browser back/forward navigation.
window.addEventListener('hashchange', () => {
  showAuthForm(getAuthFormFromHash(), false)
})

// Password visibility toggle
function wireupPasswordToggle(toggleId, inputId) {
  const toggle = document.getElementById(toggleId)
  const input = document.getElementById(inputId)
  toggle.addEventListener('click', () => {
    const showing = input.type === 'text'
    input.type = showing ? 'password' : 'text'
    toggle.setAttribute('aria-pressed', String(!showing))
    toggle.dataset.i18n = showing ? 'login.show_password' : 'login.hide_password'
    toggle.setAttribute('aria-label', t(toggle.dataset.i18n))
    toggle.querySelector('.icon-eye').toggleAttribute('hidden', !showing)
    toggle.querySelector('.icon-eye-off').toggleAttribute('hidden', showing)
  })
}
wireupPasswordToggle('loginPasswordToggle', 'loginPassword')
wireupPasswordToggle('regPasswordToggle', 'regPassword')
wireupPasswordToggle('regPasswordConfirmToggle', 'regPasswordConfirm')

// Email format validation (client-side, UX only - the server re-validates)
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const regEmail = document.getElementById('regEmail')
const regEmailHint = document.getElementById('regEmailHint')
regEmail.addEventListener('input', () => {
  const value = regEmail.value.trim()
  const valid = value.length === 0 || EMAIL_RE.test(value)
  regEmail.setCustomValidity(valid ? '' : t('error.EMAIL_INVALID'))
  regEmailHint.textContent = valid ? '' : t('error.EMAIL_INVALID')
  regEmailHint.classList.toggle('field-hint--error', !valid)
  regEmailHint.classList.toggle('hidden', valid)
  refreshPasswordChecklist()
})

const regUsername = document.getElementById('regUsername')
const regPassword = document.getElementById('regPassword')
const checklistItems = Array.from(document.querySelectorAll('#regPasswordChecklist .password-checklist__item'))

function refreshPasswordChecklist() {
  const { checks } = PasswordPolicy.evaluate(regPassword.value, {
    username: regUsername.value,
    email: regEmail.value,
  })
  const byId = Object.fromEntries(checks.map(c => [c.id, c.ok]))
  let allValid = true
  for (const item of checklistItems) {
    const ok = byId[item.dataset.rule]
    const touched = regPassword.value.length > 0
    item.classList.toggle('password-checklist__item--valid', touched && ok)
    item.classList.toggle('password-checklist__item--invalid', touched && !ok)
    if (!ok) allValid = false
  }
  return allValid
}
regPassword.addEventListener('input', refreshPasswordChecklist)
regUsername.addEventListener('input', refreshPasswordChecklist)
refreshPasswordChecklist()

document.getElementById('loginBtn').addEventListener('click', async () => {
  document.getElementById('loginError').textContent = ''
  document.getElementById('resendVerificationWrap').classList.add('hidden')
  const btn = document.getElementById('loginBtn')
  btn.disabled = true
  try {
    await api('/auth/login', {
      method: 'POST', body: {
        username: document.getElementById('loginUsername').value,
        password: document.getElementById('loginPassword').value,
      }
    })
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
  if (!refreshPasswordChecklist()) {
    errorEl.textContent = t('error.PASSWORD_POLICY_UNMET')
    return
  }
  if (p !== pConfirm) {
    errorEl.textContent = t('error.PASSWORD_MISMATCH')
    return
  }

  btn.disabled = true
  try {
    await api('/auth/register', { method: 'POST', body: { username: u, email, password: p } })
    await api('/auth/login', { method: 'POST', body: { username: u, password: p } })
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
