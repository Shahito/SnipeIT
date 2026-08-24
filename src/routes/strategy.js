const express = require('express')
const router = express.Router()
const authRequired = require('../middleware/auth')
const {
  listController, getController, createController,
  updateController, cloneController, cloneFromSnapshotController, deleteController,
} = require('../controllers/strategyController')

/**
 * @openapi
 * /api/strategies:
 *   get:
 *     tags: [strategy]
 *     summary: List strategies
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: OK
 */
router.get('/', authRequired, listController)

/**
 * @openapi
 * /api/strategies/{id}:
 *   get:
 *     tags: [strategy]
 *     summary: Get strategy details
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
 *         description: STRATEGY_NOT_FOUND
 */
router.get('/:id', authRequired, getController)

/**
 * @openapi
 * /api/strategies:
 *   post:
 *     tags: [strategy]
 *     summary: Create a strategy
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, pairs, timeframe, startDate, endDate, conditions]
 *             properties:
 *               name: { type: string }
 *               description: { type: string }
 *               pairs: { type: array, items: { type: string } }
 *               timeframe: { type: string }
 *               startDate: { type: string, format: date }
 *               endDate: { type: string, format: date }
 *               initialCapital: { type: number }
 *               positionSize: { type: number }
 *               stopLoss: { type: number }
 *               takeProfit: { type: number }
 *               conditions: { type: object }
 *     responses:
 *       201:
 *         description: Created
 *       400:
 *         description: MISSING_FIELDS / NAME_REQUIRED / PAIRS_INVALID / TIMEFRAME_INVALID / DATE_INVALID / DATE_RANGE_INVALID / CAPITAL_INVALID / POSITION_SIZE_INVALID / CONDITIONS_INVALID
 */
router.post('/', authRequired, createController)

/**
 * @openapi
 * /api/strategies/{id}:
 *   put:
 *     tags: [strategy]
 *     summary: Update a strategy
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
 *               name: { type: string }
 *               description: { type: string }
 *               pairs: { type: array, items: { type: string } }
 *               timeframe: { type: string }
 *               startDate: { type: string, format: date }
 *               endDate: { type: string, format: date }
 *               initialCapital: { type: number }
 *               positionSize: { type: number }
 *               stopLoss: { type: number }
 *               takeProfit: { type: number }
 *               conditions: { type: object }
 *     responses:
 *       200:
 *         description: OK
 *       400:
 *         description: validation error (see create)
 */
router.put('/:id', authRequired, updateController)

/**
 * @openapi
 * /api/strategies/{id}/clone:
 *   post:
 *     tags: [strategy]
 *     summary: Clone a strategy
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       201:
 *         description: Created
 *       400:
 *         description: STRATEGY_NOT_FOUND
 */
router.post('/:id/clone', authRequired, cloneController)

/**
 * @openapi
 * /api/strategies/jobs/{jobId}/clone-snapshot:
 *   post:
 *     tags: [strategy]
 *     summary: Clone a strategy from a job snapshot
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       201:
 *         description: Created
 *       404:
 *         description: JOB_NOT_FOUND / SNAPSHOT_NOT_FOUND
 */
router.post('/jobs/:jobId/clone-snapshot', authRequired, cloneFromSnapshotController)

/**
 * @openapi
 * /api/strategies/{id}:
 *   delete:
 *     tags: [strategy]
 *     summary: Delete a strategy
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
 *         description: STRATEGY_NOT_FOUND
 */
router.delete('/:id', authRequired, deleteController)

module.exports = router