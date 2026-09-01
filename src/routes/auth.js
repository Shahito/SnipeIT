const express = require('express')
const router = express.Router()
const authRequired = require('../middleware/auth')
const {
  registerController,
  loginController,
  meController,
  changePasswordController,
  verifyEmailController,
  resendVerificationController,
  logoutController,
  logoutAllController,
} = require('../controllers/authController')

/**
 * @openapi
 * /api/auth/register:
 *   post:
 *     tags: [auth]
 *     summary: Register a new user
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [username, password]
 *             properties:
 *               username: { type: string }
 *               password: { type: string }
 *     responses:
 *       200:
 *         description: OK
 *       400:
 *         description: MISSING_FIELDS
 *       409:
 *         description: USERNAME_TAKEN / USERNAME_LENGTH / USERNAME_INVALID / PASSWORD_TOO_SHORT
 */
router.post('/register', registerController)

/**
 * @openapi
 * /api/auth/login:
 *   post:
 *     tags: [auth]
 *     summary: Log in
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [username, password]
 *             properties:
 *               username: { type: string }
 *               password: { type: string }
 *     responses:
 *       200:
 *         description: OK (sets httpOnly cookie "token")
 *       400:
 *         description: MISSING_FIELDS
 *       401:
 *         description: INVALID_CREDENTIALS
 */
router.post('/login', loginController)

/**
 * @openapi
 * /api/auth/me:
 *   get:
 *     tags: [auth]
 *     summary: Get current user
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: OK
 */
router.get('/me', authRequired, meController)

/**
 * @openapi
 * /api/auth/verify-email:
 *   post:
 *     tags: [auth]
 *     summary: Verify a user's email using the token sent by mail
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [token]
 *             properties:
 *               token: { type: string }
 *     responses:
 *       200:
 *         description: OK
 *       400:
 *         description: TOKEN_INVALID / TOKEN_EXPIRED
 */
router.post('/verify-email', verifyEmailController)

/**
 * @openapi
 * /api/auth/resend-verification:
 *   post:
 *     tags: [auth]
 *     summary: Resend the verification email for a given username (public, rate-limited)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [username]
 *             properties:
 *               username: { type: string }
 *     responses:
 *       200:
 *         description: OK (always returns success, doesn't reveal account state)
 */
router.post('/resend-verification', resendVerificationController)

/**
 * @openapi
 * /api/auth/change-password:
 *   post:
 *     tags: [auth]
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

/**
 * @openapi
 * /api/auth/logout:
 *   post:
 *     tags: [auth]
 *     summary: Log out current session (clears cookie)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: OK
 */
router.post('/logout', authRequired, logoutController)

/**
 * @openapi
 * /api/auth/logout-all:
 *   post:
 *     tags: [auth]
 *     summary: Log out all sessions
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: OK
 */
router.post('/logout-all', authRequired, logoutAllController)

module.exports = router