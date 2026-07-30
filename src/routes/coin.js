// coin.js
const express = require('express')
const router = express.Router()
const authRequired = require('../middleware/auth')
const { listController, validatePairsController } = require('../controllers/coinController')

/**
 * @openapi
 * /api/coins:
 *   get:
 *     tags: [coin]
 *     summary: Liste des coins tradables sur Binance (base+quote confondus) + catégories fixes
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
 *     summary: Filtre une liste de paires candidates (BASE/QUOTE) sur celles réellement tradables
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