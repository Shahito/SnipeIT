const { register, login, changePassword, logoutAll } = require('../services/authService')
const { isProd } = require('../utils/env')

const COOKIE_OPTS = (isProd) => ({
  httpOnly: true,
  secure: isProd,
  sameSite: 'Lax',
  maxAge: 1000 * 60 * 60 * 24 * 30,
  path: '/',
})

// Known error codes - the front end translates them via i18n (error.CODE)
const KNOWN_CODES = new Set([
  'USERNAME_TAKEN',
  'USERNAME_LENGTH',
  'USERNAME_INVALID',
  'PASSWORD_TOO_SHORT',
  'INVALID_CREDENTIALS',
  'INVALID_OLD_PASSWORD',
  'USER_NOT_FOUND',
  'MISSING_FIELDS',
])

function errorCode(e, fallback = 'UNKNOWN') {
  return KNOWN_CODES.has(e.message) ? e.message : fallback
}

async function registerController(req, res) {
  try {
    const { username, password } = req.body
    if (!username || !password)
      return res.status(400).json({ error: 'MISSING_FIELDS' })

    await register(username, password)
    res.json({ success: true })
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

    await changePassword(req.user.id, oldPassword, newPassword)
    res.json({ success: true })
  } catch (e) {
    res.status(400).json({ error: errorCode(e) })
  }
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
  logoutController,
  logoutAllController,
}
