// src/utils/eventBus.js — remplace tout le fichier

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

const MAX_SSE_PER_USER = 8 // multi-tab/dev usage headroom

const bus = new EventEmitter()
bus.setMaxListeners(1000) // hard ceiling, avoid unbounded memory growth

const userChannels = new Map() // userId -> [{ handler }]

function emitToUser(userId, event, payload) {
  bus.emit(`user:${userId}`, { event, payload })
}

// handler(({ event, payload }) => void) - returns an unsubscribe function
function subscribeUser(userId, handler) {
  const channel = `user:${userId}`
  let entries = userChannels.get(userId)
  if (!entries) { entries = []; userChannels.set(userId, entries) }

  // Evict the oldest connection instead of rejecting the new one - a stale
  // tab/reload shouldn't lock a fresh page out of live updates.
  if (entries.length >= MAX_SSE_PER_USER) {
    const oldest = entries.shift()
    bus.off(channel, oldest.handler)
  }

  bus.on(channel, handler)
  const entry = { handler }
  entries.push(entry)

  return () => {
    bus.off(channel, handler)
    const i = entries.indexOf(entry)
    if (i !== -1) entries.splice(i, 1)
  }
}

module.exports = { emitToUser, subscribeUser }