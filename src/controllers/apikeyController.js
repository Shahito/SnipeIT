const { createApiKey, listApiKeys, deleteApiKey } = require('../services/apikeyService')

const KNOWN_CODES = new Set(['NAME_REQUIRED', 'API_KEY_NOT_FOUND', 'MISSING_FIELDS', 'API_KEY_LIMIT_REACHED'])

function errorCode(e, fallback = 'UNKNOWN') {
  return KNOWN_CODES.has(e.message) ? e.message : fallback
}

async function createController(req, res) {
  try {
    const { name } = req.body
    if (!name) return res.status(400).json({ error: 'MISSING_FIELDS' })
    const apiKey = await createApiKey(req.user.id, name)
    res.status(201).json({ apiKey })
  } catch (e) {
    if (e.message === 'API_KEY_LIMIT_REACHED') return res.status(429).json({ error: 'API_KEY_LIMIT_REACHED' })
    res.status(400).json({ error: errorCode(e) })
  }
}

async function listController(req, res) {
  try {
    const apiKeys = await listApiKeys(req.user.id)
    res.json({ apiKeys })
  } catch (e) {
    res.status(500).json({ error: errorCode(e) })
  }
}

async function deleteController(req, res) {
  try {
    await deleteApiKey(parseInt(req.params.id), req.user.id)
    res.json({ success: true })
  } catch (e) {
    res.status(404).json({ error: errorCode(e) })
  }
}

module.exports = { createController, listController, deleteController }
