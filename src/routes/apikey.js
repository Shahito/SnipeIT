// apikey.js
const express = require('express')
const router = express.Router()
const authRequired = require('../middleware/auth')
const { createController, listController, deleteController } = require('../controllers/apikeyController')

/**
 * @openapi
 * /api/apikeys:
 *   get:
 *     tags: [apikey]
 *     summary: List API keys
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: OK
 */
router.get('/', authRequired, listController)

/**
 * @openapi
 * /api/apikeys:
 *   post:
 *     tags: [apikey]
 *     summary: Create an API key
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name: { type: string }
 *     responses:
 *       201:
 *         description: Created
 *       400:
 *         description: MISSING_FIELDS
 *       429:
 *         description: API_KEY_LIMIT_REACHED
 */
router.post('/', authRequired, createController)

/**
 * @openapi
 * /api/apikeys/{id}:
 *   delete:
 *     tags: [apikey]
 *     summary: Delete an API key
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
 *         description: API_KEY_NOT_FOUND
 */
router.delete('/:id', authRequired, deleteController)

module.exports = router