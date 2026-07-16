// worker.js
const express = require('express')
const router  = express.Router()
const workerAuth = require('../middleware/workerAuth')
const authRequired = require('../middleware/auth')
const { heartbeatController, pollController, resultController, statusController } = require('../controllers/workerController')

/**
 * @openapi
 * /api/worker/heartbeat:
 *   post:
 *     tags: [worker]
 *     summary: Worker heartbeat
 *     security: [{ apiKeyAuth: [] }]
 *     responses:
 *       200:
 *         description: OK
 */
router.post('/heartbeat', workerAuth, heartbeatController)

/**
 * @openapi
 * /api/worker/jobs:
 *   get:
 *     tags: [worker]
 *     summary: Poll available jobs (also acts as heartbeat)
 *     security: [{ apiKeyAuth: [] }]
 *     responses:
 *       200:
 *         description: OK
 */
router.get('/jobs', workerAuth, pollController)

/**
 * @openapi
 * /api/worker/jobs/{id}/result:
 *   post:
 *     tags: [worker]
 *     summary: Submit job result
 *     security: [{ apiKeyAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [success]
 *             properties:
 *               success: { type: boolean }
 *               result: { type: object }
 *               errorMessage: { type: string }
 *     responses:
 *       200:
 *         description: OK
 *       400:
 *         description: MISSING_FIELDS
 *       404:
 *         description: JOB_NOT_FOUND
 */
router.post('/jobs/:id/result', workerAuth, resultController)

/**
 * @openapi
 * /api/worker/status:
 *   get:
 *     tags: [worker]
 *     summary: Get worker connection status (heartbeat within last 45s)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: OK
 */
router.get('/status', authRequired, statusController)

module.exports = router