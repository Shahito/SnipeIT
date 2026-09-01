const { verifyResendWebhook, handleResendEvent } = require('../services/webhookService')

async function resendWebhookController(req, res) {
  let event
  try {
    // IMPORTANT: verify against the raw bytes (req.rawBody), never against
    // req.body re-stringified - that would break the signature check.
    event = verifyResendWebhook(req.rawBody, req.headers)
  } catch (e) {
    console.error('[resendWebhookController] Signature verification failed:', e.message)
    return res.status(400).json({ error: 'INVALID_SIGNATURE' })
  }

  try {
    await handleResendEvent(event)
  } catch (e) {
    console.error('[resendWebhookController] Failed to process event:', e.message)
  }

  res.status(200).json({ received: true })
}

module.exports = { resendWebhookController }