const prisma = require('../utils/prisma')
const bcrypt = require('bcrypt')
const { signToken } = require('../utils/jwt')

async function register(displayUsername, password) {
  const normalized = displayUsername.toLowerCase().trim()

  if (normalized.length < 3 || normalized.length > 24) {
    throw new Error('USERNAME_LENGTH') // 3–24 caractères
  }
  if (!/^[a-z0-9_.-]+$/.test(normalized)) {
    throw new Error('USERNAME_INVALID') // pas de caractères spéciaux
  }
  if (password.length < 8) {
    throw new Error('PASSWORD_TOO_SHORT') // min 8 caractères
  }

  const exists = await prisma.user.findUnique({ where: { username: normalized } })
  if (exists) throw new Error('USERNAME_TAKEN')

  const hash = await bcrypt.hash(password, 12) // 12 rounds, plus sûr que 10
  return prisma.user.create({
    data: {
      username: normalized,
      displayUsername: displayUsername.trim(),
      password: hash,
    },
  })
}

async function login(username, password) {
  const normalized = username.toLowerCase().trim()

  const user = await prisma.user.findUnique({ where: { username: normalized } })

  // On compare dans tous les cas pour éviter le timing attack (user discovery)
  const fakeHash = '$2b$12$invalidhashfortimingprotectiononly000000000000000000000'
  const hash = user ? user.password : fakeHash
  const ok = await bcrypt.compare(password, hash)

  if (!user || !ok) throw new Error('INVALID_CREDENTIALS')

  await prisma.user.update({
    where: { id: user.id },
    data: { lastActive: new Date() },
  })

  const token = signToken({ id: user.id, tokenVersion: user.tokenVersion })
  return { user, token }
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

module.exports = { register, login, changePassword, logoutAll }
