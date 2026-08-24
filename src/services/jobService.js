const { Prisma } = require('@prisma/client')
const prisma = require('../utils/prisma')
const { refreshSweepGroupStatus } = require('./sweepService')

const JOB_TAGS_INCLUDE = { jobTags: { include: { tag: true } } }

const JOB_SELECT = {
  id: true, status: true, createdAt: true, errorMessage: true,
  pnlPercent: true, totalTrades: true, winRate: true, maxDrawdown: true, sharpeRatio: true,
  pair: true, sweepGroupId: true,
  sweepGroup: { select: { id: true, totalRuns: true, status: true } },
  strategy: { select: { id: true, name: true } },
  strategySnapshot: true,
  ...JOB_TAGS_INCLUDE,
}

const VALID_SORTS  = ['createdAt', 'pnlPercent', 'winRate', 'maxDrawdown', 'sharpeRatio', 'totalTrades']
const VALID_STATUS = ['pending', 'running', 'done', 'error']

// sortField (whitelisted against VALID_SORTS before use) -> SQL fragment.
// 'job'   : direct column on BacktestJob
// 'sweep' : average over the group's 'done' jobs (same semantics as sweepAverages()),
//           except createdAt, which stays the group's creation date.
const SORT_SQL = {
  createdAt:   { job: 'bj.createdAt',   sweep: 'sg.createdAt' },
  pnlPercent:  { job: 'bj.pnlPercent',  sweep: "AVG(CASE WHEN bj.status = 'done' THEN bj.pnlPercent END)" },
  winRate:     { job: 'bj.winRate',     sweep: "AVG(CASE WHEN bj.status = 'done' THEN bj.winRate END)" },
  maxDrawdown: { job: 'bj.maxDrawdown', sweep: "AVG(CASE WHEN bj.status = 'done' THEN bj.maxDrawdown END)" },
  sharpeRatio: { job: 'bj.sharpeRatio', sweep: "AVG(CASE WHEN bj.status = 'done' THEN bj.sharpeRatio END)" },
  totalTrades: { job: 'bj.totalTrades', sweep: "AVG(CASE WHEN bj.status = 'done' THEN bj.totalTrades END)" },
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
const orderSql   = sortOrder === 'asc' ? Prisma.sql`ASC` : Prisma.sql`DESC`
  const jobSortCol   = Prisma.raw(SORT_SQL[sortField].job)
  const sweepSortExpr = Prisma.raw(SORT_SQL[sortField].sweep)

  const sweepStatusCond = statusFilter
    ? Prisma.sql`AND (sg.status = ${statusFilter} OR EXISTS (
        SELECT 1 FROM BacktestJob bj2 WHERE bj2.sweepGroupId = sg.id AND bj2.status = ${statusFilter}
      ))`
    : Prisma.empty
  const jobStatusCond = statusFilter ? Prisma.sql`AND bj.status = ${statusFilter}` : Prisma.empty

  const unionSql = Prisma.sql`
    SELECT 'sweep' AS itemType, sg.id AS id, ${sweepSortExpr} AS sortVal
    FROM SweepGroup sg
    LEFT JOIN BacktestJob bj ON bj.sweepGroupId = sg.id
    WHERE sg.userId = ${userId} AND sg.totalRuns > 1
    ${sweepStatusCond}
    GROUP BY sg.id

    UNION ALL

    SELECT 'job' AS itemType, bj.id AS id, ${jobSortCol} AS sortVal
    FROM BacktestJob bj
    JOIN SweepGroup sg2 ON sg2.id = bj.sweepGroupId
    WHERE sg2.userId = ${userId} AND sg2.totalRuns = 1
    ${jobStatusCond}
  `

  const [countRow, pageRows] = await Promise.all([
    prisma.$queryRaw`SELECT COUNT(*) AS total FROM (${unionSql}) c`,
    prisma.$queryRaw`${unionSql} ORDER BY sortVal ${orderSql} LIMIT ${take} OFFSET ${skip}`,
  ])

  const total = Number(countRow[0]?.total ?? 0)
  const sweepIds = pageRows.filter(r => r.itemType === 'sweep').map(r => r.id)
  const jobIds   = pageRows.filter(r => r.itemType === 'job').map(r => r.id)

  // Hydration: only for the items on the current page (bounded by `take`),
  // not for the full history like before.
  const [sweepGroups, standaloneJobs] = await Promise.all([
    sweepIds.length ? prisma.sweepGroup.findMany({
      where: { id: { in: sweepIds } },
      include: {
        strategy: { select: { id: true, name: true } },
        jobs: { select: { status: true, pnlPercent: true, sharpeRatio: true, winRate: true, maxDrawdown: true, totalTrades: true } },
      },
    }) : [],
    jobIds.length ? prisma.backtestJob.findMany({ where: { id: { in: jobIds } }, select: JOB_SELECT }) : [],
  ])

  const sweepById = new Map(sweepGroups.map(g => [g.id, {
    itemType: 'sweep', id: g.id, strategy: g.strategy, status: g.status,
    totalRuns: g.totalRuns, createdAt: g.createdAt, ...sweepAverages(g.jobs),
  }]))
  const jobById = new Map(standaloneJobs.map(j => [j.id, { itemType: 'job', ...j }]))

  // The order determined by the SQL query is respected (it carries the real sort).
  const jobs = pageRows
    .map(r => (r.itemType === 'sweep' ? sweepById.get(r.id) : jobById.get(r.id)))
    .filter(Boolean)

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
      await refreshSweepGroupStatus(job.sweepGroupId) // notify SSE clients: pending -> running
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
