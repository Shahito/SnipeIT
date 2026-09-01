const express = require('express')
const router = express.Router()
const { resendWebhookController } = require('../controllers/webhookController')

router.post('/resend', resendWebhookController)

module.exports = router