const prisma = require('../utils/prisma')
const crypto = require('crypto')
const { invalidateApiKeyCache } = require('../middleware/workerAuth')

const MAX_API_KEYS_PER_USER = 5

function generateRawKey() {
  // Format : snp_<32 chars hex>
  const rand = crypto.randomBytes(16).toString('hex')
  return `snp_${rand}`
}

async function createApiKey(userId, name) {
  if (!name || name.trim().length < 2) throw new Error('NAME_REQUIRED')

  const count = await prisma.apiKey.count({ where: { userId } })
  if (count >= MAX_API_KEYS_PER_USER) throw new Error('API_KEY_LIMIT_REACHED')

  const rawKey = generateRawKey()
  const prefix = rawKey.slice(0, 12) // "snp_" + 8 chars
  
  const hash = crypto.createHash('sha256').update(rawKey).digest('hex')

  const apiKey = await prisma.apiKey.create({
    data: {
      userId,
      name: name.trim(),
      keyHash: hash,
      keyPrefix: prefix,
    },
  })

  // Return raw key once time
  return { ...apiKey, rawKey }
}

async function listApiKeys(userId) {
  return prisma.apiKey.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true, name: true, keyPrefix: true, lastUsedAt: true, createdAt: true,
    },
  })
}

async function deleteApiKey(id, userId) {
  const key = await prisma.apiKey.findFirst({ where: { id, userId } })
  if (!key) throw new Error('API_KEY_NOT_FOUND')
  await prisma.apiKey.delete({ where: { id } })
  invalidateApiKeyCache(key.keyHash)
  return true
}

module.exports = { createApiKey, listApiKeys, deleteApiKey }