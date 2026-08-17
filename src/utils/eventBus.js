// eventBus.js
//
// In-memory pub/sub used to push job/sweep status updates to open SSE
// connections (see controllers/eventsController.js).
//
// WARNING: Node EventEmitter = single-process only. If the app ever runs
// clustered / multiple instances behind a LB, an event emitted on instance
// A will never reach a client connected to instance B. Switch to Redis
// pub/sub (or equivalent) if it ever needs to scale horizontally.

const { EventEmitter } = require('events')

const bus = new EventEmitter()
bus.setMaxListeners(0) // one listener per open SSE connection, no arbitrary cap

function emitToUser(userId, event, payload) {
  bus.emit(`user:${userId}`, { event, payload })
}

// handler(({ event, payload }) => void) - returns an unsubscribe function
function subscribeUser(userId, handler) {
  const channel = `user:${userId}`
  bus.on(channel, handler)
  return () => bus.off(channel, handler)
}

module.exports = { emitToUser, subscribeUser }