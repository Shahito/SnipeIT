const jwt = require('jsonwebtoken')

const PROTECTED_PAGES = [
  '/strategies.html',
  '/jobs.html',
  '/strategy-editor.html',
  '/apikeys.html',
  "sweep-results.html",
  "results.html",
]

function requireAuthPage(req, res, next) {
  const token = req.cookies?.token
  if (!token) return res.redirect('/')
  try {
    jwt.verify(token, process.env.JWT_SECRET)
    next()
  } catch (_) {
    res.redirect('/')
  }
}

function redirectIfAuthed(req, res, next) {
  const token = req.cookies?.token
  if (token) {
    try {
      jwt.verify(token, process.env.JWT_SECRET)
      return res.redirect('/strategies.html')
    } catch (_) {}
  }
  next()
}

module.exports = { PROTECTED_PAGES, requireAuthPage, redirectIfAuthed }