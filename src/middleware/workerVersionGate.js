const { MIN_WORKER_VERSION } = require('../config/worker')
const { compareVersions } = require('../utils/version')

// Refuses workers older than MIN_WORKER_VERSION (a worker whose version can't be read counts as too old)
function workerVersionGate(req, res, next) {
  if (!MIN_WORKER_VERSION) return next()
  const cmp = req.workerVersion ? compareVersions(req.workerVersion, MIN_WORKER_VERSION) : null
  if (cmp !== null && cmp >= 0) return next()
  return res.status(426).json({ error: 'WORKER_OUTDATED', minVersion: MIN_WORKER_VERSION })
}

module.exports = workerVersionGate