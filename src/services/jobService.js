const prisma = require('../utils/prisma')
const { refreshSweepGroupStatus } = require('./sweepService')

const JOB_TAGS_INCLUDE = { jobTags: { include: { tag: true } } }

const JOB_SELECT = {
  id: true, status: true, createdAt: true, completedAt: true, errorMessage: true,
  pnlPercent: true, pnlAbsolute: true, finalCapital: true, initialCapital: true,
  totalTrades: true, winRate: true, maxDrawdown: true, sharpeRatio: true,
  durationDays: true, profitFactor: true, pair: true, sweepGroupId: true, paramValues: true,
  sweepGroup: { select: { id: true, totalRuns: true, status: true } },
  strategy: { select: { id: true, name: true, pairs: true, timeframe: true } },
  strategySnapshot: true,
  ...JOB_TAGS_INCLUDE,
}

const VALID_SORTS  = ['createdAt', 'pnlPercent', 'pnlAbsolute', 'winRate', 'maxDrawdown', 'sharpeRatio', 'profitFactor', 'totalTrades']
const VALID_STATUS = ['pending', 'running', 'done', 'error']

function sortValue(item, sortField) {
  if (sortField === 'createdAt') return new Date(item.createdAt).getTime()
  return item[sortField] ?? -Infinity
}

function sweepAverages(jobs) {
  const done = jobs.filter(j => j.status === 'done')
  const avg = (field) => done.length ? done.reduce((sum, j) => sum + (j[field] ?? 0), 0) / done.length : null
  return {
    pnlPercent:  avg('pnlPercent'),
    sharpeRatio: avg('sharpeRatio'),
    winRate:     avg('winRate'),
    maxDrawdown: avg('maxDrawdown'),
    totalTrades: avg('totalTrades'),
  }
}

async function listJobs(userId, { page = 1, limit = 20, sort = 'createdAt', order = 'desc', status = null, sweepGroupId = null } = {}) {
  const sortField    = VALID_SORTS.includes(sort) ? sort : 'createdAt'
  const sortOrder    = order === 'asc' ? 'asc' : 'desc'
  const statusFilter = status && VALID_STATUS.includes(status) ? status : null
  const take = Math.min(parseInt(limit) || 20, 9999)
  const skip = (Math.max(parseInt(page) || 1, 1) - 1) * take

  if (sweepGroupId) {
    const where = {
      strategy: { userId },
      sweepGroupId: parseInt(sweepGroupId),
      ...(statusFilter ? { status: statusFilter } : {}),
    }
    const [jobs, total] = await Promise.all([
      prisma.backtestJob.findMany({ where, orderBy: { [sortField]: sortOrder }, take, skip, select: JOB_SELECT }),
      prisma.backtestJob.count({ where }),
    ])
    return { jobs, total, page: Math.max(parseInt(page) || 1, 1), totalPages: Math.ceil(total / take) }
  }

  const sweepGroups = await prisma.sweepGroup.findMany({
    where: { userId, totalRuns: { gt: 1 } },
    include: {
      strategy: { select: { id: true, name: true } },
      jobs: { select: { status: true, pnlPercent: true, sharpeRatio: true, winRate: true, maxDrawdown: true, totalTrades: true } },
    },
  })
  const sweepItems = sweepGroups
    .filter(g => !statusFilter || g.jobs.some(j => j.status === statusFilter) || g.status === statusFilter)
    .map(g => ({
      itemType: 'sweep', id: g.id, strategy: g.strategy, status: g.status,
      totalRuns: g.totalRuns, createdAt: g.createdAt, ...sweepAverages(g.jobs),
    }))

  const standaloneJobs = await prisma.backtestJob.findMany({
    where: {
      strategy: { userId },
      sweepGroup: { totalRuns: 1 },
      ...(statusFilter ? { status: statusFilter } : {}),
    },
    select: JOB_SELECT,
  })
  const jobItems = standaloneJobs.map(j => ({ itemType: 'job', ...j }))

  const merged = [...sweepItems, ...jobItems]
    .sort((a, b) => sortOrder === 'asc'
      ? sortValue(a, sortField) - sortValue(b, sortField)
      : sortValue(b, sortField) - sortValue(a, sortField))

  const total = merged.length
  const jobs  = merged.slice(skip, skip + take)
  return { jobs, total, page: Math.max(parseInt(page) || 1, 1), totalPages: Math.ceil(total / take) }
}

async function getJob(id, userId) {
  const job = await prisma.backtestJob.findFirst({
    where: { id, strategy: { userId } },
    include: {
      strategy: true,
      sweepGroup: { select: { id: true, totalRuns: true, status: true } },
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

  const updated = await prisma.backtestJob.update({
    where: { id },
    data: { status: 'error', errorMessage: 'Cancelled by user' },
  })
  await refreshSweepGroupStatus(job.sweepGroupId)
  return updated
}

// Worker-side

async function claimPendingJobs(apiKeyId, userId) {
  const potentialJobs = await prisma.backtestJob.findMany({
    where: {
      status: 'pending',
      strategy: { userId: userId },
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
        status: 'pending',
      },
      data: {
        status: 'running',
        claimedAt: new Date(),
        startedAt: new Date(),
        apiKeyId,
      },
    })

    if (claimAttempt.count > 0) {
      const fullJob = await prisma.backtestJob.findUnique({ where: { id: job.id } })
      claimedJobs.push({
        id: fullJob.id,
        strategy: fullJob.strategySnapshot,
      })
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

  const updated = await prisma.backtestJob.update({
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

  await refreshSweepGroupStatus(job.sweepGroupId)
  return updated
}

async function timeoutStaleJobs() {
  const cutoff = new Date(Date.now() - 60 * 1000)
  const stale = await prisma.backtestJob.findMany({
    where: {
      status: 'running',
      OR: [
        { apiKeyId: null },
        { apiKey: { lastHeartbeat: { lt: cutoff } } },
        { apiKey: { lastHeartbeat: null } },
      ],
    },
    select: { id: true, sweepGroupId: true },
  })
  if (stale.length === 0) return

  await prisma.backtestJob.updateMany({
    where: { id: { in: stale.map(j => j.id) } },
    data: {
      status:       'error',
      completedAt:  new Date(),
      errorMessage: 'Worker disconnected',
    },
  })

  const affectedGroups = [...new Set(stale.map(j => j.sweepGroupId).filter(Boolean))]
  await Promise.all(affectedGroups.map(refreshSweepGroupStatus))
}

module.exports = { listJobs, getJob, cancelJob, claimPendingJobs, submitResult, timeoutStaleJobs }
