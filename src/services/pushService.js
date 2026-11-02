const webpush = require('web-push')
const prisma = require('../utils/prisma')
const { t: translate, SUPPORTED_LANGS, DEFAULT_LANG } = require('../i18n/push')
const { MAX_PUSH_SUBSCRIPTIONS } = require('../config/quotas')

// Webpush config. Both keys are required - without a private key web-push
// has nothing to sign with, so a public key alone is still "not configured".
let pushConfigured = Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY)

if (pushConfigured) {
  try {
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT || 'mailto:admin@example.com',
      process.env.VAPID_PUBLIC_KEY,
      process.env.VAPID_PRIVATE_KEY
    )
  } catch (err) {
    pushConfigured = false
    console.warn(`[SnipeIT] Push notifications disabled: VAPID config is invalid (${err.message})`)
  }
} else {
  console.warn('[SnipeIT] Push notifications disabled: VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY not set in .env')
}

function isPushConfigured() {
  return pushConfigured
}

function getVapidPublicKey() {
  if (!pushConfigured) {
    throw new Error('VAPID_NOT_CONFIGURED')
  }
  return process.env.VAPID_PUBLIC_KEY
}

// The server POSTs to the subscription endpoint, so only the browser vendors' push
// services are accepted (blocks requests to internal hosts)
const PUSH_HOST_SUFFIXES = [
  'fcm.googleapis.com',
  'push.services.mozilla.com',
  'notify.windows.com',
  'push.apple.com',
]

function isAllowedPushEndpoint(endpoint) {
  if (typeof endpoint !== 'string' || endpoint.length > 500) return false
  let url
  try { url = new URL(endpoint) } catch { return false }
  if (url.protocol !== 'https:' || url.username || url.password) return false
  if (url.port && url.port !== '443') return false
  const host = url.hostname.toLowerCase()
  return PUSH_HOST_SUFFIXES.some(s => host === s || host.endsWith(`.${s}`))
}

async function subscribePush(userId, subscription) {
  if (!subscription || !subscription.endpoint || !subscription.keys) {
    throw new Error('MISSING_FIELDS')
  }
  if (!userId) {
    throw new Error('UNAUTHORIZED')
  }
  if (!isAllowedPushEndpoint(subscription.endpoint)) {
    throw new Error('INVALID_ENDPOINT')
  }
  if (typeof subscription.keys.p256dh !== 'string' || typeof subscription.keys.auth !== 'string') {
    throw new Error('MISSING_FIELDS')
  }

  // Re-subscribing the same device never counts against the cap
  const others = await prisma.pushSubscription.count({
    where: { userId, NOT: { endpoint: subscription.endpoint } },
  })
  if (others >= MAX_PUSH_SUBSCRIPTIONS) throw new Error('QUOTA_EXCEEDED')

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
async function sendLocalizedNotificationToUser(userId, { titleKey, bodyKey, vars = {} }, url = '/', tag = undefined) {
  if (!userId || !pushConfigured) return { count: 0 }

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
      tag,
    })

    return webpush.sendNotification(pushSubscription, payload).catch(async (err) => {
      // Clean up expired subscriptions, status 410 or 404
      if (err.statusCode === 410 || err.statusCode === 404) {
        await prisma.pushSubscription.delete({ where: { id: sub.id } })
        return
      }
      console.warn(`[SnipeIT] Push send failed (sub ${sub.id}, status ${err.statusCode ?? 'n/a'}): ${err.body || err.message}`)
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