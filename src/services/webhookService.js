const { Webhook } = require('svix')
const prisma = require('../utils/prisma')

// Events that mean "this address will never receive mail" - a permanent
// (hard) bounce. We deliberately do NOT act on email.delivery_delayed
// (soft bounce): Resend retries those on its own, and email.bounced fires
// afterwards if it ultimately fails - acting early would flag addresses
// that were only temporarily unreachable (full inbox, greylisting, etc).
const HARD_BOUNCE_EVENT = 'email.bounced'
const COMPLAINED_EVENT = 'email.complained'
const DELIVERED_EVENT = 'email.delivered'

function verifyResendWebhook(rawBody, headers) {
  const secret = process.env.RESEND_WEBHOOK_SECRET
  if (!secret) {
    throw new Error('RESEND_WEBHOOK_SECRET is not set - cannot verify incoming webhooks.')
  }
  const wh = new Webhook(secret)
  // NOTE: wh.verify() only throws on an invalid signature - it does NOT
  // return the parsed payload (svix 2.x), so we parse it ourselves below.
  wh.verify(rawBody, {
    'svix-id': headers['svix-id'],
    'svix-timestamp': headers['svix-timestamp'],
    'svix-signature': headers['svix-signature'],
  })
  return JSON.parse(rawBody)
}

async function handleResendEvent(event) {
  const recipients = Array.isArray(event.data?.to) ? event.data.to : []
  const recipient = (recipients[0] || '').trim().toLowerCase()
  if (!recipient) return { handled: false }

  if (event.type === HARD_BOUNCE_EVENT || event.type === COMPLAINED_EVENT) {
    const reason = event.type === HARD_BOUNCE_EVENT
      ? (event.data?.bounce?.message || 'Hard bounce')
      : 'Recipient marked the email as spam'

    // Only touch accounts that are still unverified.
    const onCurrentEmail = await prisma.user.updateMany({
      where: { email: recipient, emailVerified: false },
      data: {
        emailDeliveryFailed: true,
        emailDeliveryFailedReason: String(reason).slice(0, 191),
        emailDeliveryFailedAt: new Date(),
      },
    })

    // Same bounce, but for an in-progress email-change (changeEmail()) -
    // the bad address here is pendingEmail, not the account's current email.
    const onPendingEmail = await prisma.user.updateMany({
      where: { pendingEmail: recipient },
      data: {
        pendingEmailDeliveryFailed: true,
        pendingEmailDeliveryFailedReason: String(reason).slice(0, 191),
        pendingEmailDeliveryFailedAt: new Date(),
      },
    })

    const matched = onCurrentEmail.count + onPendingEmail.count
    console.log(`[webhookService] ${event.type} for "${recipient}" -> ${matched} user(s) updated`)
    return { handled: true, matchedUsers: matched }
  }

  if (event.type === DELIVERED_EVENT) {
    // Real proof the address now works (suppression list expired, typo
    // fixed and this is a fresh address, etc.) - only now is it safe to
    // clear a previous bounce flag.
    const onCurrentEmail = await prisma.user.updateMany({
      where: { email: recipient, emailDeliveryFailed: true },
      data: {
        emailDeliveryFailed: false,
        emailDeliveryFailedReason: null,
        emailDeliveryFailedAt: null,
      },
    })

    const onPendingEmail = await prisma.user.updateMany({
      where: { pendingEmail: recipient, pendingEmailDeliveryFailed: true },
      data: {
        pendingEmailDeliveryFailed: false,
        pendingEmailDeliveryFailedReason: null,
        pendingEmailDeliveryFailedAt: null,
      },
    })

    const matched = onCurrentEmail.count + onPendingEmail.count
    console.log(`[webhookService] ${event.type} for "${recipient}" -> ${matched} user(s) cleared`)
    return { handled: true, matchedUsers: matched }
  }

  return { handled: false }
}

module.exports = { verifyResendWebhook, handleResendEvent }