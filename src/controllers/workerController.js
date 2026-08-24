const { claimPendingJobs, submitResult } = require('../services/jobService')
const prisma = require('../utils/prisma')

async function heartbeatController(req, res) {
  try {
    await prisma.apiKey.update({
      where: { id: req.apiKey.id },
      data:  { lastHeartbeat: new Date() },
    })
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: 'UNKNOWN' })
  }
}

async function pollController(req, res) {
  try {
    // The poll also counts as a heartbeat
    await prisma.apiKey.update({
      where: { id: req.apiKey.id },
      data:  { lastHeartbeat: new Date(), lastUsedAt: new Date() },
    })
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
    const job = await submitResult(jobId, req.apiKey.id, { success, result, errorMessage })
    res.json({ job })
  } catch (e) {
    const code = e.message === 'JOB_NOT_FOUND' ? 'JOB_NOT_FOUND' : 'UNKNOWN'
    res.status(code === 'JOB_NOT_FOUND' ? 404 : 500).json({ error: code })
  }
}

// Called from the UI (JWT user) to check whether a worker is active
async function statusController(req, res) {
  try {
    const threshold = new Date(Date.now() - 45_000) // 45s
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
