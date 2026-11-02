const { register, login, changePassword, changeEmail, correctPendingEmail, logoutAll, verifyEmail, resendVerificationEmail } = require('../services/authService')
const { isProd } = require('../utils/env')

const COOKIE_OPTS = (isProd) => ({
  httpOnly: true,
  secure: isProd,
  sameSite: 'Lax',
  maxAge: 1000 * 60 * 60 * 24 * 30,
  path: '/',
})

// Registration edit token lives in an httpOnly cookie, sent only to the correction route
const EDIT_COOKIE = 'reg_edit'
const EDIT_COOKIE_OPTS = (isProd) => ({
  httpOnly: true,
  secure: isProd,
  sameSite: 'Strict',
  maxAge: 1000 * 60 * 60 * 24,
  path: '/api/auth/correct-pending-email',
})

// Known error codes - the front end translates them via i18n (error.CODE)
const KNOWN_CODES = new Set([
  'USERNAME_TAKEN',
  'USERNAME_LENGTH',
  'USERNAME_INVALID',
  'EMAIL_INVALID',
  'EMAIL_TAKEN',
  'EMAIL_ALIAS_BLOCKED',
  'EMAIL_DOMAIN_UNREACHABLE',
  'EMAIL_DELIVERY_FAILED',
  'EMAIL_SAME_AS_CURRENT',
  'PASSWORD_TOO_SHORT',
  'PASSWORD_NEEDS_LOWERCASE',
  'PASSWORD_NEEDS_UPPERCASE',
  'PASSWORD_NEEDS_DIGIT',
  'PASSWORD_NEEDS_SPECIAL',
  'PASSWORD_MISMATCH',
  'INVALID_CREDENTIALS',
  'INVALID_OLD_PASSWORD',
  'USER_NOT_FOUND',
  'MISSING_FIELDS',
  'TOKEN_INVALID',
  'TOKEN_EXPIRED',
  'EMAIL_NOT_VERIFIED',
  'TOO_MANY_REQUESTS',
  'VERIFICATION_COOLDOWN_ACTIVE',
])

function errorCode(e, fallback = 'UNKNOWN') {
  return KNOWN_CODES.has(e.message) ? e.message : fallback
}

const SUPPORTED_LANGS = new Set(['fr', 'en'])
function resolveLang(lang) {
  return SUPPORTED_LANGS.has(lang) ? lang : 'en'
}

async function registerController(req, res) {
  try {
    const { username, password, email, lang } = req.body
    if (!username || !password || !email)
      return res.status(400).json({ error: 'MISSING_FIELDS' })

    const user = await register(username, password, email, resolveLang(lang))
    res.cookie(EDIT_COOKIE, user.registrationEditToken, EDIT_COOKIE_OPTS(isProd))
    res.json({
      success: true,
      username: user.username,
      email: user.email,
    })
  } catch (e) {
    res.status(409).json({ error: errorCode(e) })
  }
}

async function loginController(req, res) {
  try {
    const { username, password } = req.body
    if (!username || !password)
      return res.status(400).json({ error: 'MISSING_FIELDS' })

    const { token } = await login(username, password)
    res.cookie('token', token, COOKIE_OPTS(isProd))
    res.json({ success: true })
  } catch (e) {
    if (e.message === 'EMAIL_NOT_VERIFIED' || e.message === 'EMAIL_DELIVERY_FAILED') {
      return res.status(403).json({ error: e.message })
    }
    await new Promise((r) => setTimeout(r, 300))
    res.status(401).json({ error: 'INVALID_CREDENTIALS' })
  }
}

async function meController(req, res) {
  res.json({ user: req.user })
}

async function changePasswordController(req, res) {
  try {
    const { oldPassword, newPassword } = req.body
    if (!oldPassword || !newPassword)
      return res.status(400).json({ error: 'MISSING_FIELDS' })

    const { token } = await changePassword(req.user.id, oldPassword, newPassword)
    res.cookie('token', token, COOKIE_OPTS(isProd))
    res.json({ success: true })
  } catch (e) {
    res.status(400).json({ error: errorCode(e) })
  }
}

async function changeEmailController(req, res) {
  try {
    const { currentPassword, newEmail } = req.body
    if (!currentPassword || !newEmail)
      return res.status(400).json({ error: 'MISSING_FIELDS' })

    await changeEmail(req.user.id, currentPassword, newEmail)
    res.json({ success: true })
  } catch (e) {
    if (e.message === 'VERIFICATION_COOLDOWN_ACTIVE') {
      return res.status(429).json({ error: e.message, retryAfter: e.retryAfter })
    }
    res.status(400).json({ error: errorCode(e) })
  }
}

async function correctPendingEmailController(req, res) {
  try {
    const { newEmail } = req.body
    if (!newEmail) return res.status(400).json({ error: 'MISSING_FIELDS' })
    const registrationEditToken = req.cookies && req.cookies[EDIT_COOKIE]
    if (!registrationEditToken) return res.status(400).json({ error: 'TOKEN_INVALID' })

    const result = await correctPendingEmail(registrationEditToken, newEmail)
    res.cookie(EDIT_COOKIE, result.registrationEditToken, EDIT_COOKIE_OPTS(isProd))
    res.json({ success: true, email: result.email })
  } catch (e) {
    if (e.message === 'VERIFICATION_COOLDOWN_ACTIVE') {
      return res.status(429).json({ error: e.message, retryAfter: e.retryAfter })
    }
    res.status(400).json({ error: errorCode(e) })
  }
}

async function verifyEmailController(req, res) {
  try {
    const { token } = req.body
    await verifyEmail(token)
    res.json({ success: true })
  } catch (e) {
    res.status(400).json({ error: errorCode(e) })
  }
}

async function resendVerificationController(req, res) {
  const { username, lang } = req.body
  if (!username) return res.status(400).json({ error: 'MISSING_FIELDS' })
  try {
    await resendVerificationEmail(username, resolveLang(lang))
  } catch (e) {
    console.error('[resendVerificationController]', e.message)
  }
  // Always respond success: never reveal whether the account exists/is verified.
  res.json({ success: true })
}

async function logoutController(req, res) {
  res.clearCookie('token', { httpOnly: true, sameSite: 'Lax', path: '/' })
  res.json({ success: true })
}

async function logoutAllController(req, res) {
  await logoutAll(req.user.id)
  res.clearCookie('token', { httpOnly: true, sameSite: 'Lax', path: '/' })
  res.json({ success: true })
}

module.exports = {
  registerController,
  loginController,
  meController,
  changePasswordController,
  changeEmailController,
  correctPendingEmailController,
  verifyEmailController,
  resendVerificationController,
  logoutController,
  logoutAllController,
}
