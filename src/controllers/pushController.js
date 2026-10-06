const { getVapidPublicKey, subscribePush, sendNotificationToAll } = require('../services/pushService')

const KNOWN_CODES = new Set([
  'MISSING_FIELDS',
  'VAPID_NOT_CONFIGURED',
  'UNAUTHORIZED',
])

function errorCode(e, fallback = 'UNKNOWN') {
  return KNOWN_CODES.has(e.message) ? e.message : fallback
}

async function getVapidPublicKeyController(req, res) {
  try {
    const publicKey = getVapidPublicKey()
    res.json({ publicKey })
  } catch (e) {
    res.status(500).json({ error: errorCode(e) })
  }
}

async function subscribeController(req, res) {
  try {
    // authRequired guarantees req.user. subscribePush still checks for a
    // missing userId in case this route is ever mounted without it.
    await subscribePush(req.user.id, req.body)
    res.json({ success: true })
  } catch (e) {
    const code = errorCode(e)
    res.status(code === 'UNAUTHORIZED' ? 401 : 400).json({ error: code })
  }
}

async function sendTestNotificationController(req, res) {
  try {
    const { title, body, url } = req.body
    if (!title || !body) {
      return res.status(400).json({ error: 'MISSING_FIELDS' })
    }

    const result = await sendNotificationToAll(title, body, url)
    res.json({ success: true, ...result })
  } catch (e) {
    res.status(500).json({ error: errorCode(e) })
  }
}

module.exports = {
  getVapidPublicKeyController,
  subscribeController,
  sendTestNotificationController,
}