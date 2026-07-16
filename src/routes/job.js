// job.js
const express = require('express')
const router = express.Router()
const authRequired = require('../middleware/auth')
const { launchController, listController, getController, cancelController } = require('../controllers/jobController')
const { getCandlesController } = require('../controllers/candleController')

/**
 * @openapi
 * /api/jobs:
 *   post:
 *     tags: [job]
 *     summary: Launch a job
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [strategyId]
 *             properties:
 *               strategyId: { type: integer }
 *     responses:
 *       201:
 *         description: Created
 *       400:
 *         description: MISSING_FIELDS / STRATEGY_NOT_FOUND / JOB_ALREADY_RUNNING
 */
router.post('/', authRequired, launchController)

/**
 * @openapi
 * /api/jobs:
 *   get:
 *     tags: [job]
 *     summary: List jobs
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer }
 *       - in: query
 *         name: limit
 *         schema: { type: integer }
 *       - in: query
 *         name: sort
 *         schema: { type: string }
 *       - in: query
 *         name: order
 *         schema: { type: string, enum: [asc, desc] }
 *       - in: query
 *         name: status
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: OK
 */
router.get('/', authRequired, listController)

/**
 * @openapi
 * /api/jobs/{id}:
 *   get:
 *     tags: [job]
 *     summary: Get job details
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: OK
 *       404:
 *         description: JOB_NOT_FOUND
 */
router.get('/:id', authRequired, getController)

/**
 * @openapi
 * /api/jobs/{id}/candles:
 *   get:
 *     tags: [job]
 *     summary: Get OHLCV candles for a job's pair/timeframe/date range (proxied from Binance public API)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: OK
 *       400:
 *         description: UNSUPPORTED_EXCHANGE / INVALID_JOB_PARAMS
 *       404:
 *         description: JOB_NOT_FOUND
 *       502:
 *         description: CANDLES_FETCH_FAILED
 */
// Indicators are embedded directly in the /candles response (see
// candleController.js + utils/indicatorEngine.js) — one Binance fetch
// shared for both, instead of a separate round-trip.
router.get('/:id/candles', authRequired, getCandlesController)

/**
 * @openapi
 * /api/jobs/{id}/cancel:
 *   post:
 *     tags: [job]
 *     summary: Cancel a job
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: OK
 *       400:
 *         description: JOB_NOT_CANCELABLE
 */
router.post('/:id/cancel', authRequired, cancelController)

module.exports = router
