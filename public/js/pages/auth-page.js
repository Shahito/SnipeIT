const PENDING_STORAGE_KEY = 'snipeit_pending_registration'
// Mirrors the server's VERIFICATION_RESEND_COOLDOWN_MS (authService.js).
const RESEND_COOLDOWN_SECONDS = 60

function resendCooldownKey(username) {
  return `snipeit_resend_cooldown_${username.toLowerCase().trim()}`
}

// Puts a resend link into its countdown state, whether that's because we
// just triggered a send or because a reload caught it mid-cooldown.
function applyResendCooldown(link, username, remainingSeconds) {
  startResendCountdown(link, remainingSeconds, {
    onTick: (s) => { link.textContent = t('login.resend_verification_countdown', { seconds: s }) },
    onDone: () => { link.textContent = t('login.resend_verification') },
  })
}

// Restores any in-progress cooldown for a link after a page reload.
function restoreResendCooldown(link, username) {
  const remaining = resendCooldownRemaining(resendCooldownKey(username), RESEND_COOLDOWN_SECONDS)
  if (remaining > 0) applyResendCooldown(link, username, remaining)
}

function getPendingRegistration() {
  try {
    const raw = localStorage.getItem(PENDING_STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch (_) {
    return null
  }
}
function savePendingRegistration(data) {
  localStorage.setItem(PENDING_STORAGE_KEY, JSON.stringify(data))
}
function clearPendingRegistration() {
  localStorage.removeItem(PENDING_STORAGE_KEY)
}

let pendingRegistration = getPendingRegistration()

function renderPendingSection() {
  document.getElementById('pendingCheckInboxText').textContent =
    t('login.pending_check_inbox', { email: pendingRegistration.email })
  document.getElementById('pendingChangeForm').classList.add('hidden')
  document.getElementById('pendingNewEmail').value = ''
  document.getElementById('pendingCorrectionError').textContent = ''
  restoreResendCooldown(document.getElementById('pendingResendLink'), pendingRegistration.username)
}

document.addEventListener('i18n:ready', async () => {
  document.getElementById('langBtn').textContent = t('header.lang')
  if (pendingRegistration) renderPendingSection()
})
initI18n()

document.getElementById('langBtn').addEventListener('click', () => {
  setLang(i18nCurrentLang() === 'fr' ? 'en' : 'fr')
})

function showAuthForm(form, updateUrl = true) {
  const isRegister = form === 'register'
  const isPending = form === 'pending'

  document.getElementById('loginSection').classList.toggle('hidden', isRegister || isPending)
  document.getElementById('registerSection').classList.toggle('hidden', !isRegister)
  document.getElementById('pendingSection').classList.toggle('hidden', !isPending)

  if (updateUrl && !isPending) {
    window.location.hash = isRegister ? 'register' : 'login'
  }
}

function getAuthFormFromHash() {
  return window.location.hash.slice(1).toLowerCase() === 'register'
    ? 'register'
    : 'login'
}

// Restore the form from the URL on page load - unless a registration is
// still pending confirmation (persists across reloads/tab closes), in which
// case that always takes priority over the login/register hash.
if (pendingRegistration) {
  showAuthForm('pending', false)
} else {
  showAuthForm(getAuthFormFromHash(), false)
}

document.getElementById('toRegister').addEventListener('click', () => {
  showAuthForm('register')
})
document.getElementById('toRegister').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return
  e.preventDefault()
  showAuthForm('register')
})

document.getElementById('toLogin').addEventListener('click', () => {
  showAuthForm('login')
})
document.getElementById('toLogin').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return
  e.preventDefault()
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

function setFieldInvalid(el, invalid) {
  el.classList.toggle('field-invalid', invalid)
  el.setAttribute('aria-invalid', invalid ? 'true' : 'false')
}

const loginUsername = document.getElementById('loginUsername')
const loginPassword = document.getElementById('loginPassword')
loginUsername.addEventListener('input', () => setFieldInvalid(loginUsername, false))
loginPassword.addEventListener('input', () => setFieldInvalid(loginPassword, false))

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
  setFieldInvalid(regEmail, value.length > 0 && !valid)
  refreshPasswordChecklist()
})

const regUsername = document.getElementById('regUsername')
const regPassword = document.getElementById('regPassword')
const regPasswordConfirm = document.getElementById('regPasswordConfirm')
regUsername.addEventListener('input', () => setFieldInvalid(regUsername, false))
regPasswordConfirm.addEventListener('input', () => {
  const mismatch = regPasswordConfirm.value.length > 0 && regPasswordConfirm.value !== regPassword.value
  setFieldInvalid(regPasswordConfirm, mismatch)
})
const regPasswordChecklist = document.getElementById('regPasswordChecklist')
const checklistItems = Array.from(document.querySelectorAll('#regPasswordChecklist .password-checklist-item'))
let checklistHideTimeout = null

function setChecklistVisible(visible) {
  regPasswordChecklist.classList.toggle('is-visible', visible)
}

function refreshPasswordChecklist() {
  const { checks } = PasswordPolicy.evaluate(regPassword.value, {
    username: regUsername.value,
    email: regEmail.value,
  })
  const byId = Object.fromEntries(checks.map(c => [c.id, c.ok]))
  const touched = regPassword.value.length > 0
  let allValid = true
  for (const item of checklistItems) {
    const ok = byId[item.dataset.rule]
    item.classList.toggle('password-checklist-item--valid', touched && ok)
    item.classList.toggle('password-checklist-item--invalid', touched && !ok)
    if (!ok) allValid = false
  }
  setFieldInvalid(regPassword, touched && !allValid)

  clearTimeout(checklistHideTimeout)
  if (allValid && regPassword.value.length > 0) {
    checklistHideTimeout = setTimeout(() => setChecklistVisible(false), 450)
  } else {
    setChecklistVisible(document.activeElement === regPassword)
  }

  return allValid
}
regPassword.addEventListener('input', refreshPasswordChecklist)
regPassword.addEventListener('focus', refreshPasswordChecklist)
regPassword.addEventListener('blur', () => setChecklistVisible(false))
regUsername.addEventListener('input', refreshPasswordChecklist)
refreshPasswordChecklist()

document.getElementById('loginBtn').addEventListener('click', async () => {
  document.getElementById('loginError').textContent = ''
  document.getElementById('resendVerificationWrap').classList.add('hidden')
  const btn = document.getElementById('loginBtn')

  const emptyUsername = loginUsername.value.trim().length === 0
  const emptyPassword = loginPassword.value.length === 0
  setFieldInvalid(loginUsername, emptyUsername)
  setFieldInvalid(loginPassword, emptyPassword)
  if (emptyUsername || emptyPassword) {
    document.getElementById('loginError').textContent = t('error.MISSING_FIELDS')
    return
  }

  btn.disabled = true
  btn.classList.add('is-loading')
  btn.setAttribute('aria-busy', 'true')
  try {
    await api('/auth/login', {
      method: 'POST', body: {
        username: loginUsername.value,
        password: loginPassword.value,
      }
    })
    window.location.href = '/strategies.html'
  } catch (err) {
    document.getElementById('loginError').textContent = t('error.' + err.code)
    if (err.code === 'INVALID_CREDENTIALS') {
      setFieldInvalid(loginUsername, true)
      setFieldInvalid(loginPassword, true)
    }
    if (err.code === 'EMAIL_NOT_VERIFIED' || err.code === 'EMAIL_DELIVERY_FAILED') {
      document.getElementById('resendVerificationWrap').classList.remove('hidden')
    }
  } finally {
    btn.disabled = false
    btn.classList.remove('is-loading')
    btn.removeAttribute('aria-busy')
  }
})

document.getElementById('resendVerificationLink').addEventListener('click', async (e) => {
  const link = e.currentTarget
  if (link.classList.contains('is-cooldown')) return
  const username = document.getElementById('loginUsername').value
  if (!username) return
  link.textContent = t('login.resend_verification_sending')
  try {
    await api('/auth/resend-verification', { method: 'POST', body: { username, lang: window.i18nCurrentLang() } })
  } catch (_) {
    // stays silent by design - backend never leaks account state either
  } finally {
    markResendSent(resendCooldownKey(username))
    link.textContent = t('login.resend_verification_sent')
    setTimeout(() => applyResendCooldown(link, username, RESEND_COOLDOWN_SECONDS), 1500)
  }
})

document.getElementById('registerBtn').addEventListener('click', async () => {
  const errorEl = document.getElementById('registerError')
  errorEl.textContent = ''
  const btn = document.getElementById('registerBtn')

  const u = regUsername.value.trim()
  const email = regEmail.value.trim()
  const p = regPassword.value
  const pConfirm = regPasswordConfirm.value

  setFieldInvalid(regUsername, u.length === 0)
  if (u.length === 0) {
    errorEl.textContent = t('error.MISSING_FIELDS')
    return
  }

  if (!EMAIL_RE.test(email)) {
    setFieldInvalid(regEmail, true)
    errorEl.textContent = t('error.EMAIL_INVALID')
    return
  }
  if (!refreshPasswordChecklist()) {
    setFieldInvalid(regPassword, true)
    errorEl.textContent = t('error.PASSWORD_POLICY_UNMET')
    return
  }
  setFieldInvalid(regPasswordConfirm, p !== pConfirm)
  if (p !== pConfirm) {
    errorEl.textContent = t('error.PASSWORD_MISMATCH')
    return
  }

  btn.disabled = true
  btn.classList.add('is-loading')
  btn.setAttribute('aria-busy', 'true')
  try {
    const res = await api('/auth/register', { method: 'POST', body: { username: u, email, password: p, lang: window.i18nCurrentLang() } })
    pendingRegistration = {
      registrationEditToken: res.registrationEditToken,
      username: res.username,
      email: res.email,
    }
    savePendingRegistration(pendingRegistration)
    showAuthForm('pending', false)
    renderPendingSection()
  } catch (err) {
    errorEl.textContent = t('error.' + err.code)
    if (err.code === 'USERNAME_TAKEN' || err.code === 'USERNAME_LENGTH' || err.code === 'USERNAME_INVALID') {
      setFieldInvalid(regUsername, true)
    }
    if (err.code === 'EMAIL_TAKEN' || err.code === 'EMAIL_ALIAS_BLOCKED' || err.code === 'EMAIL_DOMAIN_UNREACHABLE') {
      setFieldInvalid(regEmail, true)
    }
  } finally {
    btn.disabled = false
    btn.classList.remove('is-loading')
    btn.removeAttribute('aria-busy')
  }
})

document.getElementById('pendingWrongEmailLink').addEventListener('click', () => {
  const form = document.getElementById('pendingChangeForm')
  const willShow = form.classList.contains('hidden')
  form.classList.toggle('hidden', !willShow)
  if (willShow) {
    const input = document.getElementById('pendingNewEmail')
    input.value = pendingRegistration.email
    input.focus()
    input.select()
  }
})

document.getElementById('pendingCorrectBtn').addEventListener('click', async () => {
  const errorEl = document.getElementById('pendingCorrectionError')
  errorEl.textContent = ''
  const input = document.getElementById('pendingNewEmail')
  const newEmail = input.value.trim()

  if (!EMAIL_RE.test(newEmail)) {
    errorEl.textContent = t('error.EMAIL_INVALID')
    return
  }

  const btn = document.getElementById('pendingCorrectBtn')
  btn.disabled = true
  btn.classList.add('is-loading')
  btn.setAttribute('aria-busy', 'true')
  try {
    const res = await api('/auth/correct-pending-email', {
      method: 'POST',
      body: { registrationEditToken: pendingRegistration.registrationEditToken, newEmail },
    })
    pendingRegistration = {
      ...pendingRegistration,
      email: res.email,
      registrationEditToken: res.registrationEditToken,
    }
    savePendingRegistration(pendingRegistration)
    renderPendingSection()
  } catch (err) {
    errorEl.textContent = t('error.' + err.code)
    if (err.code === 'TOKEN_INVALID' || err.code === 'TOKEN_EXPIRED') {
      // The pending registration is no longer valid server-side (e.g. it
      // expired) - there's nothing left to correct, start fresh.
      clearPendingRegistration()
      pendingRegistration = null
      showAuthForm('register', true)
    }
  } finally {
    btn.disabled = false
    btn.classList.remove('is-loading')
    btn.removeAttribute('aria-busy')
  }
})

document.getElementById('pendingResendLink').addEventListener('click', async (e) => {
  const link = e.currentTarget
  if (link.classList.contains('is-cooldown')) return
  if (!pendingRegistration) return
  const username = pendingRegistration.username
  link.textContent = t('login.resend_verification_sending')
  try {
    await api('/auth/resend-verification', { method: 'POST', body: { username, lang: window.i18nCurrentLang() } })
  } catch (_) {
    // stays silent by design - backend never leaks account state either
  } finally {
    markResendSent(resendCooldownKey(username))
    link.textContent = t('login.resend_verification_sent')
    setTimeout(() => applyResendCooldown(link, username, RESEND_COOLDOWN_SECONDS), 1500)
  }
})

document.getElementById('pendingStartOverLink').addEventListener('click', () => {
  clearPendingRegistration()
  pendingRegistration = null
  showAuthForm('login', true)
})

document.getElementById('pendingAlreadyVerifiedLink').addEventListener('click', () => {
  clearPendingRegistration()
  pendingRegistration = null
  showAuthForm('login', true)
})

// If the email got verified from ANOTHER tab of this same browser (e.g. the
// confirmation link opened in a new tab), that tab clears the shared
// localStorage key on success
window.addEventListener('storage', (e) => {
  if (e.key === PENDING_STORAGE_KEY && !e.newValue) {
    pendingRegistration = null
    showAuthForm('login', true)
  }
})

document.addEventListener('keydown', e => {
  if (e.key !== 'Enter') return
  const pendingVisible = !document.getElementById('pendingSection').classList.contains('hidden')
  if (pendingVisible) {
    if (!document.getElementById('pendingChangeForm').classList.contains('hidden')) {
      document.getElementById('pendingCorrectBtn').click()
    }
    return
  }
  const loginVisible = !document.getElementById('loginSection').classList.contains('hidden')
  if (loginVisible) document.getElementById('loginBtn').click()
  else document.getElementById('registerBtn').click()
})
