const prisma = require('../utils/prisma')

async function launchJob(strategyId, userId) {
  // Check if the strategy is owned by user
  const strategy = await prisma.strategy.findFirst({ where: { id: strategyId, userId } })
  if (!strategy) throw new Error('STRATEGY_NOT_FOUND')

  // Check if there is not already a pending/running job for this strategy
  const active = await prisma.backtestJob.findFirst({
    where: { strategyId, status: { in: ['pending', 'running'] } },
  })
  if (active) throw new Error('JOB_ALREADY_RUNNING')

  const strategySnapshot = {
    name:             strategy.name,
    pair:             strategy.pair,
    timeframe:        strategy.timeframe,
    startDate:        strategy.startDate,
    endDate:          strategy.endDate,
    initialCapital:   strategy.initialCapital,
    positionSize:     strategy.positionSize,
    feeMaker:         strategy.feeMaker,
    feeTaker:         strategy.feeTaker,
    tradingHours:     strategy.tradingHours,
    stopLoss:         strategy.stopLoss,
    trailingStopLoss: strategy.trailingStopLoss,
    takeProfit:       strategy.takeProfit,
    conditions:       strategy.conditions,
  }

  return prisma.backtestJob.create({
    data: { strategyId, status: 'pending', strategySnapshot },
  })
}

const JOB_TAGS_INCLUDE = { jobTags: { include: { tag: true } } }

async function listJobs(userId, { page = 1, limit = 20, sort = 'createdAt', order = 'desc', status = null } = {}) {
  const validSorts  = ['createdAt', 'pnlPercent', 'pnlAbsolute', 'winRate', 'maxDrawdown', 'sharpeRatio', 'profitFactor', 'totalTrades']
  const validOrders = ['asc', 'desc']
  const validStatus = ['pending', 'running', 'done', 'error']

  const sortField  = validSorts.includes(sort)   ? sort   : 'createdAt'
  const sortOrder  = validOrders.includes(order) ? order  : 'desc'
  const statusFilter = status && validStatus.includes(status) ? status : null
  const take = Math.min(parseInt(limit) || 20, 100)
  const skip = (Math.max(parseInt(page) || 1, 1) - 1) * take

  const where = {
    strategy: { userId },
    ...(statusFilter ? { status: statusFilter } : {}),
  }

  const [jobs, total] = await Promise.all([
    prisma.backtestJob.findMany({
      where,
      orderBy: { [sortField]: sortOrder },
      take,
      skip,
      select: {
        id:             true,
        status:         true,
        createdAt:      true,
        completedAt:    true,
        errorMessage:   true,
        pnlPercent:     true,
        pnlAbsolute:    true,
        finalCapital:   true,
        initialCapital: true,
        totalTrades:    true,
        winRate:        true,
        maxDrawdown:    true,
        sharpeRatio:    true,
        durationDays:   true,
        profitFactor:   true,
        strategy: { select: { id: true, name: true, pair: true, timeframe: true } },
        strategySnapshot: true,
        ...JOB_TAGS_INCLUDE,
      },
    }),
    prisma.backtestJob.count({ where }),
  ])

  return { jobs, total, page: Math.max(parseInt(page) || 1, 1), totalPages: Math.ceil(total / take) }
}

async function getJob(id, userId) {
  const job = await prisma.backtestJob.findFirst({
    where: { id, strategy: { userId } },
    include: {
      strategy: true,
      ...JOB_TAGS_INCLUDE,
    },
  })
  if (!job) throw new Error('JOB_NOT_FOUND')
  return job
}

async function cancelJob(id, userId) {
  const job = await prisma.backtestJob.findFirst({
    where: { id, strategy: { userId } },
  })
  if (!job) throw new Error('JOB_NOT_FOUND')
  if (job.status !== 'pending') throw new Error('JOB_NOT_CANCELABLE')

  return prisma.backtestJob.update({
    where: { id },
    data: { status: 'error', errorMessage: 'Cancelled by user' },
  })
}

// Worker-side

async function claimPendingJobs(apiKeyId, userId) {
  const potentialJobs = await prisma.backtestJob.findMany({
    where: { 
      status: 'pending',
      strategy: { userId: userId }
    },
    orderBy: { createdAt: 'asc' },
    take: 5,
  })

  if (potentialJobs.length === 0) return []
  const claimedJobs = []

  // Anti race condtion (Optimistic locking)
  for (const job of potentialJobs) {
    const claimAttempt = await prisma.backtestJob.updateMany({
      where: { 
        id: job.id,
        status: 'pending'
      },
      data: { 
        status: 'running', 
        claimedAt: new Date(), 
        startedAt: new Date(), 
        apiKeyId 
      },
    })

    if (claimAttempt.count > 0) {
      const fullJob = await prisma.backtestJob.findUnique({
        where: { id: job.id },
        include: { strategy: true }
      })
      claimedJobs.push(fullJob)
    }
  }

  return claimedJobs
}

async function submitResult(jobId, apiKeyId, payload) {
  const job = await prisma.backtestJob.findFirst({
    where: { id: jobId, apiKeyId, status: 'running' },
  })
  if (!job) throw new Error('JOB_NOT_FOUND')

  const { success, result, errorMessage } = payload

  return prisma.backtestJob.update({
    where: { id: jobId },
    data: {
      status:       success ? 'done' : 'error',
      completedAt:  new Date(),
      result:       success ? result : null,
      errorMessage: success ? null : (errorMessage || 'Worker error'),
      ...(success && result ? {
        pnlPercent:     result.pnlPercent     ?? null,
        pnlAbsolute:    result.pnlAbsolute    ?? null,
        finalCapital:   result.finalCapital   ?? null,
        initialCapital: result.initialCapital ?? null,
        totalTrades:    result.totalTrades    ?? null,
        winRate:        result.winRate        ?? null,
        maxDrawdown:    result.maxDrawdown    ?? null,
        sharpeRatio:    result.sharpeRatio    ?? null,
        durationDays:   result.durationDays   ?? null,
        profitFactor:   result.profitFactor   ?? null,
      } : {}),
    },
  })
}

async function timeoutStaleJobs() {
  const cutoff = new Date(Date.now() - 60 * 1000)
  await prisma.backtestJob.updateMany({
    where: {
      status: 'running',
      OR: [
        { apiKeyId: null },
        { apiKey: { lastHeartbeat: { lt: cutoff } } },
        { apiKey: { lastHeartbeat: null } },
      ],
    },
    data: {
      status:       'error',
      completedAt:  new Date(),
      errorMessage: 'Worker disconnected',
    },
  })
}

module.exports = { launchJob, listJobs, getJob, cancelJob, claimPendingJobs, submitResult, timeoutStaleJobs }
