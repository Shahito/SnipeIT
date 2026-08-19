const crypto = require('crypto')
const prisma = require('../utils/prisma')
const { resolveSweep } = require('../utils/sweepEngine')
const { SWEEP_WARNING_THRESHOLD, SWEEP_ALL_RUNS_THRESHOLD } = require('../config/sweep')
const { CATEGORIES, categoryOf } = require('../config/coinCategories')
const { emitToUser } = require('../utils/eventBus')

function stableStringify(value) {
  if (value instanceof Date) return JSON.stringify(value.toISOString())
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function computeResultHash(snapshot) {
  return crypto.createHash('sha256').update(stableStringify(snapshot)).digest('hex')
}

// Champs potentiellement sweepables (voir strategyService.validateStrategy).
function buildDefinition(strategy) {
  return {
    pairs:             strategy.pairs,
    timeframe:         strategy.timeframe,
    positionSize:      strategy.positionSize,
    stopLoss:          strategy.stopLoss,
    takeProfit:        strategy.takeProfit,
    trailingStopLoss:  strategy.trailingStopLoss,
    slType:            strategy.slType,
    tpType:            strategy.tpType,
    atrPeriod:         strategy.atrPeriod,
    conditions:        strategy.conditions,
  }
}

// Reconstruit un strategySnapshot 100% résolu (aucun marqueur sweep) pour UN run.
// C'est ce snapshot, jamais la ligne `Strategy` vivante, qui est envoyé au worker.
function buildSnapshot(strategy, combo) {
  return {
    name:             strategy.name,
    pair:             combo.pair,
    timeframe:        combo.resolved.timeframe,
    startDate:        strategy.startDate,
    endDate:          strategy.endDate,
    initialCapital:   strategy.initialCapital,
    positionSize:     combo.resolved.positionSize,
    feeMaker:         strategy.feeMaker,
    feeTaker:         strategy.feeTaker,
    tradingHours:     strategy.tradingHours,
    stopLoss:         combo.resolved.stopLoss,
    trailingStopLoss: combo.resolved.trailingStopLoss,
    takeProfit:       combo.resolved.takeProfit,
    slType:           combo.resolved.slType,
    tpType:           combo.resolved.tpType,
    atrPeriod:        combo.resolved.atrPeriod,
    conditions:       combo.resolved.conditions,
  }
}

// Aperçu (pour le front, avant confirmation) : nombre de combinaisons + détail des axes.
async function previewSweep(strategyId, userId) {
  const strategy = await prisma.strategy.findFirst({ where: { id: strategyId, userId } })
  if (!strategy) throw new Error('STRATEGY_NOT_FOUND')

  const { totalRuns, axes } = resolveSweep(buildDefinition(strategy)) // throws SWEEP_TOO_LARGE si > max
  return {
    totalRuns,
    axes: axes.map(a => ({ path: a.path, count: a.values.length, values: a.values })),
    requiresConfirmation: totalRuns > SWEEP_WARNING_THRESHOLD,
  }
}

async function launchSweep(strategyId, userId, { confirmLarge = false } = {}) {
  const strategy = await prisma.strategy.findFirst({ where: { id: strategyId, userId } })
  if (!strategy) throw new Error('STRATEGY_NOT_FOUND')

  const active = await prisma.backtestJob.findFirst({
    where: { strategyId, status: { in: ['pending', 'running'] } },
  })
  if (active) throw new Error('JOB_ALREADY_RUNNING')

  const definition = buildDefinition(strategy)
  const { totalRuns, combinations } = resolveSweep(definition) // throws SWEEP_TOO_LARGE if > max

  if (totalRuns > SWEEP_WARNING_THRESHOLD && !confirmLarge) {
    const err = new Error('SWEEP_CONFIRMATION_REQUIRED')
    err.totalRuns = totalRuns
    throw err
  }

  const sweepGroup = await prisma.sweepGroup.create({
    data: {
      strategyId,
      userId,
      name:               strategy.name,
      definitionSnapshot: definition,
      totalRuns,
      status: 'pending',
    },
  })

   const resolvedByHash = new Map()
  const snapshots = combinations.map(combo => {
    const snapshot = buildSnapshot(strategy, combo)
    const hash = computeResultHash(snapshot)
    resolvedByHash.set(hash, true)
    return { combo, snapshot, hash }
  })

  const reusableJobs = await prisma.backtestJob.findMany({
    where: { strategyId, status: 'done', resultHash: { in: [...resolvedByHash.keys()] } },
    orderBy: { completedAt: 'desc' },
  })
  const reuseByHash = new Map()
  for (const job of reusableJobs) {
    if (!reuseByHash.has(job.resultHash)) reuseByHash.set(job.resultHash, job)
  }

  await prisma.backtestJob.createMany({
    data: snapshots.map(({ combo, snapshot, hash }) => {
      const existing = reuseByHash.get(hash)
      if (existing) {
        return {
          strategyId,
          sweepGroupId:     sweepGroup.id,
          pair:             combo.pair,
          paramValues:      combo.paramValues,
          status:           'done',
          strategySnapshot: snapshot,
          resultHash:       hash,
          reusedFromJobId:  existing.id,
          completedAt:      new Date(),
          result:           existing.result,
          pnlPercent:       existing.pnlPercent,
          pnlAbsolute:      existing.pnlAbsolute,
          finalCapital:     existing.finalCapital,
          initialCapital:   existing.initialCapital,
          totalTrades:      existing.totalTrades,
          winRate:          existing.winRate,
          maxDrawdown:      existing.maxDrawdown,
          sharpeRatio:      existing.sharpeRatio,
          durationDays:     existing.durationDays,
          profitFactor:     existing.profitFactor,
        }
      }
      return {
        strategyId,
        sweepGroupId:     sweepGroup.id,
        pair:             combo.pair,
        paramValues:      combo.paramValues,
        status:           'pending',
        strategySnapshot: snapshot,
        resultHash:       hash,
      }
    }),
  })

  await refreshSweepGroupStatus(sweepGroup.id)

  return prisma.sweepGroup.findUnique({ where: { id: sweepGroup.id }, include: { jobs: true } })
}

async function listSweeps(userId) {
  return prisma.sweepGroup.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true, name: true, totalRuns: true, status: true, createdAt: true, completedAt: true,
      strategy: { select: { id: true, name: true } },
      _count: { select: { jobs: true } },
    },
  })
}

function statsFor(jobs) {
  const vals = jobs.map(j => j.pnlPercent).filter(v => v !== null && v !== undefined)
  if (vals.length === 0) return null

  const avg = vals.reduce((a, b) => a + b, 0) / vals.length
  const sorted = [...vals].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const median = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
  const variance = vals.reduce((a, b) => a + (b - avg) ** 2, 0) / vals.length

  return {
    count:           vals.length,
    avgPnlPercent:    avg,
    medianPnlPercent: median,
    stdPnlPercent:    Math.sqrt(variance),
    pctProfitable:    (vals.filter(v => v > 0).length / vals.length) * 100,
    bestPnlPercent:   Math.max(...vals),
    worstPnlPercent:  Math.min(...vals),
  }
}

async function getSweepGroup(id, userId) {
  const group = await prisma.sweepGroup.findFirst({
    where: { id, userId },
    include: {
      jobs: {
        select: {
          id: true,
          status: true,
          pair: true,
          paramValues: true,
          pnlPercent: true,
          pnlAbsolute: true,
          initialCapital: true,
          finalCapital: true,
          totalTrades: true,
          winRate: true,
          maxDrawdown: true,
          sharpeRatio: true,
          jobTags: { include: { tag: true } },
        },
      },
      strategy: { select: { id: true, name: true } },
    },
  })
  if (!group) throw new Error('SWEEP_NOT_FOUND')

  const jobs = group.jobs
  const done = jobs.filter(j => j.status === 'done')
  
  const byCatMap = new Map() // key -> { key, name, jobs: [] }
  const uncategorized = []
  done.forEach(j => {
    const base = (j.pair || '').split('/')[0]
    const catKey = categoryOf(base)
    if (!catKey) { uncategorized.push(j); return }
    if (!byCatMap.has(catKey)) {
      const cat = CATEGORIES.find(c => c.key === catKey)
      byCatMap.set(catKey, { key: catKey, name: cat?.label || catKey, jobs: [] })
    }
    byCatMap.get(catKey).jobs.push(j)
  })
  const byCategory = [...byCatMap.values()].map(c => ({
    categoryId: c.key,
    name:       c.name,
    stats:      statsFor(c.jobs),
  }))
  byCategory.push({
    categoryId: null,
    name:       'Non catégorisé',
    stats:      statsFor(uncategorized),
  })

  // Sensibilité par paramètre : PnL moyen groupé par valeur, pour chaque axe sweepé (hors pair).
  const paramPaths = [...new Set(jobs.flatMap(j => Object.keys(j.paramValues || {})))]
  const sensitivity = paramPaths.map(path => {
    const byValue = new Map()
    done.forEach(j => {
      const v = j.paramValues?.[path]
      
      if (v === undefined) return
      const key = JSON.stringify(v)
      if (!byValue.has(key)) byValue.set(key, [])
      byValue.get(key).push(j)
    })
    return {
      path,
      values: [...byValue.entries()].map(([key, list]) => ({ value: JSON.parse(key), stats: statsFor(list) })),
    }
  })

  const byPnl = (a, b) => (b.pnlPercent ?? -Infinity) - (a.pnlPercent ?? -Infinity)
  const smallSweep = done.length <= SWEEP_ALL_RUNS_THRESHOLD

  return {
    id: group.id,
    strategy: group.strategy,
    status: group.status,
    totalRuns: group.totalRuns,
    createdAt: group.createdAt,
    completedAt: group.completedAt,
    definition: group.definitionSnapshot,
    counts: {
      done: done.length,
      pending: jobs.filter(j => j.status === 'pending').length,
      running: jobs.filter(j => j.status === 'running').length,
      error: jobs.filter(j => j.status === 'error').length,
    },
    global: statsFor(done),
    byCategory,
    sensitivity,
    ...(smallSweep
      ? { all: [...done].sort(byPnl) }
      : { best: [...done].sort(byPnl).slice(0, 10), worst: [...done].sort(byPnl).slice(-10).reverse() }),
  }
}

// Called after every status transition of a BacktestJob attached to a sweep
async function refreshSweepGroupStatus(sweepGroupId) {
  if (!sweepGroupId) return
  const jobs = await prisma.backtestJob.findMany({ where: { sweepGroupId }, select: { status: true } })
  const allTerminal = jobs.every(j => j.status === 'done' || j.status === 'error')

  if (!allTerminal) {
    const g = await prisma.sweepGroup.update({
      where: { id: sweepGroupId },
      data: { status: 'running' },
      select: { id: true, userId: true, status: true },
    })
    emitToUser(g.userId, 'sweep:update', { sweepGroupId: g.id, status: g.status })
    return
  }

  const anyDone = jobs.some(j => j.status === 'done')
  const allDone = jobs.every(j => j.status === 'done')
  const g = await prisma.sweepGroup.update({
    where: { id: sweepGroupId },
    data: {
      status: allDone ? 'done' : (anyDone ? 'partial_error' : 'error'),
      completedAt: new Date(),
    },
    select: { id: true, userId: true, status: true },
  })
  emitToUser(g.userId, 'sweep:update', { sweepGroupId: g.id, status: g.status })
}

module.exports = { previewSweep, launchSweep, listSweeps, getSweepGroup, refreshSweepGroupStatus }
