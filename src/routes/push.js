const express = require('express')
const router = express.Router()
const authRequired = require('../middleware/auth')
const {
  getVapidPublicKeyController,
  subscribeController,
} = { ...require('../controllers/pushController') }

const { isPushConfigured } = require('../services/pushService')

// Every push route needs VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY (see
// pushService.js) - without them there's nothing push can do, so gate the
// whole router here instead of letting each controller fail its own way
// (subscribe would otherwise silently store a subscription that can never
// receive anything, and send-test would error out inside web-push itself).
router.use((req, res, next) => {
  if (!isPushConfigured()) {
    return res.status(503).json({ error: 'PUSH_NOT_CONFIGURED' })
  }
  next()
})

/**
 * @openapi
 * /api/push/vapid-public-key:
 *   get:
 *     tags: [push]
 *     summary: Retrieve VAPID public key for web push subscription
 *     responses:
 *       200:
 *         description: OK
 */
router.get('/vapid-public-key', getVapidPublicKeyController)

/**
 * @openapi
 * /api/push/subscribe:
 *   post:
 *     tags: [push]
 *     summary: Save push subscription details
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [endpoint, keys]
 *     responses:
 *       200:
 *         description: OK
 *       400:
 *         description: MISSING_FIELDS
 *       401:
 *         description: Not authenticated
 */
router.post('/subscribe', authRequired, subscribeController)

module.exports = router