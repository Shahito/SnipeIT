// A worker is considered disconnected once its last heartbeat is older than this
module.exports = {
  WORKER_DISCONNECT_THRESHOLD_MS: 45_000,
}