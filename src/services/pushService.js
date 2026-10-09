const webpush = require('web-push')
const prisma = require('../utils/prisma')
const { t: translate, SUPPORTED_LANGS, DEFAULT_LANG } = require('../i18n/push')

// Webpush config. Both keys are required - without a private key web-push
// has nothing to sign with, so a public key alone is still "not configured".
const PUSH_CONFIGURED = Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY)

if (PUSH_CONFIGURED) {
  try {
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT || 'mailto:admin@example.com',
      process.env.VAPID_PUBLIC_KEY,
      process.env.VAPID_PRIVATE_KEY
    )
  } catch (err) {
    pushConfigured = false
    console.warn(`[SnipeIT] Push notifications disabled: VAPID keys are invalid (${err.message})`)
  }
} else {
  console.warn('[SnipeIT] Push notifications disabled: VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY not set in .env')
}

function isPushConfigured() {
  return PUSH_CONFIGURED
}

function getVapidPublicKey() {
  if (!PUSH_CONFIGURED) {
    throw new Error('VAPID_NOT_CONFIGURED')
  }
  return process.env.VAPID_PUBLIC_KEY
}

async function subscribePush(userId, subscription) {
  if (!subscription || !subscription.endpoint || !subscription.keys) {
    throw new Error('MISSING_FIELDS')
  }
  if (!userId) {
    throw new Error('UNAUTHORIZED')
  }

  const lang = SUPPORTED_LANGS.includes(subscription.lang) ? subscription.lang : DEFAULT_LANG

  // Store or update the subscription for this endpoint
  return prisma.pushSubscription.upsert({
    where: { endpoint: subscription.endpoint },
    update: {
      keys: subscription.keys,
      userId: userId || null,
      userId,
      lang,
    },
    create: {
      endpoint: subscription.endpoint,
      keys: subscription.keys,
      userId: userId || null,
      userId,
      lang,
    },
  })
}

// Localized push notification.
// titleKey and bodyKey are keys from public/locales.
// Each subscription is translated using its own stored lang, since the
// same user can have different languages on different devices.
async function sendLocalizedNotificationToUser(userId, { titleKey, bodyKey, vars = {} }, url = '/') {
  if (!userId) return { count: 0 }

  const subscriptions = await prisma.pushSubscription.findMany({ where: { userId } })

  const sendPromises = subscriptions.map((sub) => {
    const pushSubscription = {
      endpoint: sub.endpoint,
      keys: typeof sub.keys === 'string' ? JSON.parse(sub.keys) : sub.keys,
    }
    const payload = JSON.stringify({
      title: translate(sub.lang, titleKey, vars),
      body: translate(sub.lang, bodyKey, vars),
      url,
    })

    return webpush.sendNotification(pushSubscription, payload).catch(async (err) => {
      // Clean up expired subscriptions, status 410 or 404
      if (err.statusCode === 410 || err.statusCode === 404) {
        await prisma.pushSubscription.delete({ where: { id: sub.id } })
      }
    })
  })

  await Promise.all(sendPromises)
  return { count: subscriptions.length }
}

module.exports = {
  isPushConfigured,
  getVapidPublicKey,
  subscribePush,
  sendLocalizedNotificationToUser,
}