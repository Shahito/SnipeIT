const express = require('express')
const router  = express.Router()
const auth    = require('../middleware/auth')
const { listController, createController, updateController, deleteController, setJobTagsController } = require('../controllers/tagController')

/**
 * @openapi
 * /api/tags:
 *   get:
 *     tags: [tag]
 *     summary: List tags
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: OK
 */
router.get('/', auth, listController)

/**
 * @openapi
 * /api/tags:
 *   post:
 *     tags: [tag]
 *     summary: Create a tag
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
 *     responses:
 *       201:
 *         description: Created
 *       400:
 *         description: MISSING_FIELDS / TAG_NAME_TOO_LONG / TAG_COLOR_INVALID
 */
router.post('/', auth, createController)

/**
 * @openapi
 * /api/tags/{id}:
 *   put:
 *     tags: [tag]
 *     summary: Update a tag
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
 *               color: { type: string }
 *     responses:
 *       200:
 *         description: OK
 *       400:
 *         description: TAG_NAME_TOO_LONG / TAG_COLOR_INVALID
 */
router.put('/:id', auth, updateController)

/**
 * @openapi
 * /api/tags/{id}:
 *   delete:
 *     tags: [tag]
 *     summary: Delete a tag
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
 *         description: TAG_NOT_FOUND
 */
router.delete('/:id', auth, deleteController)

/**
 * @openapi
 * /api/tags/jobs/{jobId}:
 *   put:
 *     tags: [tag]
 *     summary: Set tags on a job
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [tagIds]
 *             properties:
 *               tagIds:
 *                 type: array
 *                 items: { type: integer }
 *     responses:
 *       200:
 *         description: OK
 *       400:
 *         description: MISSING_FIELDS / TAG_NOT_FOUND
 */
router.put('/jobs/:jobId', auth, setJobTagsController)

module.exports = router