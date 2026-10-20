// Unit tests for src/utils/deflatedSharpe.js
// Usage: npm run test:dsr
'use strict'

const { normCdf, normInv, psr, expectedMaxSharpe, computeSweepDsr } = require('../src/utils/deflatedSharpe')

const errors = []

function expectClose(label, actual, expected, tol) {
  if (actual === null || !(Math.abs(actual - expected) <= tol)) {
    errors.push(`${label}: expected ${expected}, got ${actual}`)
  }
}

function expectTrue(label, condition) {
  if (!condition) errors.push(label)
}

// Normal distribution helpers
expectClose('normCdf(0)', normCdf(0), 0.5, 1e-7)
expectClose('normCdf(1.96)', normCdf(1.96), 0.9750021, 1e-6)
expectClose('normCdf(-1.96)', normCdf(-1.96), 0.0249979, 1e-6)
expectClose('normInv(0.975)', normInv(0.975), 1.959964, 1e-5)
expectClose('normInv(0.001)', normInv(0.001), -3.090232, 1e-5)
expectTrue('normInv out of range is NaN', Number.isNaN(normInv(0)) && Number.isNaN(normInv(1)))

// PSR
expectClose('psr normal returns', psr(0.1, 0, 3, 251, 0), 0.9426253, 1e-5)
expectClose('psr fat tails and negative skew', psr(0.05, -0.5, 6, 400, 0.02), 0.7227385, 1e-5)
expectClose('psr at benchmark', psr(0.1, 0, 3, 251, 0.1), 0.5, 1e-7)
expectTrue('psr invalid input is null', psr(NaN, 0, 3, 251) === null && psr(0.1, 0, 3, 1) === null)

// Expected max Sharpe
expectClose('expectedMaxSharpe N=10', expectedMaxSharpe(10, 1), 1.5745983, 1e-5)
expectClose('expectedMaxSharpe N=1000', expectedMaxSharpe(1000, 1), 3.2551215, 1e-5)
expectClose('expectedMaxSharpe scales with std', expectedMaxSharpe(100, 0.5), 1.2653014, 1e-5)
expectTrue('expectedMaxSharpe single trial is 0', expectedMaxSharpe(1, 1) === 0)
expectTrue('expectedMaxSharpe grows with N', expectedMaxSharpe(100, 1) > expectedMaxSharpe(10, 1))

// Sweep level DSR
function job(id, sharpe, periodsPerYear = 365) {
  return { id, returnStats: { sharpe, skew: 0, kurtosis: 3, obs: 365, periodsPerYear } }
}

const single = computeSweepDsr([job(1, 0.1)])
expectClose('single trial equals PSR', single.get(1), psr(0.1, 0, 3, 365, 0), 1e-12)

const sweep = [job(1, 0.12), job(2, 0.02), job(3, 0.05), job(4, -0.03), job(5, 0.08)]
const deflated = computeSweepDsr(sweep)
expectTrue('every run gets a DSR', deflated.size === sweep.length)
expectTrue('DSR is below the plain PSR', deflated.get(1) < psr(0.12, 0, 3, 365, 0))
expectTrue('DSR keeps the Sharpe ordering', deflated.get(1) > deflated.get(5) && deflated.get(5) > deflated.get(4))

const withMissing = computeSweepDsr([job(1, 0.1), { id: 2, returnStats: null }, job(3, 0.05)])
expectTrue('runs without stats are skipped', !withMissing.has(2) && withMissing.size === 2)

if (errors.length) {
  console.error('FAIL deflatedSharpe')
  errors.forEach(e => console.error('  - ' + e))
  process.exit(1)
}
console.log('OK deflatedSharpe')