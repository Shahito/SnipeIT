const { launchJob, listJobs, getJob, cancelJob } = require('../services/jobService')

const KNOWN_CODES = new Set([
  'STRATEGY_NOT_FOUND', 'JOB_NOT_FOUND', 'JOB_ALREADY_RUNNING',
  'JOB_NOT_CANCELABLE', 'MISSING_FIELDS',
])

function errorCode(e, fallback = 'UNKNOWN') {
  return KNOWN_CODES.has(e.message) ? e.message : fallback
}

async function launchController(req, res) {
  try {
    const { strategyId } = req.body
    if (!strategyId) return res.status(400).json({ error: 'MISSING_FIELDS' })
    const job = await launchJob(parseInt(strategyId), req.user.id)
    res.status(201).json({ job })
  } catch (e) {
    res.status(400).json({ error: errorCode(e) })
  }
}

async function listController(req, res) {
  try {
    const { page, limit, sort, order, status } = req.query
    const result = await listJobs(req.user.id, { page, limit, sort, order, status })
    res.json(result)
  } catch (e) {
    res.status(500).json({ error: errorCode(e) })
  }
}

async function getController(req, res) {
  try {
    const job = await getJob(parseInt(req.params.id), req.user.id)
    res.json({ job })
  } catch (e) {
    res.status(404).json({ error: errorCode(e) })
  }
}

async function cancelController(req, res) {
  try {
    const job = await cancelJob(parseInt(req.params.id), req.user.id)
    res.json({ job })
  } catch (e) {
    res.status(400).json({ error: errorCode(e) })
  }
}

module.exports = { launchController, listController, getController, cancelController }
