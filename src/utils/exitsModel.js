// Shape of `exits` / `execution`: see docs/exits.md

const { isSweepMarker } = require('./sweepEngine')

const LEG_TYPES = {
  sl:  ['percent', 'atr'],
  tsl: ['percent', 'atr'],
  tp:  ['percent', 'atr', 'r'],
}
const LEG_ORDERS = {
  sl:     ['stop_market'],
  tsl:    ['stop_market'],
  tp:     ['limit', 'market'],
  signal: ['market'],
}
const TP_MODES = ['fixed', 'trailing']
const SLIPPAGE_MAX = 5 // percent

const DEFAULT_ORDER = { sl: 'stop_market', tsl: 'stop_market', tp: 'limit', signal: 'market' }

function defaultExits() {
  return {
    atrPeriod: 14,
    sl:     { enabled: false, type: 'percent', value: null, order: DEFAULT_ORDER.sl },
    tsl:    { enabled: false, type: 'percent', value: null, order: DEFAULT_ORDER.tsl },
    tp:     { enabled: false, mode: 'fixed', type: 'percent', value: null, order: DEFAULT_ORDER.tp },
    signal: { order: DEFAULT_ORDER.signal },
  }
}

function defaultExecution() {
  return { slippage: 0 }
}

function sweepValues(v) {
  return isSweepMarker(v) ? v.sweep : [v]
}

function mapSweep(v, fn) {
  return isSweepMarker(v) ? { sweep: v.sweep.map(fn) } : fn(v)
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v) && !isSweepMarker(v)
}

function isPositiveNumber(v) {
  const n = typeof v === 'string' ? parseFloat(v) : v
  return typeof n === 'number' && Number.isFinite(n) && n > 0
}

function validateLeg(key, leg) {
  if (!isPlainObject(leg)) throw new Error('EXITS_INVALID')
  if (typeof leg.enabled !== 'boolean') throw new Error('EXITS_INVALID')

  if (key === 'tp' && leg.mode !== undefined) {
    if (!TP_MODES.includes(leg.mode)) throw new Error('TP_MODE_INVALID')
  }
  if (key === 'tp' && leg.mode === 'trailing') return
  if (!leg.enabled) return

  sweepValues(leg.type ?? 'percent').forEach(t => {
    if (!LEG_TYPES[key].includes(t)) throw new Error('RISK_TYPE_INVALID')
  })
  sweepValues(leg.order ?? DEFAULT_ORDER[key]).forEach(o => {
    if (!LEG_ORDERS[key].includes(o)) throw new Error('EXIT_ORDER_INVALID')
  })
  if (leg.value === undefined || leg.value === null) {
    throw new Error(key === 'tsl' ? 'TRAILING_STOP_INVALID' : 'EXIT_VALUE_INVALID')
  }
  sweepValues(leg.value).forEach(v => {
    if (!isPositiveNumber(v)) throw new Error(key === 'tsl' ? 'TRAILING_STOP_INVALID' : 'EXIT_VALUE_INVALID')
  })
}

function validateExits(exits, execution) {
  if (exits !== undefined && exits !== null) {
    if (!isPlainObject(exits)) throw new Error('EXITS_INVALID')

    if (exits.atrPeriod !== undefined && exits.atrPeriod !== null) {
      sweepValues(exits.atrPeriod).forEach(v => {
        const n = Number(v)
        if (!Number.isInteger(n) || n < 1 || n > 200) throw new Error('ATR_PERIOD_INVALID')
      })
    }

    for (const key of ['sl', 'tsl', 'tp']) {
      if (exits[key] !== undefined && exits[key] !== null) validateLeg(key, exits[key])
    }

    const signal = exits.signal
    if (signal !== undefined && signal !== null) {
      if (!isPlainObject(signal)) throw new Error('EXITS_INVALID')
      sweepValues(signal.order ?? DEFAULT_ORDER.signal).forEach(o => {
        if (!LEG_ORDERS.signal.includes(o)) throw new Error('EXIT_ORDER_INVALID')
      })
    }

    const tp = exits.tp
    if (tp && tp.enabled && tp.mode !== 'trailing' && sweepValues(tp.type).includes('r')) {
      const hasStop = (exits.sl && exits.sl.enabled) || (exits.tsl && exits.tsl.enabled)
      if (!hasStop) throw new Error('TP_R_NEEDS_STOP')
    }
  }

  if (execution !== undefined && execution !== null) {
    if (!isPlainObject(execution)) throw new Error('EXITS_INVALID')
    if (execution.slippage !== undefined && execution.slippage !== null) {
      sweepValues(execution.slippage).forEach(v => {
        const n = typeof v === 'string' ? parseFloat(v) : v
        if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > SLIPPAGE_MAX) throw new Error('SLIPPAGE_INVALID')
      })
    }
  }
}

function normalizeLeg(key, leg) {
  const def = defaultExits()[key]
  const src = isPlainObject(leg) ? leg : {}
  const out = {
    enabled: src.enabled === true,
    type:    src.type ?? def.type,
    value:   src.value != null ? mapSweep(src.value, parseFloat) : null,
    order:   src.order ?? def.order,
  }
  if (key === 'tp') {
    out.mode = src.mode ?? 'fixed'
    return { enabled: out.enabled, mode: out.mode, type: out.type, value: out.value, order: out.order }
  }
  return out
}

function normalizeExits(exits) {
  const src = isPlainObject(exits) ? exits : {}
  return {
    atrPeriod: src.atrPeriod != null ? mapSweep(src.atrPeriod, v => parseInt(v)) : 14,
    sl:     normalizeLeg('sl', src.sl),
    tsl:    normalizeLeg('tsl', src.tsl),
    tp:     normalizeLeg('tp', src.tp),
    signal: { order: isPlainObject(src.signal) && src.signal.order != null ? src.signal.order : DEFAULT_ORDER.signal },
  }
}

function normalizeExecution(execution) {
  const src = isPlainObject(execution) ? execution : {}
  return { slippage: src.slippage != null ? mapSweep(src.slippage, parseFloat) : 0 }
}

function usesTrailingTp(exits) {
  return !!(exits && exits.tp && exits.tp.enabled && exits.tp.mode === 'trailing')
}

module.exports = {
  LEG_TYPES, LEG_ORDERS, TP_MODES, SLIPPAGE_MAX,
  defaultExits, defaultExecution,
  validateExits, normalizeExits, normalizeExecution, usesTrailingTp,
}