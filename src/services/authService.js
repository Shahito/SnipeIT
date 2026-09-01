const crypto = require('crypto')
const prisma = require('../utils/prisma')
const bcrypt = require('bcrypt')
const { signToken } = require('../utils/jwt')
const { sendVerificationEmail } = require('../utils/mailer')

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const VERIFICATION_TTL_MS = 1000 * 60 * 60 * 24 // 24h

function normalizeEmail(email) {
  return email.trim().toLowerCase()
}

function generateVerificationToken() {
  return crypto.randomBytes(32).toString('hex')
}

async function register(displayUsername, password, email) {
  const normalized = displayUsername.toLowerCase().trim()
  const normalizedEmail = normalizeEmail(email || '')

  if (normalized.length < 3 || normalized.length > 24) {
    throw new Error('USERNAME_LENGTH') // 3-24 characters
  }
  if (!/^[a-z0-9_.-]+$/.test(normalized)) {
    throw new Error('USERNAME_INVALID') // no special characters
  }
  if (!normalizedEmail || !EMAIL_RE.test(normalizedEmail)) {
    throw new Error('EMAIL_INVALID')
  }
  if (password.length < 8) {
    throw new Error('PASSWORD_TOO_SHORT') // min 8 characters
  }

  const [usernameTaken, emailTaken] = await Promise.all([
    prisma.user.findUnique({ where: { username: normalized } }),
    prisma.user.findUnique({ where: { email: normalizedEmail } }),
  ])
  if (usernameTaken) throw new Error('USERNAME_TAKEN')
  if (emailTaken) throw new Error('EMAIL_TAKEN')

  const hash = await bcrypt.hash(password, 12) // 12 rounds, safer than 10
  const verificationToken = generateVerificationToken()

  const user = await prisma.user.create({
    data: {
      username: normalized,
      displayUsername: displayUsername.trim(),
      password: hash,
      email: normalizedEmail,
      emailVerified: false,
      emailVerificationToken: verificationToken,
      emailVerificationExpires: new Date(Date.now() + VERIFICATION_TTL_MS),
    },
  })

  // Best-effort: don't fail registration if the email provider is down.
  try {
    await sendVerificationEmail(normalizedEmail, verificationToken)
  } catch (e) {
    console.error('[authService] Failed to send verification email:', e.message)
  }

  return user
}

async function login(username, password) {
  const normalized = username.toLowerCase().trim()

  const user = await prisma.user.findUnique({ where: { username: normalized } })

  // Always compare in every case to avoid a timing attack (user discovery)
  const fakeHash = '$2b$12$invalidhashfortimingprotectiononly000000000000000000000'
  const hash = user ? user.password : fakeHash
  const ok = await bcrypt.compare(password, hash)

  if (!user || !ok) throw new Error('INVALID_CREDENTIALS')
  if (!user.emailVerified) throw new Error('EMAIL_NOT_VERIFIED')

  await prisma.user.update({
    where: { id: user.id },
    data: { lastActive: new Date() },
  })

  const token = signToken({ id: user.id, tokenVersion: user.tokenVersion })
  return { user, token }
}

async function verifyEmail(token) {
  if (!token) throw new Error('TOKEN_INVALID')

  const user = await prisma.user.findUnique({ where: { emailVerificationToken: token } })
  if (!user) throw new Error('TOKEN_INVALID')
  if (user.emailVerificationExpires && user.emailVerificationExpires < new Date()) {
    throw new Error('TOKEN_EXPIRED')
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      emailVerified: true,
      emailVerificationToken: null,
      emailVerificationExpires: null,
    },
  })
  return true
}

async function resendVerificationEmail(username) {
  const normalized = username.toLowerCase().trim()
  const user = await prisma.user.findUnique({ where: { username: normalized } })

  // Stay silent on purpose: don't reveal whether the account exists or is
  // already verified, to avoid leaking account info to an attacker.
  if (!user || user.emailVerified) return true

  const verificationToken = generateVerificationToken()
  await prisma.user.update({
    where: { id: user.id },
    data: {
      emailVerificationToken: verificationToken,
      emailVerificationExpires: new Date(Date.now() + VERIFICATION_TTL_MS),
    },
  })
  await sendVerificationEmail(user.email, verificationToken)
  return true
}

async function changePassword(userId, oldPassword, newPassword) {
  if (newPassword.length < 8) throw new Error('PASSWORD_TOO_SHORT')

  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user) throw new Error('USER_NOT_FOUND')

  const ok = await bcrypt.compare(oldPassword, user.password)
  if (!ok) throw new Error('INVALID_OLD_PASSWORD')

  const hash = await bcrypt.hash(newPassword, 12)
  await prisma.user.update({
    where: { id: userId },
    data: {
      password: hash,
      tokenVersion: { increment: 1 }
    },
  })
  return true
}

async function logoutAll(userId) {
  await prisma.user.update({
    where: { id: userId },
    data: { tokenVersion: { increment: 1 } },
  })
}

module.exports = {
  register,
  login,
  changePassword,
  logoutAll,
  verifyEmail,
  resendVerificationEmail,
}
