const prisma = require('../utils/prisma')

const INSTANCE_RE = /^[A-Za-z0-9_-]{16,64}$/

// One live worker per API key, last started wins.
// A worker claims the key on startup (X-Worker-Takeover), any other instance then gets 409.
// Workers that send no instance id are not enforced: raise MIN_WORKER_VERSION to force it.
module.exports = async function workerInstanceGate(req, res, next) {
  const instance = req.get('x-worker-instance')
  if (!instance) return next()
  if (!INSTANCE_RE.test(instance)) return res.status(400).json({ error: 'INVALID_INSTANCE' })

  try {
    const id = req.apiKey.id

    if (req.get('x-worker-takeover') === '1') {
      await prisma.apiKey.update({ where: { id }, data: { instanceId: instance } })
      return next()
    }

    const row = await prisma.apiKey.findUnique({ where: { id }, select: { instanceId: true } })
    if (!row) return res.status(401).json({ error: 'INVALID_API_KEY' })
    if (row.instanceId === instance) return next()
    if (row.instanceId !== null) return res.status(409).json({ error: 'KEY_REPLACED' })

    // Free key: adopt it atomically
    const adopted = await prisma.apiKey.updateMany({
      where: { id, instanceId: null },
      data: { instanceId: instance },
    })
    if (adopted.count === 0) return res.status(409).json({ error: 'KEY_REPLACED' })
    next()
  } catch (e) {
    console.error('workerInstanceGate error:', e)
    res.status(503).json({ error: 'SERVICE_UNAVAILABLE' })
  }
}