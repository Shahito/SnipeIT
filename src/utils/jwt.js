const jwt = require('jsonwebtoken')

const SECRET = process.env.JWT_SECRET

if (!SECRET) {
  console.error('[FATAL] JWT_SECRET is not set in .env - server will not start.')
  process.exit(1)
}

function signToken(payload) {
  return jwt.sign(payload, SECRET, { expiresIn: '30d' })
}

function verifyToken(token) {
  return jwt.verify(token, SECRET)
}

module.exports = { signToken, verifyToken }
