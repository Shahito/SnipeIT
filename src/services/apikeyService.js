const prisma = require('../utils/prisma')
const crypto = require('crypto')
const { invalidateApiKeyCache } = require('../middleware/workerAuth')
const { sendLocalizedNotificationToUser } = require('./pushService')
const { WORKER_DISCONNECT_THRESHOLD_MS } = require('../config/worker')

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
      id: true, name: true, keyPrefix: true, lastUsedAt: true, createdAt: true, workerVersion: true,
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

// Called from a cron job. Sends one push per worker that just crossed the
// disconnect threshold, then marks it so it does not fire again on every tick.
// The flag is reset on the next heartbeat, see workerController.js.
async function notifyDisconnectedWorkers() {
  const threshold = new Date(Date.now() - WORKER_DISCONNECT_THRESHOLD_MS)
  const staleKeys = await prisma.apiKey.findMany({
    where: {
      lastHeartbeat: { lt: threshold },
      disconnectedNotified: false,
    },
    select: { id: true, userId: true, name: true },
  })
  if (staleKeys.length === 0) return

  await prisma.apiKey.updateMany({
    where: { id: { in: staleKeys.map(k => k.id) } },
    data: { disconnectedNotified: true },
  })

  await Promise.all(staleKeys.map((key) =>
    sendLocalizedNotificationToUser(key.userId, {
      titleKey: 'push.worker_disconnected.title',
      bodyKey: 'push.worker_disconnected.body',
      vars: { name: key.name },
    }, '/jobs.html', `worker-${key.id}`).catch((err) => {
      console.error('Push notification failed:', err)
    })
  ))
}

// Heartbeat/poll entry point. The conditional updateMany only matches when the
// disconnect push was sent, so exactly one call per outage sends the reconnect
// push, which replaces the disconnect one (same tag).
async function recordWorkerHeartbeat(apiKeyId, extra = {}) {
  const now = new Date()
  const { count } = await prisma.apiKey.updateMany({
    where: { id: apiKeyId, disconnectedNotified: true },
    data: { lastHeartbeat: now, disconnectedNotified: false, ...extra },
  })
  if (count === 0) {
    await prisma.apiKey.update({ where: { id: apiKeyId }, data: { lastHeartbeat: now, ...extra } })
    return
  }
  const key = await prisma.apiKey.findUnique({ where: { id: apiKeyId }, select: { userId: true, name: true } })
  if (!key) return
  sendLocalizedNotificationToUser(key.userId, {
    titleKey: 'push.worker_reconnected.title',
    bodyKey: 'push.worker_reconnected.body',
    vars: { name: key.name },
  }, '/jobs.html', `worker-${apiKeyId}`).catch((err) => {
    console.error('Push notification failed:', err)
  })
}

module.exports = { createApiKey, listApiKeys, deleteApiKey, notifyDisconnectedWorkers, recordWorkerHeartbeat }