const express = require('express')
const router = express.Router()
const authRequired = require('../middleware/auth')
const { previewController, launchController, listController, getController, equityCurvesController } = require('../controllers/sweepController')

/**
 * @openapi
 * /api/strategies/{id}/sweep/preview:
 *   get:
 *     tags: [sweep]
 *     summary: Preview the number of combinations (no launch)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: OK }
 *       400: { description: SWEEP_TOO_LARGE / SWEEP_AXIS_EMPTY }
 *       404: { description: STRATEGY_NOT_FOUND }
 */
router.get('/strategies/:id/sweep/preview', authRequired, previewController)

/**
 * @openapi
 * /api/strategies/{id}/sweep:
 *   post:
 *     tags: [sweep]
 *     summary: Launch a sweep (single launch entry point, classic run = totalRuns 1)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               confirmLarge: { type: boolean }
 *     responses:
 *       201: { description: Created }
 *       400: { description: SWEEP_TOO_LARGE / SWEEP_CONFIRMATION_REQUIRED / JOB_ALREADY_RUNNING }
 *       404: { description: STRATEGY_NOT_FOUND }
 */
router.post('/strategies/:id/sweep', authRequired, launchController)

/**
 * @openapi
 * /api/sweeps:
 *   get:
 *     tags: [sweep]
 *     summary: List sweeps
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: OK }
 */
router.get('/sweeps', authRequired, listController)

/**
 * @openapi
 * /api/sweeps/{id}:
 *   get:
 *     tags: [sweep]
 *     summary: Aggregated results of a sweep (global + per pair category + sensitivity)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: OK }
 *       404: { description: SWEEP_NOT_FOUND }
 */
router.get('/sweeps/:id', authRequired, getController)

/**
 * @openapi
 * /api/sweeps/{id}/equity-curves:
 *   get:
 *     tags: [sweep]
 *     summary: Non-flat equity curves for the sweep's done jobs, plus an averaged curve
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: OK }
 *       404: { description: SWEEP_NOT_FOUND }
 */
router.get('/sweeps/:id/equity-curves', authRequired, equityCurvesController)

module.exports = router
