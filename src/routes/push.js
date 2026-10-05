const express = require('express')
const router = express.Router()
const authRequired = require('../middleware/auth')
const {
  getVapidPublicKeyController,
  subscribeController,
  sendTestNotificationController,
} = { ...require('../controllers/pushController') }

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
 */
// Optionnel: tu peux ajouter `authRequired` si la souscription nécessite d'être connecté
router.post('/subscribe', subscribeController)

/**
 * @openapi
 * /api/push/send-test:
 *   post:
 *     tags: [push]
 *     summary: Send a push notification to all subscribers (Admin / Test)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [title, body]
 *             properties:
 *               title: { type: string }
 *               body: { type: string }
 *               url: { type: string }
 *     responses:
 *       200:
 *         description: OK
 */
router.post('/send-test', authRequired, sendTestNotificationController)


module.exports = router