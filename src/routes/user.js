// user.js
const express = require('express')
const router = express.Router()
const authRequired = require('../middleware/auth')
const { meController, changePasswordController } = require('../controllers/authController')

/**
 * @openapi
 * /api/user/me:
 *   get:
 *     tags: [user]
 *     summary: Get current user
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: OK
 */
router.get('/me', authRequired, meController)

/**
 * @openapi
 * /api/user/change-password:
 *   post:
 *     tags: [user]
 *     summary: Change password
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [oldPassword, newPassword]
 *             properties:
 *               oldPassword: { type: string }
 *               newPassword: { type: string }
 *     responses:
 *       200:
 *         description: OK
 *       400:
 *         description: MISSING_FIELDS / INVALID_OLD_PASSWORD / PASSWORD_TOO_SHORT
 */
router.post('/change-password', authRequired, changePasswordController)

module.exports = router