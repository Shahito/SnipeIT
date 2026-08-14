const { verifyToken } = require('../utils/jwt')
const prisma = require('../utils/prisma')

async function authRequired(req, res, next) {
  try {
    const token = req.cookies.token
    if (!token) return res.status(401).json({ error: 'Not authenticated' })
    const decoded = verifyToken(token)
  
    const user = await prisma.user.findUnique({ where: { id: decoded.id } })
    if (!user) return res.status(401).json({ error: 'User not found' })
    
    if (decoded.tokenVersion !== user.tokenVersion) {
      res.clearCookie('token', { httpOnly: true, sameSite: 'Lax', path: '/' })
      return res.status(401).json({ error: 'Session expired or revoked' })
    }

    const { password, ...safeUser } = user
    req.user = safeUser

    const LAST_ACTIVE_THROTTLE_MS = 5 * 60 * 1000 // 5m
    if (Date.now() - new Date(user.lastActive).getTime() > LAST_ACTIVE_THROTTLE_MS) {
      prisma.user.update({
        where: { id: user.id },
        data: { lastActive: new Date() },
      }).catch(() => {}) // fire-and-forget
    }

    next()
  } catch (e) {
    return res.status(401).json({ error: 'Invalid token' })
  }
}

module.exports = authRequired
