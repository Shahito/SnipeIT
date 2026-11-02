// Per-user limits. Values are starting points, adjust to real usage
module.exports = {
  MAX_STRATEGIES: 1000,            // not deleted
  MAX_STRATEGIES_PER_HOUR: 30,     // creates and clones, deleted ones count for 24h
  MAX_TAGS: 50,
  MAX_PUSH_SUBSCRIPTIONS: 10,
  MAX_ACTIVE_JOBS: 3000,           // pending + running
  MAX_STORED_JOBS: 20000,          // all jobs, any status
  MAX_SWEEPS_PER_HOUR: 10,         // multi-run sweeps only, single backtests are not rate limited
}