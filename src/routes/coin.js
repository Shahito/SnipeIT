const express = require('express')
const router = express.Router()
const authRequired = require('../middleware/auth')
const { listController, validatePairsController } = require('../controllers/coinController')

/**
 * @openapi
 * /api/coins:
 *   get:
 *     tags: [coin]
 *     summary: List tradable coins on Binance (base+quote combined) + fixed categories
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: OK }
 *       502: { description: COIN_LIST_UNAVAILABLE }
 */
router.get('/', authRequired, listController)

/**
 * @openapi
 * /api/coins/validate-pairs:
 *   post:
 *     tags: [coin]
 *     summary: Filter a list of candidate pairs (BASE/QUOTE) to those actually tradable
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [pairs]
 *             properties:
 *               pairs: { type: array, items: { type: string } }
 *     responses:
 *       200: { description: OK }
 */
router.post('/validate-pairs', authRequired, validatePairsController)

module.exports = router