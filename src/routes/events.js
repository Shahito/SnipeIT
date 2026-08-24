const express = require('express')
const router = express.Router()
const authRequired = require('../middleware/auth')
const { streamController } = require('../controllers/eventsController')

/**
 * @openapi
 * /api/events/stream:
 *   get:
 *     tags: [events]
 *     summary: Server-Sent Events stream (job/sweep status updates)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: text/event-stream
 */
router.get('/stream', authRequired, streamController)

module.exports = router