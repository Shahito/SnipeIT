const crypto = require('crypto')
const prisma = require('../utils/prisma')
const bcrypt = require('bcrypt')
const { signToken } = require('../utils/jwt')
const { sendVerificationEmail } = require('../utils/mailer')
const { evaluatePassword } = require('../utils/passwordPolicy')
const { canonicalizeEmail, hasAliasTag } = require('../utils/emailNormalize')
const { allowEmailAliases } = require('../utils/env')
const { domainCanReceiveMail } = require('../utils/emailDomainCheck')

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const VERIFICATION_TTL_MS = 1000 * 60 * 60 * 24 // 24h
const VERIFICATION_RESEND_COOLDOWN_MS = 1000 * 60 // 60s between verification-type emails
// for the same account (register / resend-verification / change-email all
// share this), on top of the per-IP limiter in app.js.

function verificationCooldownActive(user) {
  return (
    user.lastVerificationEmailAt &&
    Date.now() - user.lastVerificationEmailAt.getTime() < VERIFICATION_RESEND_COOLDOWN_MS
  )
}

function normalizeEmail(email) {
  return email.trim().toLowerCase()
}

function assertStrongPassword(password, context) {
  const { checks } = evaluatePassword(password, context)
  if (!checks.length) throw new Error('PASSWORD_TOO_SHORT')
  if (!checks.lowercase) throw new Error('PASSWORD_NEEDS_LOWERCASE')
  if (!checks.uppercase) throw new Error('PASSWORD_NEEDS_UPPERCASE')
  if (!checks.digit) throw new Error('PASSWORD_NEEDS_DIGIT')
  if (!checks.special) throw new Error('PASSWORD_NEEDS_SPECIAL')
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
  if (!allowEmailAliases && hasAliasTag(normalizedEmail)) {
    throw new Error('EMAIL_ALIAS_BLOCKED')
  }

  // Catch obviously bogus addresses (e.g. a@a.a) before creating the account:
  // format-valid but the domain can't actually receive mail, so the
  // verification email would silently vanish and the user would never know.
  const domain = normalizedEmail.slice(normalizedEmail.lastIndexOf('@') + 1)
  if (!(await domainCanReceiveMail(domain))) {
    throw new Error('EMAIL_DOMAIN_UNREACHABLE')
  }

  assertStrongPassword(password, { username: normalized, email: normalizedEmail })

  const canonicalEmail = canonicalizeEmail(normalizedEmail)

  const [usernameTaken, emailTaken] = await Promise.all([
    prisma.user.findUnique({ where: { username: normalized } }),
    prisma.user.findUnique({ where: { normalizedEmail: canonicalEmail } }),
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
      normalizedEmail: canonicalEmail,
      emailVerified: false,
      emailVerificationToken: verificationToken,
      emailVerificationExpires: new Date(Date.now() + VERIFICATION_TTL_MS),
      lastVerificationEmailAt: new Date(),
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
  if (!user.emailVerified) {
    // The user already proved they own this account (correct password), so
    // unlike resendVerificationEmail() below there's no info-leak concern
    // in being specific here: tell them plainly if we know the mail bounced.
    if (user.emailDeliveryFailed) throw new Error('EMAIL_DELIVERY_FAILED')
    throw new Error('EMAIL_NOT_VERIFIED')
  }

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

  if (user.pendingEmail) {
    // This token confirms a NEW address (from changeEmail()), not the
    // original one - swap it in now that ownership is proven.
    const canonicalEmail = canonicalizeEmail(user.pendingEmail)
    await prisma.user.update({
      where: { id: user.id },
      data: {
        email: user.pendingEmail,
        normalizedEmail: canonicalEmail,
        emailVerified: true,
        emailVerificationToken: null,
        emailVerificationExpires: null,
        pendingEmail: null,
        pendingEmailDeliveryFailed: false,
        pendingEmailDeliveryFailedReason: null,
        pendingEmailDeliveryFailedAt: null,
        // Whatever was wrong with the OLD address is moot now - we just left it.
        emailDeliveryFailed: false,
        emailDeliveryFailedReason: null,
        emailDeliveryFailedAt: null,
      },
    })
  } else {
    await prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerified: true,
        emailVerificationToken: null,
        emailVerificationExpires: null,
      },
    })
  }
  return true
}

async function resendVerificationEmail(username) {
  const normalized = username.toLowerCase().trim()
  const user = await prisma.user.findUnique({ where: { username: normalized } })

  // Stay silent on purpose: don't reveal whether the account exists or is
  // already verified, to avoid leaking account info to an attacker.
  if (!user || user.emailVerified) return true

  // Same silence applies to the cooldown: an attacker probing usernames
  // shouldn't be able to tell "unknown account" apart from "known account,
  // already resent recently" by comparing response codes/timing.
  if (verificationCooldownActive(user)) return true

  const verificationToken = generateVerificationToken()
  await prisma.user.update({
    where: { id: user.id },
    data: {
      emailVerificationToken: verificationToken,
      emailVerificationExpires: new Date(Date.now() + VERIFICATION_TTL_MS),
      lastVerificationEmailAt: new Date(),
      // Don't optimistically clear emailDeliveryFailed here: Resend puts
      // hard-bounced addresses on a suppression list, so a resend to the
      // SAME bad address is silently dropped and never produces a fresh
      // email.bounced event to re-flag it - the flag would stay wrongly
      // cleared forever. Only clear it on an actual email.delivered event
      // (see webhookService.js), i.e. real evidence it now works.
    },
  })
  await sendVerificationEmail(user.email, verificationToken)
  return true
}

async function changeEmail(userId, currentPassword, newEmail) {
  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user) throw new Error('USER_NOT_FOUND')

  const ok = await bcrypt.compare(currentPassword, user.password)
  if (!ok) throw new Error('INVALID_OLD_PASSWORD')
  
  if (verificationCooldownActive(user)) throw new Error('TOO_MANY_REQUESTS')

  const normalizedEmail = normalizeEmail(newEmail || '')
  if (!normalizedEmail || !EMAIL_RE.test(normalizedEmail)) throw new Error('EMAIL_INVALID')
  if (!allowEmailAliases && hasAliasTag(normalizedEmail)) throw new Error('EMAIL_ALIAS_BLOCKED')

  // Same domain-reachability guard as register() - no point sending a
  // confirmation link to a domain that plainly doesn't exist.
  const domain = normalizedEmail.slice(normalizedEmail.lastIndexOf('@') + 1)
  if (!(await domainCanReceiveMail(domain))) throw new Error('EMAIL_DOMAIN_UNREACHABLE')

  const canonicalEmail = canonicalizeEmail(normalizedEmail)
  if (canonicalEmail === user.normalizedEmail) throw new Error('EMAIL_SAME_AS_CURRENT')

  const taken = await prisma.user.findUnique({ where: { normalizedEmail: canonicalEmail } })
  if (taken) throw new Error('EMAIL_TAKEN')

  const verificationToken = generateVerificationToken()
  await prisma.user.update({
    where: { id: user.id },
    data: {
      pendingEmail: normalizedEmail,
      emailVerificationToken: verificationToken,
      emailVerificationExpires: new Date(Date.now() + VERIFICATION_TTL_MS),
      lastVerificationEmailAt: new Date(),
      // Fresh address, fresh slate - any previous pending-change bounce
      // was necessarily about a different address than this one.
      pendingEmailDeliveryFailed: false,
      pendingEmailDeliveryFailedReason: null,
      pendingEmailDeliveryFailedAt: null,
    },
  })

  // Best-effort, same reasoning as register(): don't fail the request if
  // the mail provider hiccups - the pending state is already saved, and the
  // user (or a later webhook) can still act on it.
  try {
    await sendVerificationEmail(normalizedEmail, verificationToken)
  } catch (e) {
    console.error('[authService] Failed to send change-email confirmation:', e.message)
  }

  return true
}

async function changePassword(userId, oldPassword, newPassword) {
  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user) throw new Error('USER_NOT_FOUND')

  assertStrongPassword(newPassword, { username: user.username, email: user.email })

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
  changeEmail,
  logoutAll,
  verifyEmail,
  resendVerificationEmail,
}
