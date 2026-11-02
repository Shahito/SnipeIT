const prisma = require('../utils/prisma')
const { isSweepMarker } = require('../utils/sweepEngine')
const { validateExits, normalizeExits, normalizeExecution } = require('../utils/exitsModel')
const { STRATEGY_NAME_MAX_LENGTH, STRATEGY_DESCRIPTION_MAX_LENGTH } = require('../config/strategy')
const { MAX_STRATEGIES, MAX_STRATEGIES_PER_HOUR } = require('../config/quotas')
const { refreshSweepGroupStatus } = require('./sweepService')

// Appends a suffix (" (copy)", " (snapshot)") to a base name while guaranteeing the
// result never exceeds STRATEGY_NAME_MAX_LENGTH. Trims the *base* name rather than the
// suffix
function appendSuffixTruncated(base, suffix) {
  const maxBaseLength = Math.max(STRATEGY_NAME_MAX_LENGTH - suffix.length, 0)
  return `${(base || '').slice(0, maxBaseLength)}${suffix}`
}

// Returns the values to validate for a potentially sweepable field:
// scalar -> [value]; { sweep: [...] } -> the array itself.
function sweepValues(v) {
  return isSweepMarker(v) ? v.sweep : [v]
}

// Normalizes a sweepable Json field while keeping its shape (scalar or { sweep: [...] })
// while casting each numeric value (parseFloat by default, custom parser optional).
function normalizeNumber(v, parser = parseFloat) {
  if (isSweepMarker(v)) return { sweep: v.sweep.map(x => parser(x)) }
  return parser(v)
}

async function listStrategies(userId) {
  return prisma.strategy.findMany({
    where: { userId, deletedAt: null },
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true, name: true, description: true,
      pairs: true, timeframe: true, startDate: true, endDate: true,
      jobs: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: {
          id: true, status: true, pnlPercent: true,
          sweepGroup: { select: { id: true, totalRuns: true, status: true } },
        },
      },
    },
  })
}

async function getStrategy(id, userId) {
  const s = await prisma.strategy.findFirst({ where: { id, userId, deletedAt: null } })
  if (!s) throw new Error('STRATEGY_NOT_FOUND')
  return s
}

// Feeds the "Deleted items" trash panel
async function listDeletedStrategies(userId) {
  return prisma.strategy.findMany({
    where: { userId, deletedAt: { not: null } },
    orderBy: { deletedAt: 'desc' },
    select: { id: true, name: true, deletedAt: true },
  })
}

const VALID_TIMEFRAMES = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '3d', '1w']

function validateConditions(conditions) {
  if (!conditions || typeof conditions !== 'object') throw new Error('CONDITIONS_INVALID')
  if (!Array.isArray(conditions.entry)) throw new Error('CONDITIONS_INVALID')
  if (!Array.isArray(conditions.exit)) throw new Error('CONDITIONS_INVALID')
  const validIndicators = [
    'RSI', 'EMA', 'SMA', 'MACD', 'MACD_SIGNAL', 'MACD_HIST',
    'STOCH_RSI_K', 'STOCH_RSI_D', 'BB_UPPER', 'BB_LOWER', 'BB_MID',
    'ATR', 'VWAP', 'CLOSE', 'VOLUME', 'HIGH', 'LOW', 'OPEN',
  ]
  const indicatorsWithSources = ['EMA', 'SMA']
  const validSources = ['VOLUME', 'CLOSE', 'HIGH', 'LOW', 'OPEN']
  const validOperators = ['>', '<', '>=', '<=', '==', 'cross_above', 'cross_below']

  // Structural fields (never sweepable): indicator, operator, valueIndicator.
  // Sweepable fields: period, source, valueIndicatorSource, valueMultiplier, value.
  const validateRule = (rule) => {
    if (isSweepMarker(rule.indicator) || isSweepMarker(rule.operator) || isSweepMarker(rule.valueIndicator))
      throw new Error('CONDITIONS_INVALID')

    if (rule.enabled !== undefined) {
      const flags = isSweepMarker(rule.enabled) ? rule.enabled.sweep : [rule.enabled]
      if (!flags.length || !flags.every(v => typeof v === 'boolean')) throw new Error('CONDITIONS_INVALID')
    }

    if (!rule.indicator || !validIndicators.includes(rule.indicator)) throw new Error('CONDITIONS_INVALID')
    if (!rule.operator || !validOperators.includes(rule.operator)) throw new Error('CONDITIONS_INVALID')

    if (rule.period !== undefined && rule.period !== null) {
      sweepValues(rule.period).forEach(p => {
        const n = parseInt(p)
        if (isNaN(n) || n < 1 || n > 500) throw new Error('CONDITIONS_INVALID')
      })
    }

    // Rule timeframes end up in cache directory names: whitelist only
    for (const field of ['timeframe', 'valueIndicatorTimeframe']) {
      const v = rule[field]
      if (v !== undefined && v !== null && v !== '') {
        sweepValues(v).forEach(tf => {
          if (!VALID_TIMEFRAMES.includes(tf)) throw new Error('CONDITIONS_INVALID')
        })
      }
    }

    if (rule.source !== undefined && rule.source !== null) {
      if (!indicatorsWithSources.includes(rule.indicator)) throw new Error('CONDITIONS_INVALID')
      sweepValues(rule.source).forEach(s => {
        if (!validSources.includes(s)) throw new Error('CONDITIONS_INVALID')
      })
    }
    if (rule.valueIndicator) {
      if (!validIndicators.includes(rule.valueIndicator)) throw new Error('CONDITIONS_INVALID')
      if (rule.valueIndicatorSource !== undefined && rule.valueIndicatorSource !== null) {
        if (!indicatorsWithSources.includes(rule.valueIndicator)) throw new Error('CONDITIONS_INVALID')
        sweepValues(rule.valueIndicatorSource).forEach(s => {
          if (!validSources.includes(s)) throw new Error('CONDITIONS_INVALID')
        })
      }
      if (rule.valueMultiplier !== undefined && rule.valueMultiplier !== null) {
        sweepValues(rule.valueMultiplier).forEach(m => {
          const v = parseFloat(m)
          if (isNaN(v) || v <= 0) throw new Error('CONDITIONS_INVALID')
        })
      }
    } else {
      if (rule.value === undefined || rule.value === null) throw new Error('CONDITIONS_INVALID')
      if (sweepValues(rule.value).length === 0) throw new Error('CONDITIONS_INVALID')
    }
    return true
  }

  // Support two formats:
  //   - Flat (retro-compat): [rule, rule, ...]           -> implicit AND
  //   - Groups (OR/AND)    : [[rule, rule], [rule], ...] -> OR between groups, AND within each group
  const validateGroup = (group) => {
    if (Array.isArray(group)) {
      // AND Group
      if (group.length === 0) return // Ignore empty groups
      group.forEach(validateRule)
    } else {
      // Direct rule (flat retro-compat format)
      validateRule(group)
    }
  }

  conditions.entry.forEach(validateGroup)
  conditions.exit.forEach(validateGroup)
}

function validateStrategy(data) {
  const { name, pairs, timeframe, startDate, endDate, initialCapital, positionSize, conditions } = data

  if (!name || name.trim().length < 2) throw new Error('NAME_REQUIRED')
  if (name.trim().length > STRATEGY_NAME_MAX_LENGTH) throw new Error('NAME_TOO_LONG')

  if (data.description != null && data.description.trim().length > STRATEGY_DESCRIPTION_MAX_LENGTH)
    throw new Error('DESCRIPTION_TOO_LONG')

  // pairs: always an array (length 1 = single run). Treated as a sweep axis
  // just like the others (see sweepEngine).
  if (!Array.isArray(pairs) || pairs.length === 0) throw new Error('PAIRS_INVALID')
  pairs.forEach(p => {
    if (typeof p !== 'string' || !/^[A-Z0-9]{1,20}\/[A-Z0-9]{1,20}$/.test(p)) throw new Error('PAIRS_INVALID')
  })

  const validTimeframes = VALID_TIMEFRAMES
  sweepValues(timeframe).forEach(tf => {
    if (!validTimeframes.includes(tf)) throw new Error('TIMEFRAME_INVALID')
  })

  // Not sweepable: fixed dates for the whole SweepGroup.
  if (typeof startDate === 'object') throw new Error('DATE_INVALID')
  if (typeof endDate === 'object') throw new Error('DATE_INVALID')
  const start = new Date(startDate)
  const end = new Date(endDate)
  if (isNaN(start.getTime())) throw new Error('DATE_INVALID')
  if (isNaN(end.getTime())) throw new Error('DATE_INVALID')
  if (end <= start) throw new Error('DATE_RANGE_INVALID')
  // Binance spot starts in July 2017, end date at most tomorrow
  if (start < new Date('2017-07-01T00:00:00Z')) throw new Error('DATE_RANGE_INVALID')
  if (end > new Date(Date.now() + 24 * 60 * 60 * 1000)) throw new Error('DATE_RANGE_INVALID')

  // Not sweepable: fixed starting capital.
  // Finite number only: a string like "abc" used to slip through and become NaN
  const capital = typeof initialCapital === 'string' ? Number(initialCapital) : initialCapital
  if (typeof capital !== 'number' || !Number.isFinite(capital) || capital <= 0 || capital > 1_000_000)
    throw new Error('CAPITAL_INVALID')

  sweepValues(positionSize).forEach(ps => {
    const v = parseFloat(ps)
    if (!v || v <= 0 || v > 100) throw new Error('POSITION_SIZE_INVALID')
  })

  validateExits(data.exits, data.execution)

  // Not sweepable: fixed fees for the whole SweepGroup (existing validation is enough:
  // a {sweep:[...]} object already fails parseFloat -> NaN -> FEE_INVALID).
  if (data.feeTaker !== undefined && data.feeTaker !== null) {
    const v = parseFloat(data.feeTaker)
    if (isNaN(v) || v < 0 || v > 10) throw new Error('FEE_INVALID')
  }
  if (data.feeMaker !== undefined && data.feeMaker !== null) {
    const v = parseFloat(data.feeMaker)
    if (isNaN(v) || v < 0 || v > 10) throw new Error('FEE_INVALID')
  }
  if (data.tradingHours !== undefined && data.tradingHours !== null) {
    if (!Array.isArray(data.tradingHours)) throw new Error('TRADING_HOURS_INVALID')
    const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/
    for (const slot of data.tradingHours) {
      if (!slot || typeof slot.start !== 'string' || typeof slot.end !== 'string') throw new Error('TRADING_HOURS_INVALID')
      if (!timeRe.test(slot.start) || !timeRe.test(slot.end)) throw new Error('TRADING_HOURS_INVALID')
      if (slot.start >= slot.end) throw new Error('TRADING_HOURS_INVALID')
      if (slot.blockSell !== undefined && typeof slot.blockSell !== 'boolean') throw new Error('TRADING_HOURS_INVALID')
    }
  }
  validateConditions(conditions)
}

// Total cap and hourly creation rate, shared by create and both clones
async function assertStrategyQuota(userId) {
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000)
  const [total, lastHour] = await Promise.all([
    prisma.strategy.count({ where: { userId, deletedAt: null } }),
    prisma.strategy.count({ where: { userId, createdAt: { gt: hourAgo } } }),
  ])
  if (total >= MAX_STRATEGIES) throw new Error('QUOTA_EXCEEDED')
  if (lastHour >= MAX_STRATEGIES_PER_HOUR) throw new Error('RATE_LIMIT_EXCEEDED')
}

async function createStrategy(userId, data) {
  validateStrategy(data)
  await assertStrategyQuota(userId)

  return prisma.strategy.create({
    data: {
      userId,
      name: data.name.trim(),
      description: data.description?.trim() || null,
      pairs: [...new Set(data.pairs)],
      timeframe: data.timeframe,
      startDate: new Date(data.startDate),
      endDate: new Date(data.endDate),
      initialCapital: parseFloat(data.initialCapital),
      positionSize: normalizeNumber(data.positionSize),
      exits: normalizeExits(data.exits),
      execution: normalizeExecution(data.execution),
      feeTaker: data.feeTaker !== undefined ? parseFloat(data.feeTaker) : 0.0,
      feeMaker: data.feeMaker !== undefined ? parseFloat(data.feeMaker) : 0.0,
      tradingHours: data.tradingHours ?? null,
      conditions: data.conditions,
    },
  })
}

async function updateStrategy(id, userId, data) {
  const existing = await prisma.strategy.findFirst({ where: { id, userId, deletedAt: null } })
  if (!existing) throw new Error('STRATEGY_NOT_FOUND')
  
  validateStrategy(data)

  return prisma.strategy.update({
    where: { id },
    data: {
      name: data.name.trim(),
      description: data.description?.trim() || null,
      pairs: [...new Set(data.pairs)],
      timeframe: data.timeframe,
      startDate: new Date(data.startDate),
      endDate: new Date(data.endDate),
      initialCapital: parseFloat(data.initialCapital),
      positionSize: normalizeNumber(data.positionSize),
      exits: normalizeExits(data.exits),
      execution: normalizeExecution(data.execution),
      feeTaker: data.feeTaker !== undefined ? parseFloat(data.feeTaker) : 0.0,
      feeMaker: data.feeMaker !== undefined ? parseFloat(data.feeMaker) : 0.0,
      tradingHours: data.tradingHours ?? null,
      conditions: data.conditions,
    },
  })
}

async function cloneStrategy(id, userId) {
  const original = await prisma.strategy.findFirst({ where: { id, userId, deletedAt: null } })
  if (!original) throw new Error('STRATEGY_NOT_FOUND')
  await assertStrategyQuota(userId)

  const { id: _id, createdAt: _c, updatedAt: _u, deletedAt: _d, ...rest } = original

  return prisma.strategy.create({
    data: {
      ...rest,
      name: appendSuffixTruncated(original.name, ' (copy)'),
      clonedFrom: original.id,
    },
  })
}

async function cloneFromSnapshot(jobId, userId) {
  const job = await prisma.backtestJob.findFirst({
    where: { id: jobId, strategy: { userId, deletedAt: null } },
    include: { strategy: { select: { id: true } } },
  })

  if (!job) throw new Error('JOB_NOT_FOUND')
  if (!job.strategySnapshot) throw new Error('SNAPSHOT_NOT_FOUND')
  await assertStrategyQuota(userId)

  const snap = job.strategySnapshot
  // A job snapshot is ALWAYS a resolved run (single pair, no sweep marker).
  const { id: _id, createdAt: _c, updatedAt: _u, userId: _uid, pair: snapPair, ...rest } = snap

  return prisma.strategy.create({
    data: {
      ...rest,
      pairs: [snapPair],
      userId,
      name: appendSuffixTruncated(snap.name, ' (snapshot)'),
      clonedFrom: job.strategy.id,
    },
  })
}

// A soft-deleted strategy is recoverable via restoreStrategy()
const STRATEGY_TRASH_GRACE_MS = 24 * 60 * 60 * 1000

async function deleteStrategy(id, userId) {
  const existing = await prisma.strategy.findFirst({ where: { id, userId, deletedAt: null } })
  if (!existing) throw new Error('STRATEGY_NOT_FOUND')
  // Cancel pending jobs so their sweeps do not hang in "pending" while the strategy is in the trash
  // The row lock keeps a concurrent launchSweep from adding jobs in between
  const groupIds = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM Strategy WHERE id = ${id} FOR UPDATE`
    const pending = await tx.backtestJob.findMany({
      where: { strategyId: id, status: 'pending' },
      select: { sweepGroupId: true },
    })
    await tx.backtestJob.updateMany({
      where: { strategyId: id, status: 'pending' },
      data: { status: 'error', completedAt: new Date(), lastApiKeyId: null, errorMessage: 'Strategy deleted' },
    })
    await tx.strategy.update({ where: { id }, data: { deletedAt: new Date() } })
    return [...new Set(pending.map(j => j.sweepGroupId))]
  })
  await Promise.all(groupIds.map(gid => refreshSweepGroupStatus(gid, { silent: true })))
  return true
}

async function restoreStrategy(id, userId) {
  const existing = await prisma.strategy.findFirst({ where: { id, userId, deletedAt: { not: null } } })
  if (!existing) throw new Error('STRATEGY_NOT_FOUND')
  await prisma.strategy.update({ where: { id }, data: { deletedAt: null } })
  return true
}

// Cron-driven (app.js, hourly): hard-deletes anything past its grace period.
// Cascades to BacktestJob/SweepGroup via the schema's onDelete: Cascade,
// same end result as the old immediate hard-delete, just deferred.
async function purgeSoftDeletedStrategies() {
  const cutoff = new Date(Date.now() - STRATEGY_TRASH_GRACE_MS)
  // Leave a strategy alone while a worker is still computing one of its jobs
  await prisma.strategy.deleteMany({
    where: { deletedAt: { lt: cutoff }, jobs: { none: { status: 'running' } } },
  })
}

module.exports = {
  listStrategies, listDeletedStrategies, getStrategy, createStrategy, updateStrategy, cloneStrategy, cloneFromSnapshot,
  deleteStrategy, restoreStrategy, purgeSoftDeletedStrategies,
}
