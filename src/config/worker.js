module.exports = {
  // A worker is considered disconnected once its last heartbeat is older than this
  WORKER_DISCONNECT_THRESHOLD_MS: 45_000,

  // GitHub repo ("owner/name") whose releases ship the worker. Empty disables downloads and update checks
  WORKER_RELEASE_REPO: process.env.WORKER_RELEASE_REPO || '',
  WORKER_ASSET_NAME: 'snipeit-worker.zip',
  WORKER_TAG_PREFIX: 'worker-v',
  WORKER_RELEASE_CACHE_TTL_MS: 60 * 60 * 1000,
  WORKER_RELEASE_RETRY_MS: 5 * 60 * 1000,

  // Workers older than this are refused with 426 (empty = no minimum)
  MIN_WORKER_VERSION: process.env.MIN_WORKER_VERSION || '',
}