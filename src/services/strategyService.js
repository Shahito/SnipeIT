const prisma = require('../utils/prisma')
const { isSweepMarker } = require('../utils/sweepEngine')

// Retourne les valeurs à valider pour un champ potentiellement sweepable :
// scalaire -> [valeur] ; { sweep: [...] } -> le tableau lui-même.
function sweepValues(v) {
  return isSweepMarker(v) ? v.sweep : [v]
}

// Normalise un champ Json sweepable en conservant sa forme (scalaire ou { sweep: [...] })
// tout en castant chaque valeur numérique (parseFloat par défaut, parser au choix).
function normalizeNumber(v, parser = parseFloat) {
  if (isSweepMarker(v)) return { sweep: v.sweep.map(x => parser(x)) }
  return parser(v)
}

async function listStrategies(userId) {
  return prisma.strategy.findMany({
    where: { userId },
    orderBy: { updatedAt: 'desc' },
    include: {
      jobs: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: {
          id: true, status: true, createdAt: true, completedAt: true, pnlPercent: true,
          sweepGroupId: true,
          sweepGroup: { select: { id: true, totalRuns: true } },
        },
      },
    },
  })
}

async function getStrategy(id, userId) {
  const s = await prisma.strategy.findFirst({ where: { id, userId } })
  if (!s) throw new Error('STRATEGY_NOT_FOUND')
  return s
}

function validateConditions(conditions) {
  if (!conditions || typeof conditions !== 'object') throw new Error('CONDITIONS_INVALID')
  if (!Array.isArray(conditions.entry)) throw new Error('CONDITIONS_INVALID')
  if (!Array.isArray(conditions.exit))  throw new Error('CONDITIONS_INVALID')
  const validIndicators = [
    'RSI', 'EMA', 'SMA', 'MACD', 'MACD_SIGNAL', 'MACD_HIST',
    'STOCH_RSI_K', 'STOCH_RSI_D', 'BB_UPPER', 'BB_LOWER', 'BB_MID',
    'ATR', 'VWAP', 'CLOSE', 'VOLUME', 'HIGH', 'LOW', 'OPEN',
  ]
  const indicatorsWithSources = ['EMA', 'SMA']
  const validSources    = ['VOLUME', 'CLOSE', 'HIGH', 'LOW', 'OPEN']
  const validOperators  = ['>', '<', '>=', '<=', '==', 'cross_above', 'cross_below']

  // Champs structurels (jamais sweepables) : indicator, operator, valueIndicator.
  // Champs sweepables : period, source, valueIndicatorSource, valueMultiplier, value.
  const validateRule = (rule) => {
    if (isSweepMarker(rule.indicator) || isSweepMarker(rule.operator) || isSweepMarker(rule.valueIndicator))
      throw new Error('CONDITIONS_INVALID')

    if (!rule.indicator || !validIndicators.includes(rule.indicator)) throw new Error('CONDITIONS_INVALID')
    if (!rule.operator  || !validOperators.includes(rule.operator))   throw new Error('CONDITIONS_INVALID')

    if (rule.period !== undefined && rule.period !== null) {
      sweepValues(rule.period).forEach(p => {
        const n = parseInt(p)
        if (isNaN(n) || n < 1 || n > 500) throw new Error('CONDITIONS_INVALID')
      })
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

  // Supporter deux formats :
  //   - Plat (rétrocompat) : [rule, rule, ...]           → AND implicite
  //   - Groupes (OR/AND)   : [[rule, rule], [rule], ...] → OR entre groupes, AND dans chaque groupe
  const validateGroup = (group) => {
    if (Array.isArray(group)) {
      // Groupe AND
      if (group.length === 0) return // Ignore empty groups
      group.forEach(validateRule)
    } else {
      // Règle directe (format plat rétrocompat)
      validateRule(group)
    }
  }

  conditions.entry.forEach(validateGroup)
  conditions.exit.forEach(validateGroup)
}

function validateStrategy(data) {
  const { name, pairs, timeframe, startDate, endDate, initialCapital, positionSize, conditions } = data

  if (!name || name.trim().length < 2)          throw new Error('NAME_REQUIRED')
  if (name.trim().length > 70)                  throw new Error('NAME_TOO_LONG')

  // pairs : toujours un tableau (longueur 1 = run classique). Traité comme un axe
  // de sweep au même titre que les autres (voir sweepEngine).
  if (!Array.isArray(pairs) || pairs.length === 0) throw new Error('PAIRS_INVALID')
  pairs.forEach(p => {
    if (typeof p !== 'string' || !/^[A-Z0-9]+\/[A-Z0-9]+$/.test(p)) throw new Error('PAIRS_INVALID')
  })

  const validTimeframes = ['1m','5m','15m','30m','1h','2h','4h','6h','12h','1d','3d','1w']
  sweepValues(timeframe).forEach(tf => {
    if (!validTimeframes.includes(tf)) throw new Error('TIMEFRAME_INVALID')
  })

  // Non sweepable : dates fixes pour tout le SweepGroup.
  if (typeof startDate === 'object') throw new Error('DATE_INVALID')
  if (typeof endDate === 'object')   throw new Error('DATE_INVALID')
  const start = new Date(startDate)
  const end   = new Date(endDate)
  if (isNaN(start.getTime()))                    throw new Error('DATE_INVALID')
  if (isNaN(end.getTime()))                      throw new Error('DATE_INVALID')
  if (end <= start)                              throw new Error('DATE_RANGE_INVALID')

  // Non sweepable : capital de départ fixe.
  if (typeof initialCapital === 'object' || !initialCapital || initialCapital <= 0)
    throw new Error('CAPITAL_INVALID')

  sweepValues(positionSize).forEach(ps => {
    const v = parseFloat(ps)
    if (!v || v <= 0 || v > 100) throw new Error('POSITION_SIZE_INVALID')
  })

  const validRiskTypes = ['percent', 'atr']
  if (data.slType !== undefined && data.slType !== null) {
    sweepValues(data.slType).forEach(t => { if (!validRiskTypes.includes(t)) throw new Error('RISK_TYPE_INVALID') })
  }
  if (data.tpType !== undefined && data.tpType !== null) {
    sweepValues(data.tpType).forEach(t => { if (!validRiskTypes.includes(t)) throw new Error('RISK_TYPE_INVALID') })
  }
  if (data.trailingStopLoss !== undefined && data.trailingStopLoss !== null) {
    sweepValues(data.trailingStopLoss).forEach(v => {
      const n = parseFloat(v)
      if (isNaN(n) || n <= 0) throw new Error('TRAILING_STOP_INVALID')
    })
  }
  if (data.atrPeriod !== undefined && data.atrPeriod !== null) {
    sweepValues(data.atrPeriod).forEach(v => {
      const n = parseInt(v)
      if (isNaN(n) || n < 1 || n > 200) throw new Error('ATR_PERIOD_INVALID')
    })
  }
  // Non sweepable : fees fixes pour tout le SweepGroup (validation existante suffit :
  // un objet {sweep:[...]} échoue déjà parseFloat -> NaN -> FEE_INVALID).
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
    const timeRe = /^\d{2}:\d{2}$/
    for (const slot of data.tradingHours) {
      if (!slot.start || !slot.end)                    throw new Error('TRADING_HOURS_INVALID')
      if (!timeRe.test(slot.start) || !timeRe.test(slot.end)) throw new Error('TRADING_HOURS_INVALID')
      if (slot.start >= slot.end)                      throw new Error('TRADING_HOURS_INVALID')
      if (slot.blockSell !== undefined && typeof slot.blockSell !== 'boolean') throw new Error('TRADING_HOURS_INVALID')
    }
  }
  validateConditions(conditions)
}

async function createStrategy(userId, data) {
  validateStrategy(data)

  return prisma.strategy.create({
    data: {
      userId,
      name:           data.name.trim(),
      description:    data.description?.trim() || null,
      pairs:          [...new Set(data.pairs)],
      timeframe:      data.timeframe,
      startDate:      new Date(data.startDate),
      endDate:        new Date(data.endDate),
      initialCapital: parseFloat(data.initialCapital),
      positionSize:   normalizeNumber(data.positionSize),
      stopLoss:       data.stopLoss   != null ? normalizeNumber(data.stopLoss)   : null,
      takeProfit:     data.takeProfit != null ? normalizeNumber(data.takeProfit) : null,
      trailingStopLoss: data.trailingStopLoss != null ? normalizeNumber(data.trailingStopLoss) : null,
      slType:         data.slType     ?? 'percent',
      tpType:         data.tpType     ?? 'percent',
      atrPeriod:      data.atrPeriod  != null ? normalizeNumber(data.atrPeriod, parseInt) : 14,
      feeTaker:       data.feeTaker  !== undefined ? parseFloat(data.feeTaker)  : 0.0,
      feeMaker:       data.feeMaker  !== undefined ? parseFloat(data.feeMaker)  : 0.0,
      tradingHours:   data.tradingHours ?? null,
      conditions:     data.conditions,
    },
  })
}

async function updateStrategy(id, userId, data) {
  const existing = await prisma.strategy.findFirst({ where: { id, userId } })
  if (!existing) throw new Error('STRATEGY_NOT_FOUND')

  validateStrategy(data)

  return prisma.strategy.update({
    where: { id },
    data: {
      name:           data.name.trim(),
      description:    data.description?.trim() || null,
      pairs:          [...new Set(data.pairs)],
      timeframe:      data.timeframe,
      startDate:      new Date(data.startDate),
      endDate:        new Date(data.endDate),
      initialCapital: parseFloat(data.initialCapital),
      positionSize:   normalizeNumber(data.positionSize),
      stopLoss:       data.stopLoss   != null ? normalizeNumber(data.stopLoss)   : null,
      takeProfit:     data.takeProfit != null ? normalizeNumber(data.takeProfit) : null,
      trailingStopLoss: data.trailingStopLoss != null ? normalizeNumber(data.trailingStopLoss) : null,
      slType:         data.slType     ?? 'percent',
      tpType:         data.tpType     ?? 'percent',
      atrPeriod:      data.atrPeriod  != null ? normalizeNumber(data.atrPeriod, parseInt) : 14,
      feeTaker:       data.feeTaker  !== undefined ? parseFloat(data.feeTaker)  : 0.0,
      feeMaker:       data.feeMaker  !== undefined ? parseFloat(data.feeMaker)  : 0.0,
      tradingHours:   data.tradingHours ?? null,
      conditions:     data.conditions,
    },
  })
}

async function cloneStrategy(id, userId) {
  const original = await prisma.strategy.findFirst({ where: { id, userId } })
  if (!original) throw new Error('STRATEGY_NOT_FOUND')

  const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = original

  return prisma.strategy.create({
    data: {
      ...rest,
      name:       `${original.name} (copie)`,
      clonedFrom: original.id,
    },
  })
}

async function cloneFromSnapshot(jobId, userId) {
  const job = await prisma.backtestJob.findFirst({
    where: { id: jobId, strategy: { userId } },
    include: { strategy: { select: { id: true } } },
  })
  
  if (!job) throw new Error('JOB_NOT_FOUND')
  if (!job.strategySnapshot) throw new Error('SNAPSHOT_NOT_FOUND')
  
  const snap = job.strategySnapshot
  // Un snapshot de job est TOUJOURS un run résolu (pair singulière, aucun marqueur sweep).
  const { id: _id, createdAt: _c, updatedAt: _u, userId: _uid, pair: snapPair, ...rest } = snap

  return prisma.strategy.create({
    data: {
      ...rest,
      pairs:      [snapPair],
      userId,
      name:       `${snap.name} (snapshot)`,
      clonedFrom: job.strategy.id,
    },
  })
}

async function deleteStrategy(id, userId) {
  const existing = await prisma.strategy.findFirst({ where: { id, userId } })
  if (!existing) throw new Error('STRATEGY_NOT_FOUND')
  await prisma.strategy.delete({ where: { id } })
  return true
}

module.exports = { listStrategies, getStrategy, createStrategy, updateStrategy, cloneStrategy, cloneFromSnapshot, deleteStrategy }