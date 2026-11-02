const prisma = require('../utils/prisma')
const crypto = require('crypto')
const { parseWorkerVersion } = require('../utils/version')

const tokenCache = new Map()
const CACHE_TTL = 2 * 60 * 1000 // Valid key 2mins in cache

async function workerAuthRequired(req, res, next) {
  try {
    req.workerVersion = parseWorkerVersion(req.headers['user-agent'])
    const authHeader = req.headers.authorization || ''
    if (!authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'MISSING_API_KEY' })
    }

    const rawKey = authHeader.slice(7).trim()
    if (!rawKey) return res.status(401).json({ error: 'MISSING_API_KEY' })

    const hash = crypto.createHash('sha256').update(rawKey).digest('hex')

    // Fast check in cache (keyed by hash, not raw key)
    const cached = tokenCache.get(hash)
    if (cached && cached.expiresAt > Date.now()) {
      req.apiKey = cached.apiKey
      req.workerUser = cached.workerUser
      return next()
    }

    const apiKeyRecord = await prisma.apiKey.findUnique({
      where: { keyHash: hash },
      include: { user: { select: { id: true } } },
    })

    if (!apiKeyRecord) {
      return res.status(401).json({ error: 'INVALID_API_KEY' })
    }

    // Store valid result in cache for next requests
    tokenCache.set(hash, {
      apiKey: apiKeyRecord,
      workerUser: apiKeyRecord.user,
      expiresAt: Date.now() + CACHE_TTL
    })

    // Update lastUsedAt
    prisma.apiKey.update({
      where: { id: apiKeyRecord.id },
      data: { lastUsedAt: new Date() },
    }).catch(() => {})

    req.apiKey = apiKeyRecord
    req.workerUser = apiKeyRecord.user
    next()
  } catch (e) {
    // Lookup failed (DB down), not an auth failure: let the worker retry
    console.error('workerAuth error:', e)
    return res.status(503).json({ error: 'SERVICE_UNAVAILABLE' })
  }
}

// Auto cache clean every 5mins to avoid memory leaks
setInterval(() => {
  const now = Date.now()
  for (const [key, value] of tokenCache.entries()) {
    if (value.expiresAt < now) tokenCache.delete(key)
  }
}, 5 * 60 * 1000)

function invalidateApiKeyCache(keyHash) {
  tokenCache.delete(keyHash)
}

module.exports = workerAuthRequired
module.exports.invalidateApiKeyCache = invalidateApiKeyCache