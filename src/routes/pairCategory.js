// pairCategory.js
const express = require('express')
const router = express.Router()
const authRequired = require('../middleware/auth')
const {
  listController, createController, updateController, deleteController,
} = require('../controllers/pairCategoryController')

/**
 * @openapi
 * /api/pair-categories:
 *   get:
 *     tags: [pairCategory]
 *     summary: Liste les catégories de pairs (ex Majors, Meme coins, L1...)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: OK }
 */
router.get('/', authRequired, listController)

/**
 * @openapi
 * /api/pair-categories:
 *   post:
 *     tags: [pairCategory]
 *     summary: Crée une catégorie de pairs
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
 *               color: { type: string }
 *               pairs: { type: array, items: { type: string } }
 *     responses:
 *       201: { description: Created }
 *       400: { description: NAME_REQUIRED / PAIRS_INVALID }
 */
router.post('/', authRequired, createController)

/**
 * @openapi
 * /api/pair-categories/{id}:
 *   put:
 *     tags: [pairCategory]
 *     summary: Modifie une catégorie de pairs
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: OK }
 *       404: { description: CATEGORY_NOT_FOUND }
 */
router.put('/:id', authRequired, updateController)

/**
 * @openapi
 * /api/pair-categories/{id}:
 *   delete:
 *     tags: [pairCategory]
 *     summary: Supprime une catégorie de pairs
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: OK }
 *       404: { description: CATEGORY_NOT_FOUND }
 */
router.delete('/:id', authRequired, deleteController)

module.exports = router
