// Combinatorial explosion guardrails.
// SWEEP_WARNING_THRESHOLD  : above this, the API returns warning:true (front must ask for confirmation)
// SWEEP_MAX_COMBINATIONS   : above this, the API rejects the request (SWEEP_TOO_LARGE)
// SWEEP_ALL_RUNS_THRESHOLD : at or below this, best/worst overlap too much to be useful separately,
//                            so the API returns a single "all" list sorted by PnL instead
module.exports = {
  SWEEP_WARNING_THRESHOLD: 200,
  SWEEP_ALL_RUNS_THRESHOLD: 20,
  SWEEP_MAX_COMBINATIONS: 1000,
}
