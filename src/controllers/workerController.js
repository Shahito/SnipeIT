const { claimPendingJobs, submitResult, reconcileInFlightJob } = require('../services/jobService')
const { recordWorkerHeartbeat } = require('../services/apikeyService')
const { getLatestWorkerRelease } = require('../services/workerReleaseService')
const prisma = require('../utils/prisma')
const { WORKER_DISCONNECT_THRESHOLD_MS } = require('../config/worker')

function parseReportedJobId(raw) {
  const n = parseInt(raw, 10)
  return Number.isInteger(n) && n > 0 ? n : null
}

function workerVersionField(req) {
  return req.workerVersion ? { workerVersion: req.workerVersion } : {}
}

async function heartbeatController(req, res) {
  try {
    await recordWorkerHeartbeat(req.apiKey.id, workerVersionField(req))
    const reportedJobId = parseReportedJobId(req.body && req.body.jobId)
    await reconcileInFlightJob(req.apiKey.id, reportedJobId)
    const latest = await getLatestWorkerRelease()
    res.json({ ok: true, latestWorkerVersion: latest ? latest.version : null, updateUrl: latest ? latest.url : null })
  } catch (e) {
    res.status(500).json({ error: 'UNKNOWN' })
  }
}

async function pollController(req, res) {
  try {
    // The poll also counts as a heartbeat
    await recordWorkerHeartbeat(req.apiKey.id, { lastUsedAt: new Date(), ...workerVersionField(req) })
    const reportedJobId = parseReportedJobId(req.query.jobId)
    await reconcileInFlightJob(req.apiKey.id, reportedJobId)
    const jobs = await claimPendingJobs(req.apiKey.id, req.workerUser.id)
    res.json({ jobs })
  } catch (e) {
    res.status(500).json({ error: 'UNKNOWN' })
  }
}

async function resultController(req, res) {
  try {
    const jobId = parseInt(req.params.id)
    const { success, result, errorMessage } = req.body
    if (success === undefined) return res.status(400).json({ error: 'MISSING_FIELDS' })
    const job = await submitResult(jobId, req.apiKey.id, req.workerUser.id, { success, result, errorMessage })
    res.json({ job })
  } catch (e) {
    const code = e.message === 'JOB_NOT_FOUND' ? 'JOB_NOT_FOUND' : 'UNKNOWN'
    res.status(code === 'JOB_NOT_FOUND' ? 404 : 500).json({ error: code })
  }
}

// Called from the UI (JWT user) to check whether a worker is active
async function statusController(req, res) {
  try {
    const threshold = new Date(Date.now() - WORKER_DISCONNECT_THRESHOLD_MS)
    const active = await prisma.apiKey.findFirst({
      where: { userId: req.user.id, lastHeartbeat: { gte: threshold } },
      select: { name: true, lastHeartbeat: true },
    })
    res.json({ connected: !!active, worker: active || null })
  } catch (e) {
    res.status(500).json({ error: 'UNKNOWN' })
  }
}

module.exports = { heartbeatController, pollController, resultController, statusController }
