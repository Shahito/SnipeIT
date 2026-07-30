// sweep.js
const express = require('express')
const router = express.Router()
const authRequired = require('../middleware/auth')
const { previewController, launchController, listController, getController } = require('../controllers/sweepController')

/**
 * @openapi
 * /api/strategies/{id}/sweep/preview:
 *   get:
 *     tags: [sweep]
 *     summary: Preview du nombre de combinaisons (sans lancement)
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
 *     summary: Lance un sweep (point d'entrée unique de lancement, run classique = totalRuns 1)
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
 *     summary: Liste les sweeps
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
 *     summary: Résultats agrégés d'un sweep (global + par catégorie de pair + sensibilité)
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

module.exports = router
