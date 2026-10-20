// Probabilistic and Deflated Sharpe Ratio (Bailey and Lopez de Prado, 2014)
// DSR is the PSR measured against the best Sharpe expected from luck after N trials
'use strict'

const EULER_GAMMA = 0.5772156649015329

// Standard normal CDF, erfc approximation (error below 1.2e-7)
function normCdf(x) {
  const z = Math.abs(x) / Math.SQRT2
  const t = 1 / (1 + 0.5 * z)
  const poly = -z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418
    + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587
    + t * (-0.82215223 + t * 0.17087277))))))))
  const erfc = t * Math.exp(poly)
  return x >= 0 ? 1 - 0.5 * erfc : 0.5 * erfc
}

// Inverse standard normal CDF (Acklam)
const INV_A = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00]
const INV_B = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01]
const INV_C = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00]
const INV_D = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00]
const INV_P_LOW = 0.02425

function normInv(p) {
  if (!(p > 0 && p < 1)) return NaN
  const tail = q => (((((INV_C[0] * q + INV_C[1]) * q + INV_C[2]) * q + INV_C[3]) * q + INV_C[4]) * q + INV_C[5])
    / ((((INV_D[0] * q + INV_D[1]) * q + INV_D[2]) * q + INV_D[3]) * q + 1)

  if (p < INV_P_LOW) return tail(Math.sqrt(-2 * Math.log(p)))
  if (p > 1 - INV_P_LOW) return -tail(Math.sqrt(-2 * Math.log(1 - p)))

  const q = p - 0.5
  const r = q * q
  return (((((INV_A[0] * r + INV_A[1]) * r + INV_A[2]) * r + INV_A[3]) * r + INV_A[4]) * r + INV_A[5]) * q
    / (((((INV_B[0] * r + INV_B[1]) * r + INV_B[2]) * r + INV_B[3]) * r + INV_B[4]) * r + 1)
}

// sr is per period, kurtosis is raw (3 for a normal). Null if inputs are invalid
function psr(sr, skew, kurtosis, obs, benchmark = 0) {
  if (![sr, skew, kurtosis, obs, benchmark].every(Number.isFinite) || obs < 2) return null
  const variance = 1 - skew * sr + ((kurtosis - 1) / 4) * sr * sr
  if (variance <= 0) return null
  return normCdf(((sr - benchmark) * Math.sqrt(obs - 1)) / Math.sqrt(variance))
}

// Expected best Sharpe of N unskilled trials
function expectedMaxSharpe(trials, srStd) {
  if (trials < 2 || !(srStd > 0)) return 0
  return srStd * ((1 - EULER_GAMMA) * normInv(1 - 1 / trials)
    + EULER_GAMMA * normInv(1 - 1 / (trials * Math.E)))
}

function sampleStd(values) {
  if (values.length < 2) return 0
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / (values.length - 1)
  return Math.sqrt(variance)
}

function hasStats(s) {
  return !!s && [s.sharpe, s.skew, s.kurtosis, s.obs, s.periodsPerYear].every(Number.isFinite)
}

// jobs: [{ id, returnStats }] of one sweep. Returns Map(jobId, dsr)
// The benchmark uses annualized Sharpe values because timeframes can differ
function computeSweepDsr(jobs) {
  const rows = jobs.filter(j => hasStats(j.returnStats))
  const annual = rows.map(j => j.returnStats.sharpe * Math.sqrt(j.returnStats.periodsPerYear))
  const benchmarkAnnual = expectedMaxSharpe(rows.length, sampleStd(annual))

  const byJob = new Map()
  for (const { id, returnStats: s } of rows) {
    const benchmark = benchmarkAnnual / Math.sqrt(s.periodsPerYear)
    byJob.set(id, psr(s.sharpe, s.skew, s.kurtosis, s.obs, benchmark))
  }
  return byJob
}

module.exports = { normCdf, normInv, psr, expectedMaxSharpe, computeSweepDsr }