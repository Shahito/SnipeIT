const { subscribeUser } = require('../utils/eventBus')

const HEARTBEAT_MS = 20000 // keeps the connection alive through proxies/LBs

function streamController(req, res) {
  let unsubscribe
  try {
    unsubscribe = subscribeUser(req.user.id, ({ event, payload }) => send(event, payload))
  } catch (e) {
    return res.status(429).json({ error: 'TOO_MANY_CONNECTIONS' })
  }

  res.writeHead(200, {
    'Content-Type':      'text/event-stream',
    'Cache-Control':      'no-cache, no-transform',
    Connection:            'keep-alive',
    'X-Accel-Buffering':  'no', // disable nginx buffering if this ever sits behind one
  })
  res.flushHeaders?.()

  const send = (event, payload) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`)
  }

  send('ready', { at: Date.now() })
  
  function cleanup() {
    clearInterval(heartbeat)
    unsubscribe()
  }

  const heartbeat = setInterval(() => {
    try {
      res.write(': ping\n\n')
    } catch (e) {
      cleanup()
    }
  }, HEARTBEAT_MS)

  res.on('close', cleanup)
}

module.exports = { streamController }