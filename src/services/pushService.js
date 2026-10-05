const webpush = require('web-push')
const prisma = require('../utils/prisma')

// Webpush config
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:admin@example.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  )
}

function getVapidPublicKey() {
  if (!process.env.VAPID_PUBLIC_KEY) {
    throw new Error('VAPID_NOT_CONFIGURED')
  }
  return process.env.VAPID_PUBLIC_KEY
}

async function subscribePush(userId, subscription) {
  if (!subscription || !subscription.endpoint || !subscription.keys) {
    throw new Error('MISSING_FIELDS')
  }

  // Store or update the subscription for this endpoint
  return prisma.pushSubscription.upsert({
    where: { endpoint: subscription.endpoint },
    update: {
      keys: subscription.keys,
      userId: userId || null,
    },
    create: {
      endpoint: subscription.endpoint,
      keys: subscription.keys,
      userId: userId || null,
    },
  })
}

async function sendNotificationToAll(title, body, url = '/') {
  const payload = JSON.stringify({ title, body, url })
  const subscriptions = await prisma.pushSubscription.findMany()

  const sendPromises = subscriptions.map((sub) => {
    const pushSubscription = {
      endpoint: sub.endpoint,
      keys: typeof sub.keys === 'string' ? JSON.parse(sub.keys) : sub.keys,
    }

    return webpush.sendNotification(pushSubscription, payload).catch(async (err) => {
      // Auto clean up of expired subscriptions (410 Gone / 404 Not Found)
      if (err.statusCode === 410 || err.statusCode === 404) {
        await prisma.pushSubscription.delete({ where: { id: sub.id } })
      }
    })
  })

  await Promise.all(sendPromises)
  return { count: subscriptions.length }
}

module.exports = {
  getVapidPublicKey,
  subscribePush,
  sendNotificationToAll,
}