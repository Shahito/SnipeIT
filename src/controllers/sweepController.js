const { previewSweep, launchSweep, listSweeps, getSweepGroup } = require('../services/sweepService')
const { SWEEP_MAX_COMBINATIONS } = require('../config/sweep')

const KNOWN_CODES = new Set([
  'STRATEGY_NOT_FOUND', 'JOB_ALREADY_RUNNING', 'SWEEP_TOO_LARGE',
  'SWEEP_CONFIRMATION_REQUIRED', 'SWEEP_AXIS_EMPTY', 'PAIRS_INVALID',
  'SWEEP_NOT_FOUND',
])

function errorCode(e, fallback = 'UNKNOWN') {
  return KNOWN_CODES.has(e.message) ? e.message : fallback
}

async function previewController(req, res) {
  try {
    const preview = await previewSweep(parseInt(req.params.id), req.user.id)
    res.json(preview)
  } catch (e) {
    const code = errorCode(e)
    res.status(code === 'STRATEGY_NOT_FOUND' ? 404 : 400).json({ error: code, totalRuns: e.totalRuns, limit: SWEEP_MAX_COMBINATIONS })
  }
}

async function launchController(req, res) {
  try {
    const { confirmLarge } = req.body || {}
    const sweepGroup = await launchSweep(parseInt(req.params.id), req.user.id, { confirmLarge: !!confirmLarge })
    res.status(201).json({ sweepGroup })
  } catch (e) {
    const code = errorCode(e)
    res.status(code === 'STRATEGY_NOT_FOUND' ? 404 : 400).json({ error: code, totalRuns: e.totalRuns, limit: SWEEP_MAX_COMBINATIONS })
  }
}

async function listController(req, res) {
  try {
    const sweeps = await listSweeps(req.user.id)
    res.json({ sweeps })
  } catch (e) {
    res.status(500).json({ error: errorCode(e) })
  }
}

async function getController(req, res) {
  try {
    const sweep = await getSweepGroup(parseInt(req.params.id), req.user.id)
    res.json({ sweep })
  } catch (e) {
    res.status(404).json({ error: errorCode(e) })
  }
}

module.exports = { previewController, launchController, listController, getController }
