let currentUser = null

document.addEventListener('header:ready', (e) => {
  currentUser = e.detail.user
  renderEmailState()
})
initI18n()
document.addEventListener('i18n:ready', () => {
  // Re-render on language switch too, since the strings above are translated.
  if (currentUser) renderEmailState()
})

function setFieldInvalid(el, invalid) {
  el.classList.toggle('field-invalid', invalid)
  el.setAttribute('aria-invalid', invalid ? 'true' : 'false')
}

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
wireupPasswordToggle('emailCurrentPasswordToggle', 'emailCurrentPassword')
wireupPasswordToggle('oldPasswordToggle', 'oldPassword')
wireupPasswordToggle('newPasswordToggle', 'newPassword')
wireupPasswordToggle('newPasswordConfirmToggle', 'newPasswordConfirm')

function renderEmailState() {
  document.getElementById('currentEmailText').textContent = currentUser.email || ''

  document.getElementById('emailVerifiedBadge').classList.toggle('hidden', !currentUser.emailVerified)
  document.getElementById('emailUnverifiedBadge').classList.toggle('hidden', currentUser.emailVerified)

  const notice = document.getElementById('pendingEmailNotice')
  const failedNotice = document.getElementById('pendingEmailFailedNotice')

  if (currentUser.pendingEmail && currentUser.pendingEmailDeliveryFailed) {
    notice.classList.add('hidden')
    failedNotice.textContent = t('account.pending_email_failed').replace('{email}', currentUser.pendingEmail)
    failedNotice.classList.remove('hidden')
  } else if (currentUser.pendingEmail) {
    failedNotice.classList.add('hidden')
    notice.textContent = t('account.pending_email_notice').replace('{email}', currentUser.pendingEmail)
    notice.classList.remove('hidden')
  } else {
    notice.classList.add('hidden')
    failedNotice.classList.add('hidden')
  }
}

// Change email

document.getElementById('changeEmailBtn').addEventListener('click', async () => {
  const errorEl = document.getElementById('changeEmailError')
  errorEl.textContent = ''

  const newEmailEl = document.getElementById('newEmail')
  const passwordEl = document.getElementById('emailCurrentPassword')
  const newEmail = newEmailEl.value.trim()
  const currentPassword = passwordEl.value

  setFieldInvalid(newEmailEl, false)
  setFieldInvalid(passwordEl, false)

  if (!newEmail || !currentPassword) {
    errorEl.textContent = t('error.MISSING_FIELDS')
    if (!newEmail) setFieldInvalid(newEmailEl, true)
    if (!currentPassword) setFieldInvalid(passwordEl, true)
    return
  }

  const btn = document.getElementById('changeEmailBtn')
  btn.disabled = true
  try {
    await api('/auth/change-email', { method: 'POST', body: { currentPassword, newEmail } })
    toast(t('account.email_change_success'), 'success')
    newEmailEl.value = ''
    passwordEl.value = ''
    const { user } = await api('/auth/me')
    currentUser = user
    renderEmailState()
  } catch (err) {
    errorEl.textContent = t('error.' + err.code)
    if (err.code === 'INVALID_OLD_PASSWORD') setFieldInvalid(passwordEl, true)
    if (['EMAIL_INVALID', 'EMAIL_TAKEN', 'EMAIL_ALIAS_BLOCKED', 'EMAIL_DOMAIN_UNREACHABLE', 'EMAIL_SAME_AS_CURRENT'].includes(err.code)) {
      setFieldInvalid(newEmailEl, true)
    }
  } finally {
    btn.disabled = false
  }
})

// Change password

const newPassword = document.getElementById('newPassword')
const newPasswordConfirm = document.getElementById('newPasswordConfirm')
const newPasswordChecklist = document.getElementById('newPasswordChecklist')
const checklistItems = Array.from(document.querySelectorAll('#newPasswordChecklist .password-checklist-item'))
let checklistHideTimeout = null

function setChecklistVisible(visible) {
  newPasswordChecklist.classList.toggle('is-visible', visible)
}

function refreshPasswordChecklist() {
  const { checks } = PasswordPolicy.evaluate(newPassword.value, {
    username: currentUser ? currentUser.username : '',
    email: currentUser ? currentUser.email : '',
  })
  const byId = Object.fromEntries(checks.map(c => [c.id, c.ok]))
  const touched = newPassword.value.length > 0
  let allValid = true
  for (const item of checklistItems) {
    const ok = byId[item.dataset.rule]
    item.classList.toggle('password-checklist-item--valid', touched && ok)
    item.classList.toggle('password-checklist-item--invalid', touched && !ok)
    if (!ok) allValid = false
  }
  setFieldInvalid(newPassword, touched && !allValid)

  clearTimeout(checklistHideTimeout)
  if (allValid && newPassword.value.length > 0) {
    checklistHideTimeout = setTimeout(() => setChecklistVisible(false), 450)
  } else {
    setChecklistVisible(document.activeElement === newPassword)
  }

  return allValid
}
newPassword.addEventListener('input', refreshPasswordChecklist)
newPassword.addEventListener('focus', refreshPasswordChecklist)
newPassword.addEventListener('blur', () => setChecklistVisible(false))
newPasswordConfirm.addEventListener('input', () => {
  const mismatch = newPasswordConfirm.value.length > 0 && newPasswordConfirm.value !== newPassword.value
  setFieldInvalid(newPasswordConfirm, mismatch)
})

document.getElementById('changePasswordBtn').addEventListener('click', async () => {
  const errorEl = document.getElementById('changePasswordError')
  errorEl.textContent = ''

  const oldPasswordEl = document.getElementById('oldPassword')
  const oldPassword = oldPasswordEl.value
  setFieldInvalid(oldPasswordEl, false)

  if (!oldPassword) {
    errorEl.textContent = t('error.MISSING_FIELDS')
    setFieldInvalid(oldPasswordEl, true)
    return
  }
  if (!refreshPasswordChecklist()) {
    errorEl.textContent = t('error.PASSWORD_POLICY_UNMET')
    return
  }
  if (newPassword.value !== newPasswordConfirm.value) {
    setFieldInvalid(newPasswordConfirm, true)
    errorEl.textContent = t('error.PASSWORD_MISMATCH')
    return
  }

  const btn = document.getElementById('changePasswordBtn')
  btn.disabled = true
  try {
    await api('/auth/change-password', { method: 'POST', body: { oldPassword, newPassword: newPassword.value } })
    toast(t('account.password_change_success'), 'success')
    oldPasswordEl.value = ''
    newPassword.value = ''
    newPasswordConfirm.value = ''
    refreshPasswordChecklist()
  } catch (err) {
    errorEl.textContent = t('error.' + err.code)
    if (err.code === 'INVALID_OLD_PASSWORD') setFieldInvalid(oldPasswordEl, true)
  } finally {
    btn.disabled = false
  }
})

document.addEventListener('keydown', e => {
  if (e.key !== 'Enter') return
  const tag = document.activeElement && document.activeElement.tagName
  if (tag !== 'INPUT') return
  if (document.activeElement.closest('section').contains(document.getElementById('changeEmailBtn'))) {
    document.getElementById('changeEmailBtn').click()
  } else {
    document.getElementById('changePasswordBtn').click()
  }
})