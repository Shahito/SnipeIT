require('dotenv').config()

const express = require('express')
const cookieParser = require('cookie-parser')
const rateLimit = require('express-rate-limit')
const helmet = require('helmet')
const cron = require('node-cron')
const { isProd } = require('./src/utils/env')

const authRoutes = require('./src/routes/auth')
const strategyRoutes = require('./src/routes/strategy')
const jobRoutes = require('./src/routes/job')
const apikeyRoutes = require('./src/routes/apikey')
const workerRoutes = require('./src/routes/worker')
const tagRoutes = require('./src/routes/tag')
const sweepRoutes = require('./src/routes/sweep')
const eventsRoutes = require('./src/routes/events')
const coinRoutes = require('./src/routes/coin')
const webhookRoutes = require('./src/routes/webhooks')
const pushRoutes = require('./src/routes/push')

const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./src/config/swagger');
const { PROTECTED_PAGES, requireAuthPage, redirectIfAuthed } = require('./src/middleware/pageAuth')

const app = express()
const PORT = process.env.PORT || 4000

// Keep the raw body around (needed to verify the Resend/Svix webhook
// signature, computed over the exact bytes received).
// Larger body only for job results, registered first so it parses before the global limit
app.use('/api/worker/jobs/:id/result', express.json({ limit: '512kb' }))
app.use(express.json({
  verify: (req, _res, buf) => { req.rawBody = buf }
}))
app.use(cookieParser())
app.use(helmet({
  hsts: isProd,
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https://cdn.jsdelivr.net"],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
}))
app.get(PROTECTED_PAGES, requireAuthPage)
app.get('/', redirectIfAuthed)
app.use(express.static('public'))

app.set('trust proxy', 1)

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15m
  max: 20, // 20 tries/IP
  message: { error: 'TOO_MANY_REQUESTS' },
  standardHeaders: true,
  legacyHeaders: false,
})
const writeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15m
  max: 100, // 100 tries/IP
  message: { error: 'TOO_MANY_REQUESTS' },
  standardHeaders: true,
  legacyHeaders: false,
})

// just defense-in-depth / anti log-spam, not brute-force protection
const verifyEmailLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15m
  max: 30, // 30 tries/IP
  message: { error: 'TOO_MANY_REQUESTS' },
  standardHeaders: true,
  legacyHeaders: false,
})

if (isProd) {
  app.use('/api/auth/login', authLimiter)
  app.use('/api/auth/register', authLimiter)
  app.use('/api/auth/resend-verification', authLimiter)
  app.use('/api/auth/correct-pending-email', authLimiter)
  app.use('/api/auth/verify-email', verifyEmailLimiter)
  app.post('/api/auth/change-password', authLimiter)
  app.post('/api/auth/change-email', authLimiter)
  app.post('/api/apikeys', authLimiter) // key creation only

  // Looser limit on write-heavy routes
  app.post('/api/strategies', writeLimiter)
  app.post('/api/strategies/:id/sweep', writeLimiter)
}

app.use('/api/auth', authRoutes)
app.use('/api/strategies', strategyRoutes)
app.use('/api/jobs', jobRoutes)
app.use('/api/events', eventsRoutes)
app.use('/api/apikeys', apikeyRoutes)
app.use('/api/worker', workerRoutes)
app.use('/api/tags', tagRoutes)
app.use('/api/coins', coinRoutes)
app.use('/api/webhooks', webhookRoutes)
app.use('/api/push', pushRoutes)
app.use('/api', sweepRoutes) // expose /api/strategies/:id/sweep* and /api/sweeps*

if (!isProd) {
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
}

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }))

const { timeoutStaleJobs } = require('./src/services/jobService')
// Skip a tick when the previous run of the same task is still going
function guarded(name, fn) {
  let running = false
  return async () => {
    if (running) return
    running = true
    try { await fn() }
    catch (e) { console.error(`[SnipeIT] ${name} error:`, e.message) }
    finally { running = false }
  }
}

// 30s
cron.schedule('*/30 * * * * *', guarded('timeoutStaleJobs', timeoutStaleJobs))

const { notifyDisconnectedWorkers } = require('./src/services/apikeyService')
// 30s
cron.schedule('*/30 * * * * *', guarded('notifyDisconnectedWorkers', notifyDisconnectedWorkers))

const { cleanupStaleCandleCache } = require('./src/utils/candleCache')
// 3AM
cron.schedule('0 3 * * *', () => {
  try { cleanupStaleCandleCache() }
  catch (e) { console.error('[SnipeIT] cleanupStaleCandleCache error:', e.message) }
})

const { purgeSoftDeletedStrategies } = require('./src/services/strategyService')
// Hourly
cron.schedule('0 * * * *', guarded('purgeSoftDeletedStrategies', purgeSoftDeletedStrategies))

app.listen(PORT, '127.0.0.1', () => {
  console.log(`[SnipeIT] Server running at http://localhost:${PORT}`)
})