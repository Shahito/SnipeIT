const { subscribeUser } = require('../utils/eventBus')

const HEARTBEAT_MS = 20000 // keeps the connection alive through proxies/LBs

function streamController(req, res) {
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

  const unsubscribe = subscribeUser(req.user.id, ({ event, payload }) => send(event, payload))

  const heartbeat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS)

  req.on('close', () => {
    clearInterval(heartbeat)
    unsubscribe()
  })
}

module.exports = { streamController }