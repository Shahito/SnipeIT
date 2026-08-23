// Generates test/fixtures/candles.json once and for all (deterministic, seeded).
// Do NOT re-run unless you explicitly want to change the fixture: the generated
// file is checked in and serves as a fixed reference for both sides (JS + Python).
'use strict'

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const rand = mulberry32(42)
const n = 300
const candles = []
let price = 100

for (let i = 0; i < n; i++) {
  // Normal case: random walk
  let ret = (rand() - 0.5) * 0.02
  // Deliberate flat zone (RSI loss=0, ATR range=0, StochRSI range=0): i in [80,90)
  if (i >= 80 && i < 90) ret = 0
  // Deliberate spike: i === 150
  if (i === 150) ret = 0.15
  price = Math.max(price * (1 + ret), 0.01)

  const open = price
  const high = open * (1 + rand() * 0.01)
  const low = open * (1 - rand() * 0.01)
  const close = low + rand() * (high - low)
  // Deliberate zero-volume zone (VWAP cumV===0 at the very start): i in [0,3)
  const volume = i < 3 ? 0 : rand() * 1000

  candles.push({
    open: +open.toFixed(6),
    high: +high.toFixed(6),
    low: +low.toFixed(6),
    close: +close.toFixed(6),
    volume: +volume.toFixed(6),
  })
  price = close
}

require('fs').writeFileSync(
  require('path').join(__dirname, 'candles.json'),
  JSON.stringify(candles, null, 2)
)
console.log(`candles.json generated (${n} candles)`)