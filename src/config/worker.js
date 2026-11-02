const { parseVersion } = require('../utils/version')

// Fail fast on a malformed minimum: it would otherwise refuse every worker
if (process.env.MIN_WORKER_VERSION && !parseVersion(process.env.MIN_WORKER_VERSION)) {
  console.error('[FATAL] MIN_WORKER_VERSION must be x.y.z (got "' + process.env.MIN_WORKER_VERSION + '")')
  process.exit(1)
}

module.exports = {
  // A worker is considered disconnected once its last heartbeat is older than this
  WORKER_DISCONNECT_THRESHOLD_MS: 45_000,

  // A running job whose worker has been silent this long is reset. Keep it above the disconnect threshold
  STALE_JOB_CUTOFF_MS: 60_000,

  // GitHub repo ("owner/name") whose releases ship the worker. Empty disables downloads and update checks
  WORKER_RELEASE_REPO: process.env.WORKER_RELEASE_REPO || '',
  WORKER_ASSET_NAME: 'snipeit-worker.zip',
  WORKER_TAG_PREFIX: 'worker-v',
  WORKER_RELEASE_CACHE_TTL_MS: 60 * 60 * 1000,
  WORKER_RELEASE_RETRY_MS: 5 * 60 * 1000,

  // Workers older than this are refused with 426 (empty = no minimum)
  MIN_WORKER_VERSION: process.env.MIN_WORKER_VERSION || '',

  // A running job older than this is failed even if its worker still heartbeats
  MAX_JOB_DURATION_MS: (parseInt(process.env.MAX_JOB_DURATION_MIN, 10) || 30) * 60 * 1000,
}