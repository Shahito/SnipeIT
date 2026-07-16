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

    next()
  } catch (e) {
    return res.status(401).json({ error: 'Invalid token' })
  }
}

module.exports = authRequired
