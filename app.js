require('dotenv').config()

const express     = require('express')
const cookieParser = require('cookie-parser')
const rateLimit = require('express-rate-limit')
const helmet = require('helmet')
const cron = require('node-cron')
const { isProd } = require('./src/utils/env')

const authRoutes       = require('./src/routes/auth')
const userRoutes       = require('./src/routes/user')
const strategyRoutes   = require('./src/routes/strategy')
const jobRoutes        = require('./src/routes/job')
const apikeyRoutes     = require('./src/routes/apikey')
const workerRoutes     = require('./src/routes/worker')
const tagRoutes        = require('./src/routes/tag')
const sweepRoutes      = require('./src/routes/sweep')
const eventsRoutes     = require('./src/routes/events')
const coinRoutes       = require('./src/routes/coin')

const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./src/config/swagger');

const app  = express()
const PORT = process.env.PORT || 4000

app.use(express.json())
app.use(cookieParser())
app.use(helmet({
  hsts: false,
  contentSecurityPolicy: false,
}))
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

if (isProd) {
  app.use('/api/auth/login', authLimiter)
  app.use('/api/auth/register', authLimiter)
  app.post('/api/apikeys', authLimiter) // key creation only

  // Looser limit on write-heavy routes
  app.post('/api/strategies', writeLimiter)
  app.post('/api/strategies/:id/sweep', writeLimiter)
}

app.use('/api/auth',           authRoutes)
app.use('/api/user',           userRoutes)
app.use('/api/strategies',     strategyRoutes)
app.use('/api/jobs',           jobRoutes)
app.use('/api/events',         eventsRoutes)
app.use('/api/apikeys',        apikeyRoutes)
app.use('/api/worker',         workerRoutes)
app.use('/api/tags',           tagRoutes)
app.use('/api/coins',          coinRoutes)
app.use('/api',                sweepRoutes) // expose /api/strategies/:id/sweep* and /api/sweeps*

if (!isProd) {
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
}

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }))

const { timeoutStaleJobs } = require('./src/services/jobService')
cron.schedule('*/30 * * * * *', async () => {
  try { await timeoutStaleJobs() }
  catch (e) { console.error('[SnipeIT] timeoutStaleJobs error:', e.message) }
})

//app.listen(PORT, '10.150.34.12', () => {
//  console.log(`[SnipeIT] Server running at http://localhost:${PORT}`)
//})
app.listen(PORT, '127.0.0.1', () => {
  console.log(`[SnipeIT] Server running at http://localhost:${PORT}`)
})
