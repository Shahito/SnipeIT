const { listJobs, getJob, cancelJob } = require('../services/jobService')

const KNOWN_CODES = new Set([
  'JOB_NOT_FOUND', 'JOB_NOT_CANCELABLE',
])

function errorCode(e, fallback = 'UNKNOWN') {
  return KNOWN_CODES.has(e.message) ? e.message : fallback
}

async function listController(req, res) {
  try {
    const { page, limit, sort, order, status, sweepGroupId } = req.query
    const result = await listJobs(req.user.id, { page, limit, sort, order, status, sweepGroupId })
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

module.exports = { listController, getController, cancelController }
